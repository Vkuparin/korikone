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
import { Service } from "../application/service";
import { shoppingList } from "../domain/planner";
import { stateSchema } from "../domain/model";
import { z } from "zod";
import { KRuokaProvider } from "../stores/k-ruoka";
import { KRuokaWorker, findChrome } from "../stores/worker";
import { SKaupatProvider, sKaupatWorker } from "../stores/s-kaupat";
import { ChatGPT } from "../ai/chatgpt";
import { draftPrompt, validateDraft } from "../ai/draft";
import { readReceipt } from "../receipts/read";
import { diagnostics } from "../application/diagnostics";
if (process.env.KORIKONE_TEST_DATA)
  app.setPath("userData", process.env.KORIKONE_TEST_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(async () => {
    const db = new Database(join(app.getPath("userData"), "korikone.sqlite"));
    const service = new Service(db);
    const ai = new ChatGPT(
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
    await ai.init();
    service.ai = ai.status();
    const worker = new KRuokaWorker(
      join(
        app.isPackaged ? process.resourcesPath : app.getAppPath(),
        "vendor/k-ruoka/k-ruoka-mcp.exe",
      ),
      join(app.getPath("userData"), "retailers/k-ruoka/profile"),
      findChrome(),
    );
    service.registry.register(
      new KRuokaProvider((name, args) => worker.call(name, args)),
    );
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
    service.registry.register(sKaupat);
    // start_login waits for the user, so it runs beside the serialized operations.
    let sLogin: Promise<void> | null = null;
    let sLoginRun = 0;
    const loginSKaupat = () => {
      if (sLogin) return;
      const run = ++sLoginRun;
      service.storeLogins["s-kaupat"] = "waiting";
      sLogin = sWorker
        .call("start_login", { timeoutSeconds: 300 }, 330000)
        .then((result) => {
          const { status } = z.object({ status: z.string() }).parse(result);
          return status === "logged_in"
            ? "signedIn"
            : status === "cancelled"
              ? "notStarted"
              : "failed";
        })
        .catch(() => "failed")
        .then((state) => {
          if (run === sLoginRun) service.storeLogins["s-kaupat"] = state;
          sLogin = null;
        });
    };
    await service.init();
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
    const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
      load: async () => service.snapshot(),
      save: async (input) => {
        const before = service.state.context;
        const result = await service.save(input);
        const context = service.state.context;
        if (
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
        let text = await ai.generate(
          request.model,
          draftPrompt(request.prompt, service.state),
        );
        try {
          service.draft = validateDraft(text, service.state);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "invalidDraft")
            throw error;
          text = await ai.generate(
            request.model,
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
      loginStore: async () => {
        if (service.busy) throw new Error("busy");
        if (service.state.context.providerId === "s-kaupat") {
          loginSKaupat();
          return service.snapshot();
        }
        const result = z
          .object({ state: z.string() })
          .parse(await worker.call("start_login", {}));
        service.storeLogins["k-ruoka"] = result.state;
        return service.snapshot();
      },
      checkStoreLogin: async () => {
        if (service.busy) throw new Error("busy");
        if (service.state.context.providerId === "s-kaupat") {
          if (!sLogin) {
            const { status } = z
              .object({ status: z.string() })
              .parse(await sWorker.call("login_status", {}));
            service.storeLogins["s-kaupat"] =
              status === "logged_in" ? "signedIn" : "notStarted";
          }
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
      cancelStoreLogin: async () => {
        if (service.state.context.providerId === "s-kaupat") {
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
      logoutStore: async () => {
        // K-Ruoka's pinned worker has no sign-out tool.
        if (service.busy || service.state.context.providerId !== "s-kaupat")
          throw new Error("unsupported");
        await sWorker.call("log_out", {});
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
        if (providerId === "s-kaupat")
          await sWorker.call("open_site", { applyChoice: false });
        else
          await shell.openExternal("https://www.k-ruoka.fi/kauppa/ostoskori");
        return service.snapshot();
      },
      copyList: async () => {
        clipboard.writeText(shoppingList(service.state));
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
          await db.set(`backup-${Date.now()}`, service.state);
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
          const pending = queue.then(() => handler(input));
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
