import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("quit during the committing event drains SQLite and restores the complete plan", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-shutdown-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.staples = [];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.signInAI();
    }, state);
    const planned = await page.evaluate(() =>
      window.korikone.planShopping({ prompt: "1 l maitoa", consent: true }),
    );
    expect(planned.ok, planned.error).toBe(true);
    await app.evaluate(({ app, BrowserWindow }) => {
      process.once("uncaughtException", (error) => {
        console.error(error);
        app.exit(2);
      });
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]) => {
        send(channel, ...args);
        if (
          channel === "app:planningChanged" &&
          (args[0] as { phase: string }).phase === "committing"
        )
          app.quit();
      };
    });
    const exited = new Promise<number | null>((resolve) =>
      app.process().once("exit", resolve),
    );
    await page
      .evaluate((operationId) => {
        void window.korikone.commitPlanning({ operationId }).catch(() => {});
      }, planned.value.planning!.operationId)
      .catch(() => {});
    expect(await exited).toBe(0);
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restored = (await page.evaluate(() => window.korikone.load())).value;
    expect(restored.state.note).toBe("1 l maitoa");
    expect(restored.basket).toHaveLength(1);
    expect(restored.basket[0]).toMatchObject({
      requirement: { amount: 1000, unit: "ml" },
      product: { id: "milk" },
    });
    expect(restored.quotedAt).not.toBeNull();
    expect(restored.planning).toBeNull();
    expect(restored.developmentRequests).toBe(0);
    expect(restored.developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});
