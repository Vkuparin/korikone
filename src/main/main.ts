import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  clipboard,
} from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { Database } from "../persistence/database";
import { createService } from "../application/development";
import { FixtureAI, aiScenarios } from "../ai/fixtures";
import { shoppingList } from "../domain/planner";
import { calendarText } from "../domain/calendar";
import { stateSchema } from "../domain/model";
import { z } from "zod";
import { KRuokaProvider } from "../stores/k-ruoka";
import { KRuokaWorker, findChrome } from "../stores/worker";
import {
  SKaupatProvider,
  SKaupatSession,
  sKaupatWorker,
} from "../stores/s-kaupat";
import { ChatGPT } from "../ai/chatgpt";
import { draftPrompt, validateDraft } from "../ai/draft";
import { readReceipt } from "../receipts/read";
import { diagnostics } from "../application/diagnostics";
if (process.env.KORIKONE_TEST_DATA)
  app.setPath("userData", process.env.KORIKONE_TEST_DATA);
else if (process.env.KORIKONE_DATA_DIR)
  app.setPath("userData", process.env.KORIKONE_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(async () => {
    const db = new Database(join(app.getPath("userData"), "korikone.sqlite"));
    const forcedDevelopment =
      !!process.env.KORIKONE_TEST_DATA ||
      process.env.KORIKONE_DEVELOPMENT === "1";
    let development =
      forcedDevelopment || (await db.get("development-mode")) === true;
    const liveAI = new ChatGPT(
      db,
      {
        encrypt: (text) => {
          if (!safeStorage.isEncryptionAvailable())
            throw new Error("credentialUnavailable");
          return safeStorage.encryptString(text).toString("base64");
        },
        decrypt: (text) => {
          if (!safeStorage.isEncryptionAvailable())
            throw new Error("credentialUnavailable");
          return safeStorage.decryptString(Buffer.from(text, "base64"));
        },
      },
      (url) => shell.openExternal(url),
    );
    const fixtureAI = new FixtureAI();
    let ai = development ? fixtureAI : liveAI;
    let liveAIInitialized = false;
    if (!development) {
      await liveAI.init();
      liveAIInitialized = true;
    }
    const worker = new KRuokaWorker(
      join(
        app.isPackaged ? process.resourcesPath : app.getAppPath(),
        "vendor/k-ruoka/k-ruoka-mcp.exe",
      ),
      join(app.getPath("userData"), "retailers/k-ruoka/profile"),
      findChrome(),
    );
    const kRuoka = new KRuokaProvider((name, args) => worker.call(name, args));
    const sWorker = sKaupatWorker({
      script: join(
        app.isPackaged ? process.resourcesPath : app.getAppPath(),
        "vendor/s-kaupat/s-kaupat-mcp.cjs",
      ),
      dataDir: join(app.getPath("userData"), "retailers/s-kaupat"),
    });
    const sKaupat = new SKaupatProvider((name, args) =>
      sWorker.call(name, args),
    );
    const sSession = new SKaupatSession(
      (name, args, timeout) => sWorker.call(name, args, timeout),
      db,
    );
    let service = await createService(db, development, [kRuoka, sKaupat]);
    service.ai = ai.status();
    // start_login waits for the user, so it runs beside the serialized operations.
    let sLogin: Promise<void> | null = null;
    let sLoginRun = 0;
    const loginSKaupat = () => {
      if (sLogin) return;
      const run = ++sLoginRun;
      service.storeLogins["s-kaupat"] = "waiting";
      sLogin = sSession
        .login()
        .catch(() => "failed")
        .then((state) => {
          if (run === sLoginRun) service.storeLogins["s-kaupat"] = state;
          sLogin = null;
        });
    };
    // Sign-in actions name a chain, so either chain can be signed in while the other is active.
    const chainOf = (input: unknown) =>
      input === undefined || input === null
        ? service.state.context.providerId
        : z.enum(["k-ruoka", "s-kaupat"]).parse(input);
    const ui = fileURLToPath(new URL("../ui/index.html", import.meta.url));
    const window = new BrowserWindow({
      show: process.env.KORIKONE_TEST_HIDDEN !== "1",
      width: 1280,
      height: 900,
      minWidth: 680,
      minHeight: 600,
      backgroundColor: "#f3f6f3",
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#f3f6f3", symbolColor: "#30483b", height: 38 },
      webPreferences: {
        backgroundThrottling: process.env.KORIKONE_TEST_HIDDEN !== "1",
        preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    let generationRun = 0;
    const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
      load: async () => {
        service.developmentRequests = development ? fixtureAI.requestCount : 0;
        return service.snapshot();
      },
      setDevelopmentMode: async (input) => {
        const enabled = z.boolean().parse(input);
        if (forcedDevelopment && !enabled)
          throw new Error("developmentRequired");
        if (service.busy || sLogin || ai.status().state === "waiting")
          throw new Error("busy");
        if (enabled === development) return service.snapshot();
        ai.cancel();
        ai.cancelRequest();
        await Promise.all([worker.close(), sWorker.close()]);
        if (!enabled && !liveAIInitialized) {
          await liveAI.init();
          liveAIInitialized = true;
        }
        const next = await createService(db, enabled, [kRuoka, sKaupat]);
        await db.set("development-mode", enabled);
        development = enabled;
        service = next;
        ai = enabled ? fixtureAI : liveAI;
        service.developmentScenario = fixtureAI.scenario;
        service.developmentRequests = enabled ? fixtureAI.requestCount : 0;
        service.ai = ai.status();
        return service.snapshot();
      },
      developmentScenario: async (input) => {
        if (!development) throw new Error("developmentRequired");
        fixtureAI.setScenario(z.enum(aiScenarios).parse(input));
        service.developmentRequests = 0;
        service.developmentScenario = fixtureAI.scenario;
        return service.snapshot();
      },
      save: async (input) => {
        const before = service.state.context;
        const result = await service.save(input);
        const context = service.state.context;
        if (
          !development &&
          context.providerId === "s-kaupat" &&
          (before.providerId !== context.providerId ||
            before.storeId !== context.storeId)
        )
          // Best effort: Korikone always passes the store explicitly.
          await sKaupat.selectStore(context).catch(() => {});
        return result;
      },
      setLanguage: (input) => service.setLanguage(input),
      cancelTransfer: async () => {
        service.controller?.abort();
        return service.snapshot();
      },
      signInAI: async () => {
        await ai.signIn();
        return service.snapshot();
      },
      cancelAI: async () => {
        generationRun++;
        service.draft = null;
        service.draftRevision = null;
        ai.cancel();
        ai.cancelRequest();
        return service.snapshot();
      },
      signOutAI: async () => {
        await ai.signOut();
        service.draft = null;
        return service.snapshot();
      },
      modelsAI: async () => {
        await ai.models();
        return service.snapshot();
      },
      usageAI: async () => {
        if (!development)
          await shell.openExternal("https://chatgpt.com/settings/usage");
        return service.snapshot();
      },
      generate: async (input) => {
        const request = z
          .object({
            prompt: z.string().min(1).max(10000),
            model: z.string().default("auto"),
            consent: z.literal(true),
          })
          .parse(input);
        const revision = service.state.revision;
        const run = ++generationRun;
        service.draft = null;
        service.draftRevision = null;
        const generate = async (prompt: string) => {
          try {
            const text = await ai.generate(request.model, prompt);
            if (run !== generationRun) throw new Error("aiCancelled");
            return text;
          } catch (error) {
            if (
              run !== generationRun ||
              (error instanceof Error && error.name === "AbortError")
            )
              throw new Error("aiCancelled");
            throw error;
          } finally {
            service.developmentRequests = development
              ? fixtureAI.requestCount
              : 0;
          }
        };
        let text = await generate(draftPrompt(request.prompt, service.state));
        try {
          service.draft = validateDraft(text, service.state);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "invalidDraft")
            throw error;
          text = await generate(
            draftPrompt(request.prompt, service.state) +
              " The previous response failed validation. Check integer quantities, unique recipe IDs, and that every meal references an existing or new recipe. Return complete JSON only.",
          );
          service.draft = validateDraft(text, service.state);
        }
        service.draftRevision = revision;
        service.draftNote = request.prompt;
        return service.snapshot();
      },
      approveDraft: () => service.approveDraft(),
      confirmPurchase: () => service.confirmPurchase(),
      newWeek: () => service.newWeek(),
      reuseWeek: () => service.reuseWeek(),
      buildBasket: () => service.buildBasket(),
      compareStores: () => service.compareStores(),
      accept: (input) => service.accept(input),
      omit: (input) => service.omit(input),
      prepare: (input) => service.prepare(input),
      execute: (input) => service.execute(input),
      recover: () => service.recover(),
      scenario: (input) => service.scenario(input),
      searchStores: async (input) => {
        if (service.busy) throw new Error("busy");
        const query = z.string().min(2).max(150).parse(input);
        const results = await Promise.allSettled(
          ["k-ruoka", "s-kaupat"].map((id) =>
            service.registry.get(id).searchStores(query),
          ),
        );
        const found = results.flatMap((r) =>
          r.status === "fulfilled" ? r.value : [],
        );
        const failed = results.find((r) => r.status === "rejected");
        if (!found.length && failed) throw failed.reason;
        service.storeResults = found;
        return service.snapshot();
      },
      loginStore: async (input) => {
        const chain = chainOf(input);
        if (service.busy) throw new Error("busy");
        if (development) {
          service.storeLogins[chain] = "signedIn";
          return service.snapshot();
        }
        if (chain === "s-kaupat") {
          loginSKaupat();
          return service.snapshot();
        }
        const result = z
          .object({ state: z.string() })
          .parse(await worker.call("start_login", {}));
        service.storeLogins["k-ruoka"] = result.state;
        return service.snapshot();
      },
      checkStoreLogin: async (input) => {
        const chain = chainOf(input);
        if (service.busy) throw new Error("busy");
        if (development) return service.snapshot();
        if (chain === "s-kaupat") {
          if (!sLogin)
            service.storeLogins["s-kaupat"] = (await sSession.signedIn())
              ? "signedIn"
              : "notStarted";
          return service.snapshot();
        }
        const result = z
          .object({ state: z.string() })
          .parse(await worker.call("login_status", {}));
        service.storeLogins["k-ruoka"] = result.state;
        if (result.state === "notStarted") {
          const auth = z
            .object({ loggedIn: z.boolean() })
            .parse(await worker.call("auth_status", {}));
          service.storeLogins["k-ruoka"] = auth.loggedIn
            ? "signedIn"
            : "notStarted";
        }
        return service.snapshot();
      },
      cancelStoreLogin: async (input) => {
        const chain = chainOf(input);
        if (development) {
          service.storeLogins[chain] = "notStarted";
          return service.snapshot();
        }
        if (chain === "s-kaupat") {
          // Stopping the server closes its login window; the next call restarts it.
          sLoginRun++;
          sLogin = null;
          await sWorker.close();
          service.storeLogins["s-kaupat"] = "notStarted";
          return service.snapshot();
        }
        await worker.call("cancel_login", {});
        service.storeLogins["k-ruoka"] = "notStarted";
        return service.snapshot();
      },
      logoutStore: async (input) => {
        const chain = chainOf(input);
        if (development) {
          service.storeLogins[chain] = "notStarted";
          return service.snapshot();
        }
        // K-Ruoka's pinned worker has no sign-out tool.
        if (service.busy || chain !== "s-kaupat")
          throw new Error("unsupported");
        await sSession.logout();
        service.storeLogins["s-kaupat"] = "notStarted";
        return service.snapshot();
      },
      openStoreCart: async () => {
        const providerId = service.journal?.review.context.providerId;
        if (
          service.busy ||
          service.journal?.status !== "verified" ||
          (providerId !== "k-ruoka" && providerId !== "s-kaupat")
        )
          throw new Error("reviewRequired");
        if (development) return service.snapshot();
        if (providerId === "s-kaupat") {
          // A token without a login in this folder's window would open the store signed out.
          if (!(await sSession.signedIn())) {
            service.storeLogins["s-kaupat"] = "notStarted";
            throw new Error("loginRequired");
          }
          await sWorker.call("open_site", { applyChoice: false });
        } else
          await shell.openExternal("https://www.k-ruoka.fi/kauppa/ostoskori");
        return service.snapshot();
      },
      copyList: async () => {
        clipboard.writeText(shoppingList(service.state));
        return service.snapshot();
      },
      copyWeek: async () => {
        clipboard.writeText(calendarText(service.state));
        return service.snapshot();
      },
      importReceipt: async () => {
        const { filePaths } = await dialog.showOpenDialog(window, {
          properties: ["openFile"],
          filters: [
            { name: "Receipt / Kuitti", extensions: ["pdf", "txt", "csv"] },
          ],
        });
        if (filePaths[0]) {
          const text = await readReceipt(filePaths[0]);
          if (service.state.receiptText.length + text.length + 1 > 50000)
            throw new Error("receiptTooLarge");
          return service.save({
            ...service.state,
            receiptText: service.state.receiptText + "\n" + text,
          });
        }
        return service.snapshot();
      },
      exportList: async () => {
        const { filePath } = await dialog.showSaveDialog(window, {
          defaultPath: "korikone-shopping-list.txt",
        });
        if (filePath)
          await writeFile(filePath, shoppingList(service.state), "utf8");
        return service.snapshot();
      },
      exportData: async () => {
        const { filePath } = await dialog.showSaveDialog(window, {
          defaultPath: "korikone-backup.json",
        });
        if (filePath)
          await writeFile(
            filePath,
            JSON.stringify(service.state, null, 2),
            "utf8",
          );
        return service.snapshot();
      },
      exportDiagnostics: async () => {
        const report = JSON.stringify(
          diagnostics(service.snapshot(), {
            app: app.getVersion(),
            electron: process.versions.electron,
            platform: `${process.platform} ${process.arch}`,
            packaged: String(app.isPackaged),
          }),
          null,
          2,
        );
        // Show exactly what will be saved before writing it anywhere.
        const fi = service.state.language === "fi";
        const { response } = await dialog.showMessageBox(window, {
          type: "info",
          message: fi ? "Vianetsintätiedot" : "Diagnostic report",
          detail: report,
          buttons: fi ? ["Tallenna…", "Peruuta"] : ["Save…", "Cancel"],
          defaultId: 0,
          cancelId: 1,
        });
        if (response !== 0) return service.snapshot();
        const { filePath } = await dialog.showSaveDialog(window, {
          defaultPath: "korikone-diagnostics.json",
        });
        if (filePath) await writeFile(filePath, report, "utf8");
        return service.snapshot();
      },
      importData: async () => {
        const { filePaths } = await dialog.showOpenDialog(window, {
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (filePaths[0]) {
          const next = stateSchema.parse(
            JSON.parse(await readFile(filePaths[0], "utf8")),
          );
          await db.set(
            `${development ? "development:" : ""}backup-${Date.now()}`,
            service.state,
          );
          return service.save({ ...next, revision: service.state.revision });
        }
        return service.snapshot();
      },
    };
    let queue: Promise<unknown> = Promise.resolve();
    for (const [name, handler] of Object.entries(handlers))
      ipcMain.handle(`app:${name}`, async (event, input) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("forbidden");
        try {
          if (
            name === "setLanguage" ||
            name === "cancelTransfer" ||
            name === "cancelAI" ||
            name === "load"
          ) {
            const value = (await handler(input)) as object;
            service.ai = ai.status();
            return { ok: true, value: { ...value, ai: service.ai } };
          }
          const submittedRun = generationRun;
          const pending = queue.then(() => {
            if (name === "generate" && submittedRun !== generationRun)
              throw new Error("aiCancelled");
            return handler(input);
          });
          queue = pending.catch(() => {});
          const value = (await pending) as object;
          service.ai = ai.status();
          return { ok: true, value: { ...value, ai: service.ai } };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error && /^[a-zA-Z]+$/.test(error.message)
                ? error.message
                : "operationFailed",
          };
        }
      });
    await window.loadFile(ui);
    let closing = false;
    app.on("before-quit", (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;
      ai.cancel();
      ai.cancelRequest();
      void Promise.allSettled([worker.close(), sWorker.close()])
        .finally(() => db.close())
        .finally(() => app.quit());
    });
  });
app.on("window-all-closed", () => app.quit());
