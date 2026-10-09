import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  clipboard,
  net,
} from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { Database } from "../persistence/database";
import { createService } from "../application/development";
import { FixtureAI, aiScenarios } from "../ai/fixtures";
import { chooseModel } from "../ai/models";
import { shoppingList } from "../domain/planner";
import { calendarText } from "../domain/calendar";
import { stateSchema } from "../domain/model";
import { z } from "zod";
import { SKaupatHost } from "./s-kaupat-host";
import { KRuokaProvider } from "../stores/k-ruoka";
import { KRuokaWorker, findChrome } from "../stores/worker";
import {
  SKaupatProvider,
  SKaupatSession,
  sKaupatWorker,
} from "../stores/s-kaupat";
import { ChatGPT } from "../ai/chatgpt";
import {
  draftPrompt,
  validateDraft,
  generateValidated,
  recipePrompt,
  validateRecipe,
} from "../ai/draft";
import { readReceipt } from "../receipts/read";
import { checkForUpdate } from "../application/updates";
import { diagnostics } from "../application/diagnostics";
import { SKaupatLibrary } from "../stores/s-kaupat-library";
import { StoreViews } from "./store-view";
import {
  KRuokaSite,
  pageScript,
  type PageRequest,
} from "../stores/k-ruoka-site";
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
    // Korikone's own client through the K-Ruoka store tab's session (U3.7), checked live by the
    // owner on 9 October 2026. KORIKONE_K_RUOKA=worker goes back to the pinned worker's Chrome.
    const kRuokaViaSite = process.env.KORIKONE_K_RUOKA !== "worker";
    const kRuokaSite = new KRuokaSite(
      (request) =>
        stores.evaluate(
          "k-ruoka",
          pageScript(request),
        ) as ReturnType<PageRequest>,
    );
    const kRuokaStore = () =>
      service.state.context.providerId === "k-ruoka"
        ? service.state.context.storeId
        : service.state.stores["k-ruoka"]?.storeId;
    const kRuoka = new KRuokaProvider((name, args) =>
      kRuokaViaSite ? kRuokaSite.call(name, args) : worker.call(name, args),
    );
    // S-kaupat's server calls from the Kauppa tab's session (U3.5), so one sign-in there serves
    // both. KORIKONE_S_KAUPAT=browser goes back to the server's own Edge or Chrome window.
    const sKaupatViaTab = process.env.KORIKONE_S_KAUPAT !== "browser";
    const sHost = new SKaupatHost({
      evaluate: (script) => stores.evaluate("s-kaupat", script),
      reload: () => stores.reloadBackground("s-kaupat"),
      open: (url) => stores.openUrl("s-kaupat", url),
      forget: () => stores.forget("s-kaupat"),
    });
    if (sKaupatViaTab) await sHost.start();
    const sWorker = sKaupatViaTab
      ? new SKaupatLibrary({
          dataDir: join(app.getPath("userData"), "retailers/s-kaupat"),
          host: { url: sHost.url, key: sHost.key },
        })
      : sKaupatWorker({
          script: join(
            app.isPackaged ? process.resourcesPath : app.getAppPath(),
            "vendor/s-kaupat/s-kaupat-mcp.cjs",
          ),
          dataDir: join(app.getPath("userData"), "retailers/s-kaupat"),
          host: sKaupatViaTab ? { url: sHost.url, key: sHost.key } : undefined,
        });
    const sKaupat = new SKaupatProvider((name, args) =>
      sWorker.call(name, args),
    );
    const sSession = new SKaupatSession(
      (name, args, timeout) => sWorker.call(name, args, timeout),
      db,
      sKaupatViaTab,
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
    // The page of the "Korikone" list on S-kaupat; null when it cannot be found, and the lists page opens instead.
    const sKaupatListId = async () => {
      if (development) return "lista-1";
      const storeId = service.journal?.review.context.storeId;
      if (!storeId) return null;
      try {
        const found = z
          .object({
            lists: z.array(z.object({ id: z.string(), name: z.string() })),
          })
          .parse(await sWorker.call("get_shopping_lists", { storeId }))
          .lists.filter((l) => l.name === "Korikone");
        return found.length === 1 ? found[0].id : null;
      } catch {
        return null;
      }
    };
    // Sign-in actions name a chain, so either chain can be signed in while the other is active.
    const chainOf = (input: unknown) =>
      input === undefined || input === null
        ? service.state.context.providerId
        : z.enum(["k-ruoka", "s-kaupat"]).parse(input);
    // At most one network check a day; development mode never reaches GitHub and shows a fixture release.
    const fixtureUpdate = {
      version: "99.0.0",
      url: "https://github.com/Vkuparin/korikone/releases/tag/v99.0.0",
    };
    const checkUpdate = async () => {
      const found = development
        ? fixtureUpdate
        : await checkForUpdate(app.getVersion(), db, async (url) => {
            const response = await net.fetch(url, {
              headers: { Accept: "application/vnd.github+json" },
              signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw new Error("updateCheckFailed");
            return response.json();
          });
      service.update = found;
    };
    let updateChecked: Promise<void> | null = null;
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
    const stores = new StoreViews(
      window,
      () => development,
      () => service.state.language,
    );
    const chainInput = z.enum(["k-ruoka", "s-kaupat"]);
    const bounds = z.object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      width: z.number().int().min(0),
      height: z.number().int().min(0),
    });
    let generationRun = 0;
    let modelLookup: AbortController | null = null;
    const requestModel = async (run: number) => {
      const preference = service.state.aiModel;
      const controller = new AbortController();
      modelLookup = controller;
      try {
        const models = await ai.models(controller.signal);
        if (run !== generationRun) throw new Error("aiCancelled");
        return chooseModel(models, preference);
      } catch (error) {
        if (run !== generationRun) throw new Error("aiCancelled");
        throw error;
      } finally {
        if (modelLookup === controller) modelLookup = null;
      }
    };
    const handoff = async () => {
      try {
        const result = await handlers.openStoreCart(undefined);
        service.handoffError = null;
        return result;
      } catch (error) {
        service.handoffError =
          error instanceof Error && /^[a-zA-Z]+$/.test(error.message)
            ? error.message
            : "operationFailed";
      }
      return service.snapshot();
    };
    const generateAI =
      (model: string, run: number) => async (prompt: string) => {
        try {
          const text = await ai.generate(model, prompt);
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
          service.developmentModel = development ? fixtureAI.lastModel : null;
          service.developmentRequests = development
            ? fixtureAI.requestCount
            : 0;
        }
      };
    const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
      getAppInfo: async () => ({ version: app.getVersion() }),
      load: async () => {
        service.developmentModelCatalogueRequests = development
          ? fixtureAI.catalogueRequests
          : 0;
        service.developmentModel = development ? fixtureAI.lastModel : null;
        updateChecked ??= checkUpdate().catch(() => {});
        // A saved answer is instant; a daily network check may finish after the first snapshot.
        await Promise.race([
          updateChecked,
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
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
        stores.reset();
        if (!enabled && !liveAIInitialized) {
          await liveAI.init();
          liveAIInitialized = true;
        }
        const next = await createService(db, enabled, [kRuoka, sKaupat]);
        // Fresh development data starts with setup done when the real profile finished it, so
        // ticking the checkbox does not send the user to the setup screen.
        if (
          enabled &&
          !next.state.onboarded &&
          service.state.onboarded &&
          service.state.setupComplete
        )
          await next.save({
            ...next.state,
            onboarded: true,
            setupComplete: true,
          });
        await db.set("development-mode", enabled);
        development = enabled;
        service = next;
        updateChecked = null;
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
        return service.refreshAfterChange(async () => {
          await service.save(input);
          const context = service.state.context;
          if (
            !development &&
            context.providerId === "s-kaupat" &&
            (before.providerId !== context.providerId ||
              before.storeId !== context.storeId)
          )
            // Best effort: Korikone always passes the store explicitly.
            await sKaupat.selectStore(context).catch(() => {});
        });
      },
      setLanguage: (input) => service.setLanguage(input),
      setAIModel: (input) => service.setAIModel(input),
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
        modelLookup?.abort();
        service.recipeDraft = null;
        service.draft = null;
        service.draftRevision = null;
        ai.cancel();
        ai.cancelRequest();
        return service.snapshot();
      },
      signOutAI: async () => {
        await ai.signOut();
        service.recipeDraft = null;
        service.draft = null;
        return service.snapshot();
      },
      modelsAI: async () => {
        await ai.models();
        return service.snapshot();
      },
      openRelease: async () => {
        // Only the release page the update check found, and never in development mode.
        if (service.update && !development)
          await shell.openExternal(service.update.url);
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
        const model = await requestModel(run);
        service.draft = null;
        service.draftRevision = null;
        service.recipeDraft = null;
        service.draft = await generateValidated(
          generateAI(model, run),
          draftPrompt(request.prompt, service.state),
          (text) => validateDraft(text, service.state),
          " The previous response failed validation. Check integer quantities, unique recipe IDs, and that every meal references an existing or new recipe. Return complete JSON only.",
        );
        service.draftRevision = revision;
        service.draftNote = request.prompt;
        return service.snapshot();
      },
      importRecipe: async (input) => {
        const request = z
          .object({
            text: z.string().trim().min(1).max(10000),
            model: z.string().default("auto"),
            consent: z.literal(true),
          })
          .parse(input);
        const run = ++generationRun;
        const model = await requestModel(run);
        service.recipeDraft = null;
        service.recipeDraft = await generateValidated(
          generateAI(model, run),
          recipePrompt(request.text, service.state),
          (text) => validateRecipe(text, service.state),
          " The previous response failed validation. Return one complete recipe object with positive integer g, ml or pcs quantities, servings from 1 to 100, and at least one ingredient. Return JSON only.",
        );
        return service.snapshot();
      },
      approveDraft: () =>
        service.refreshAfterChange(() => service.approveDraft()),
      confirmPurchase: () =>
        service.refreshAfterChange(() => service.confirmPurchase()),
      newWeek: () => service.refreshAfterChange(() => service.newWeek()),
      reuseWeek: () => service.refreshAfterChange(() => service.reuseWeek()),
      buildBasket: () => service.buildBasket(),
      compareStores: () => service.compareStores(),
      getContextOptions: (input) => service.getContextOptions(input),
      changeContext: (input) => service.changeContext(input),
      recordError: (input) => service.recordError(input),
      accept: (input) => service.accept(input),
      setPackSize: (input) => service.setPackSize(input),
      omit: (input) => service.omit(input),
      prepare: (input) => service.prepare(input),
      transferDisplayed: async (input) => {
        const result = await service.transferDisplayed(input);
        if (
          result.journal?.status === "verified" &&
          !result.review &&
          !result.transferException
        )
          return handoff();
        return result;
      },
      execute: async (input) => {
        const result = await service.execute(input);
        if (result.journal?.status === "verified") return handoff();
        return result;
      },
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
          if (chain === "k-ruoka" || chain === "s-kaupat") {
            await stores.open(chain, "login");
            return { ...service.snapshot(), openStore: chain };
          }
          service.storeLogins[chain] = "signedIn";
          return service.snapshot();
        }
        if (chain === "s-kaupat") {
          if (sKaupatViaTab) {
            // Sign-in happens in the Kauppa tab; Asetukset checks it when it is opened again.
            await stores.open("s-kaupat", "login");
            return { ...service.snapshot(), openStore: "s-kaupat" };
          }
          loginSKaupat();
          return service.snapshot();
        }
        if (kRuokaViaSite) {
          // Sign-in happens in the Kauppa tab; Asetukset checks it when it is opened again.
          await stores.open("k-ruoka", "login");
          return { ...service.snapshot(), openStore: "k-ruoka" };
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
        if (development) {
          if (chain === "k-ruoka" || chain === "s-kaupat")
            service.storeLogins[chain] = (await stores.fixtureAccount(chain))
              ? "signedIn"
              : "notStarted";
          return service.snapshot();
        }
        if (chain === "s-kaupat") {
          if (!sLogin)
            service.storeLogins["s-kaupat"] = (await sSession.signedIn())
              ? "signedIn"
              : "notStarted";
          return service.snapshot();
        }
        if (kRuokaViaSite) {
          const storeId = kRuokaStore();
          service.storeLogins["k-ruoka"] =
            storeId &&
            z
              .object({ loggedIn: z.boolean() })
              .parse(
                await kRuokaSite.call("auth_status", { store_id: storeId }),
              ).loggedIn
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
        if (!kRuokaViaSite) await worker.call("cancel_login", {});
        service.storeLogins["k-ruoka"] = "notStarted";
        return service.snapshot();
      },
      logoutStore: async (input) => {
        const chain = chainOf(input);
        if (development) {
          if (chain === "k-ruoka" || chain === "s-kaupat")
            await stores.forget(chain);
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
          !providerId
        )
          throw new Error("reviewRequired");
        const currentCart = await service.registry
          .get(providerId)
          .getCart(service.journal.review.context);
        if (currentCart.accountId !== service.journal.review.baseline.accountId)
          throw new Error("accountChanged");

        if (development && service.developmentScenario === "handoffFailed")
          throw new Error("operationFailed");
        if (providerId.startsWith("demo-")) {
          service.developmentHandoffs.push(`${providerId}:basket`);
          service.handoffError = null;
          return service.snapshot();
        }
        if (providerId !== "k-ruoka" && providerId !== "s-kaupat")
          throw new Error("unsupported");
        if (!development && providerId === "s-kaupat" && !sKaupatViaTab) {
          if (!(await sSession.signedIn())) throw new Error("loginRequired");
          await sWorker.call("open_site", { applyChoice: false });
          service.handoffError = null;
          return service.snapshot();
        }
        if (!development && providerId === "k-ruoka" && !kRuokaViaSite) {
          await worker.handoff();
          service.handoffError = null;
          return service.snapshot();
        }
        const listId = providerId === "s-kaupat" ? await sKaupatListId() : null;
        if (listId) await stores.openList("s-kaupat", listId);
        else await stores.open(providerId, "cart");
        if (development)
          service.developmentHandoffs.push(
            providerId === "s-kaupat" ? "s-kaupat:list" : "k-ruoka:basket",
          );
        service.handoffError = null;
        return { ...service.snapshot(), openStore: providerId };
      },
      storeView: async (input) => {
        const { chain, area } = z
          .object({ chain: chainInput, area: bounds })
          .parse(input);
        await stores.show(chain, area);
        return service.snapshot();
      },
      hideStore: async () => {
        stores.hide();
        return service.snapshot();
      },
      storeAction: async (input) => {
        const { chain, action } = z
          .object({
            chain: chainInput,
            action: z.enum(["back", "reload", "browser"]),
          })
          .parse(input);
        await stores.action(chain, action);
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
            JSON.stringify(await service.exportBackup(), null, 2),
            "utf8",
          );
        return service.snapshot();
      },
      exportDiagnostics: async () => {
        const report = JSON.stringify(
          diagnostics(
            service.snapshot(),
            {
              app: app.getVersion(),
              electron: process.versions.electron,
              platform: `${process.platform} ${process.arch}`,
              packaged: String(app.isPackaged),
            },
            await service.errorLog(),
          ),
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
          const raw = JSON.parse(await readFile(filePaths[0], "utf8"));
          stateSchema.parse(raw);
          await db.set(
            `${development ? "development:" : ""}backup-${Date.now()}`,
            service.state,
          );
          return service.importBackup(raw);
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
            name === "storeView" ||
            name === "hideStore" ||
            name === "storeAction" ||
            name === "load"
          ) {
            const value = (await handler(input)) as object;
            service.ai = ai.status();
            return { ok: true, value: { ...value, ai: service.ai } };
          }
          const submittedRun = generationRun;
          const pending = queue.then(() => {
            if (
              (name === "generate" || name === "importRecipe") &&
              submittedRun !== generationRun
            )
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
      sHost.close();
      void Promise.allSettled([worker.close(), sWorker.close(), stores.flush()])
        .finally(() => stores.close())
        .finally(() => db.close())
        .finally(() => app.quit());
    });
  });
app.on("window-all-closed", () => app.quit());
