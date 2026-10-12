import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;

/**
 * F6.20 and F18.5: one development journey through the real reader, IPC, parsers, validation,
 * persistence and UI. Orders and receipts become purchase evidence; memory, suggestions and the
 * model context follow from it; consent, deletion, backup and restart behave; a repeated list
 * stays duplicate-safe. Every response is a local fixture and no retailer is written except the
 * one explicit transfer.
 */
test("purchase evidence, memory, consent, backup, restart and repeat stay local, exact and separate from preferences", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-journey-purchases-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const today = new Date();
  const date = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  const dated = (id: string, from: string) =>
    fixtureText(fixture(id)).replace(from, `${date} 11:30`);
  const files = {
    receipt: join(data, "today.txt"),
    same: join(data, "same.txt"),
    broken: join(data, "broken.txt"),
    backup: join(data, "backup.json"),
  };
  await writeFile(
    files.receipt,
    dated("s-non-food-subtotals", "19.10.2026 11:30"),
    "utf8",
  );
  await writeFile(
    files.same,
    dated("s-non-food-subtotals", "19.10.2026 11:30"),
    "utf8",
  );
  await writeFile(files.broken, "no receipt here", "utf8");

  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    const insights = async () =>
      (
        (await page.evaluate(() => window.korikone.purchaseInsights()))
          .value as unknown as {
          insights: {
            suggestions: { key: string; label: string }[];
            observedSummaries: unknown[];
            actualPurchases: { total: number | null }[];
            aliases: { key: string }[];
          };
        }
      ).insights;
    const pick = async (path: string | null) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: path === null,
          filePaths: path === null ? [] : [path],
        });
      }, path);
    };
    const importReceipt = async (path: string, input?: unknown) => {
      await pick(path);
      return page.evaluate(
        (input) => window.korikone.importPurchaseReceipt(input),
        input,
      );
    };

    // Sample S-kaupat store with the development order history, AI connected.
    await page.evaluate(async () => {
      const api = window.korikone;
      await api.signInAI();
      const state = (await api.load()).value.state;
      const saved = await api.save({
        ...state,
        staples: [],
        context: {
          providerId: "demo-s",
          storeId: "demo-helsinki",
          storeName: "S-kaupat · Helsinki (demo)",
          fulfillment: "pickup",
        },
      });
      if (!saved.ok) throw new Error(saved.error);
      await api.scenario("history");
    });
    const start = await load();
    const preferences = start.state.categoryPreferences;

    // Orders and a receipt become evidence; duplicates and bad files add nothing.
    const orders = await page.evaluate(() => window.korikone.importOrders());
    expect(orders.value.purchaseImport).toMatchObject({
      source: "orders",
      updated: 0,
    });
    const added = await importReceipt(files.receipt);
    expect(added.value.purchaseImport).toMatchObject({
      outcome: "added",
      reconciliation: "balanced",
    });
    expect(
      (await importReceipt(files.same)).value.purchaseImport,
    ).toMatchObject({ outcome: "duplicate" });
    expect(
      (await importReceipt(files.broken)).value.purchaseImport,
    ).toMatchObject({ outcome: "unsupported" });
    const afterImport = await load();
    expect(afterImport.developmentRequests).toBe(0);
    expect(afterImport.developmentStoreWrites).toBe(0);
    // Observations never become a binding preference.
    expect(afterImport.state.categoryPreferences).toEqual(preferences);
    const first = await insights();
    expect(first.actualPurchases.some((p) => p.total === 893)).toBe(true);
    expect(first.suggestions.length).toBeGreaterThan(0);
    expect(first.suggestions.length).toBeLessThanOrEqual(5);

    // Consent: off by default, so a new receipt asks nothing; one receipt is one explicit request.
    const provider = afterImport.developmentAIProvider ?? "chatgpt";
    const listed = (
      (await page.evaluate(() => window.korikone.listPurchases()))
        .value as unknown as {
        receipts: {
          consent: { automatic: unknown; asked: boolean };
          dataScope: number;
          purchases: { eventId: string }[];
        };
      }
    ).receipts;
    expect(listed.consent.automatic).toBeNull();
    const eventId = listed.purchases[0].eventId;
    const requests = (await load()).developmentRequests;
    const enriched = await page.evaluate(
      ({ eventId, provider, scope }) =>
        window.korikone.enrichPurchase({
          eventId,
          consent: { providerId: provider, scope },
        }),
      { eventId, provider, scope: listed.dataScope },
    );
    expect(enriched.ok).toBe(true);
    expect((await load()).developmentRequests - requests).toBeLessThanOrEqual(
      1,
    );
    // A consent for another provider does not authorise this one.
    const wrong = await page.evaluate(
      ({ eventId, scope }) =>
        window.korikone.enrichPurchase({
          eventId,
          consent: { providerId: "someone-else", scope },
        }),
      { eventId, scope: listed.dataScope },
    );
    expect(wrong.value?.receiptEnrichment?.status ?? "skipped").toBe("skipped");

    // Backup carries sanitized purchases and no consent or original unless asked for.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, files.backup);
    await page.evaluate(() => window.korikone.exportData());
    const backup = await readFile(files.backup, "utf8");
    expect(backup).toContain("purchases");
    expect(backup).not.toContain("purchaseOriginals");
    expect(backup).not.toContain("fixture-order");
    const diagnostics = JSON.stringify(
      await page.evaluate(() =>
        window.korikone.recordError({
          code: "journey",
          view: "data",
        }),
      ),
    );
    expect(diagnostics).not.toMatch(/Esimerkki|ASTIANPESUAINE|KEVYTMAITO/);

    // Restart keeps evidence, suggestions and the local-only state.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await page.evaluate(() => window.korikone.scenario("history"));
    const restarted = await insights();
    expect(restarted.suggestions.map((s) => s.key)).toEqual(
      first.suggestions.map((s) => s.key),
    );
    expect(restarted.actualPurchases).toHaveLength(
      first.actualPurchases.length,
    );

    // Forgetting interpretations removes what the model could be told; facts stay.
    const events = (
      (await page.evaluate(() => window.korikone.listPurchases()))
        .value as unknown as {
        receipts: { purchases: { eventId: string }[] };
      }
    ).receipts.purchases;
    for (const p of events)
      await page.evaluate(
        (eventId) =>
          window.korikone.deletePurchase({ eventId, scope: "annotations" }),
        p.eventId,
      );
    const forgotten = await insights();
    expect(forgotten.observedSummaries).toEqual([]);
    expect(forgotten.actualPurchases).toHaveLength(
      first.actualPurchases.length,
    );

    // A repeated transfer is duplicate-safe: the unchanged list writes nothing a second time.
    const repeated = await page.evaluate(async () => {
      const api = window.korikone;
      await api.signInAI();
      const state = (await api.load()).value.state;
      const saved = await api.save({
        ...state,
        meals: [],
        extras: [
          { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
          { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
        ],
        household: { ...state.household, budget: 1_000_000 },
      });
      if (!saved.ok) throw new Error(saved.error);
      const built = (await api.buildBasket()).value;
      const requested = await api.transferDisplayed({
        revision: built.state.revision,
        quotedAt: built.quotedAt,
        batchKey: built.transferBatchKey,
      });
      if (!requested.ok) throw new Error(requested.error);
      const review = requested.value.review;
      const done = review
        ? await api.execute({ id: review.id, acknowledged: true })
        : requested;
      if (!done.ok) throw new Error(done.error);
      const writes = done.value.developmentStoreWrites;
      const entry = done.value.state.listHistory[0].id;
      await api.newWeek();
      const again = await api.repeatList({
        historyId: entry,
        revision: (await api.load()).value.state.revision,
      });
      if (!again.ok) throw new Error(again.error);
      const second = await api.transferDisplayed({
        revision: again.value.state.revision,
        quotedAt: again.value.quotedAt,
        batchKey: again.value.transferBatchKey,
      });
      return {
        writes,
        after: second.ok ? second.value.developmentStoreWrites : -1,
        requests: again.value.developmentRequests,
        repeat: again.value.repeat?.rows ?? null,
      };
    });
    expect(repeated.repeat).toBe(2);
    expect(repeated.after).toBe(repeated.writes);
  } finally {
    await app.close();
  }
});
