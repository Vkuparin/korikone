import { app, BrowserWindow, ipcMain, dialog } from "electron";
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
if (process.env.KORIKONE_TEST_DATA)
  app.setPath("userData", process.env.KORIKONE_TEST_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(async () => {
    const db = new Database(join(app.getPath("userData"), "korikone.sqlite"));
    const service = new Service(db);
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
      width: 1280,
      height: 900,
      minWidth: 680,
      minHeight: 600,
      backgroundColor: "#f5f4ef",
      webPreferences: {
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
          return service.save(next);
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
            name === "load"
          )
            return { ok: true, value: await handler(input) };
          const pending = queue.then(() => handler(input));
          queue = pending.catch(() => {});
          return { ok: true, value: await pending };
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
      void worker
        .close()
        .finally(() => db.close())
        .finally(() => app.quit());
    });
  });
app.on("window-all-closed", () => app.quit());
