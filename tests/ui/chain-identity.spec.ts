import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("chain identity follows only the committed shopping context, from first paint to restore", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-chain-identity-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-chain", "k");
    const events = () =>
      page.evaluate(
        () => (window as unknown as { chainEvents: unknown[] }).chainEvents,
      );
    const start = await page.evaluate(async () => {
      const probe = window as unknown as { chainEvents: unknown[] };
      probe.chainEvents = [];
      window.korikone.onAppearanceChange((value) =>
        probe.chainEvents.push(value),
      );
      const loaded = await window.korikone.load();
      return {
        bootstrap: window.korikone.getAppearanceBootstrap(),
        snapshot: loaded.value,
      };
    });
    expect(start.bootstrap).toMatchObject({ chain: "k" });
    expect(start.snapshot.state.context.providerId).toBe("demo-k");

    const stores = await page.evaluate(async () => {
      const api = window.korikone;
      // Opening a selector and searching are provisional: nothing is committed.
      await api.getContextOptions();
      const search = (await api.searchStores("alternate")).value;
      return {
        k: search.storeResults.find((c) => c.providerId === "k-ruoka")!,
        s: search.storeResults.find((c) => c.providerId === "s-kaupat")!,
        revision: search.state.revision,
      };
    });
    expect(await events()).toEqual([]);

    // Another store and another fulfilment of the same chain keep the accent.
    const sameChain = await page.evaluate(async ({ k, revision }) => {
      const api = window.korikone;
      const store = await api.changeContext({ context: k, revision });
      const delivery = await api.changeContext({
        context: { ...k, fulfillment: "delivery" },
        revision: store.value.state.revision,
      });
      return {
        ok: store.ok && delivery.ok,
        context: delivery.value.state.context,
        revision: delivery.value.state.revision,
      };
    }, stores);
    expect(sameChain.ok).toBe(true);
    expect(sameChain.context).toMatchObject({
      providerId: "k-ruoka",
      fulfillment: "delivery",
    });
    await expect(html).toHaveAttribute("data-chain", "k");
    expect(await events()).toEqual([]);

    // A failed switch to the other chain commits nothing and keeps the accent.
    const failed = await page.evaluate(async (revision) => {
      const api = window.korikone;
      const search = (await api.searchStores("pickup-only")).value;
      const s = search.storeResults.find((c) => c.providerId === "s-kaupat")!;
      const result = await api.changeContext({
        context: { ...s, fulfillment: "delivery" },
        revision,
      });
      const current = (await api.load()).value.state.context.providerId;
      return { ok: result.ok, error: result.error, current };
    }, sameChain.revision);
    expect(failed).toEqual({
      ok: false,
      error: "fulfillmentUnavailable",
      current: "k-ruoka",
    });
    await expect(html).toHaveAttribute("data-chain", "k");
    expect(await events()).toEqual([]);
    await page.evaluate(() => window.korikone.searchStores("alternate"));

    // The confirmed switch publishes once, after the context is committed.
    const before = await page.evaluate(async () => {
      const value = (await window.korikone.load()).value;
      return {
        sequence: window.korikone.getAppearanceBootstrap().sequence,
        requests: value.developmentRequests,
      };
    });
    const switched = await page.evaluate(
      async ({ s, revision }) =>
        window.korikone.changeContext({ context: s, revision }),
      { s: stores.s, revision: sameChain.revision },
    );
    expect(switched.ok).toBe(true);
    expect(switched.value.state.context.providerId).toBe("s-kaupat");
    await expect(html).toHaveAttribute("data-chain", "s");
    expect(await events()).toEqual([
      expect.objectContaining({ chain: "s", sequence: before.sequence + 1 }),
    ]);
    // Reading and applying the identity asks nothing of the catalogue or the model.
    const quiet = await page.evaluate(async () => {
      const first = (await window.korikone.load()).value;
      for (let i = 0; i < 5; i++) window.korikone.getAppearanceBootstrap();
      const second = (await window.korikone.load()).value;
      return [
        second.developmentCatalogueRequests -
          first.developmentCatalogueRequests,
        second.developmentRequests,
        window.korikone.getAppearanceBootstrap(),
      ];
    });
    expect(quiet).toEqual([
      0,
      before.requests,
      expect.objectContaining({ chain: "s", sequence: before.sequence + 1 }),
    ]);

    // Restart: the saved context decides the accent before the first frame.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        (window as unknown as { firstChain: unknown }).firstChain =
          document.documentElement.dataset.chain;
      });
    });
    await page.reload();
    await page.waitForFunction(() => !!window.korikone);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { firstChain: unknown }).firstChain,
        ),
      )
      .toBe("s");
    expect(
      await page.evaluate(() => window.korikone.getAppearanceBootstrap()),
    ).toMatchObject({ chain: "s", sequence: 0 });

    // An ordinary save that adopts another chain's store, as comparison and Settings do.
    const saved = await page.evaluate(async () => {
      const probe = window as unknown as { chainEvents: unknown[] };
      probe.chainEvents = [];
      window.korikone.onAppearanceChange((value) =>
        probe.chainEvents.push(value),
      );
      const state = (await window.korikone.load()).value.state;
      const k = state.stores["k-ruoka"];
      const result = await window.korikone.save({ ...state, context: k });
      return { ok: result.ok, state: result.value.state };
    });
    expect(saved.ok).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-chain", "k");

    // Restoring a backup whose saved context is the other chain.
    const backup = join(data, "backup.json");
    await writeFile(
      backup,
      JSON.stringify({
        ...saved.state,
        context: saved.state.stores["s-kaupat"],
      }),
    );
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    }, backup);
    const restored = await page.evaluate(() => window.korikone.importData());
    expect(restored.ok).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-chain", "s");
    expect(
      (
        (await page.evaluate(
          () => (window as unknown as { chainEvents: unknown[] }).chainEvents,
        )) as { chain: string; sequence: number }[]
      ).map((event) => [event.chain, event.sequence]),
    ).toEqual([
      ["k", 1],
      ["s", 2],
    ]);
  } finally {
    await app.close();
  }
});
