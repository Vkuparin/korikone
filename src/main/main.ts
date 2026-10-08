import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
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
import { ChatGPT } from "../ai/chatgpt";
import { draftPrompt, validateDraft } from "../ai/draft";
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
    await service.init();
    const ui = fileURLToPath(new URL("../ui/index.html", import.meta.url));
    const window = new BrowserWindow({
      show: process.env.KORIKONE_TEST_HIDDEN !== "1",
      width: 1280,
      height: 900,
      minWidth: 680,
      minHeight: 600,
      backgroundColor: "#f5f4ef",
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
      save: (input) => service.save(input),
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
        const text = await ai.generate(
          request.model,
          draftPrompt(request.prompt, service.state),
        );
        service.draft = validateDraft(text, service.state);
        service.draftRevision = revision;
        return service.snapshot();
      },
      approveDraft: () => service.approveDraft(),
      confirmPurchase: () => service.confirmPurchase(),
      buildBasket: () => service.buildBasket(),
      accept: (input) => service.accept(input),
      prepare: () => service.prepare(),
      execute: (input) => service.execute(input),
      recover: () => service.recover(),
      scenario: (input) => service.scenario(input),
      searchStores: async (input) => {
        if (service.busy) throw new Error("busy");
        service.storeResults = await service.registry
          .get("k-ruoka")
          .searchStores(z.string().min(2).max(150).parse(input));
        return service.snapshot();
      },
      loginStore: async () => {
        if (service.busy) throw new Error("busy");
        const result = z
          .object({ state: z.string() })
          .parse(await worker.call("start_login", {}));
        service.storeLogin = result.state;
        return service.snapshot();
      },
      checkStoreLogin: async () => {
        if (service.busy) throw new Error("busy");
        const result = z
          .object({ state: z.string() })
          .parse(await worker.call("login_status", {}));
        service.storeLogin = result.state;
        if (result.state === "notStarted") {
          const auth = z
            .object({ loggedIn: z.boolean() })
            .parse(await worker.call("auth_status", {}));
          service.storeLogin = auth.loggedIn ? "signedIn" : "notStarted";
        }
        return service.snapshot();
      },
      cancelStoreLogin: async () => {
        await worker.call("cancel_login", {});
        service.storeLogin = "notStarted";
        return service.snapshot();
      },
      openStoreCart: async () => {
        if (
          service.busy ||
          service.journal?.status !== "verified" ||
          service.journal.review.context.providerId !== "k-ruoka"
        )
          throw new Error("reviewRequired");
        await worker.handoff();
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
      void worker
        .close()
        .finally(() => db.close())
        .finally(() => app.quit());
    });
  });
app.on("window-all-closed", () => app.quit());
