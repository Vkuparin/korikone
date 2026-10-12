import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";
import { receiptTextPDF } from "../fixtures/receipts/pdf";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;

test("receipt import API reads real files locally, dedupes across formats and keeps failures harmless", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-receipt-api-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const files = {
    pdf: join(data, "two-pages.pdf"),
    txt: join(data, "two-pages.txt"),
    k: join(data, "k.txt"),
    bill: join(data, "bill.txt"),
    broken: join(data, "broken.pdf"),
    empty: join(data, "empty.txt"),
  };
  await writeFile(files.pdf, receiptTextPDF(fixture("s-multi-page").pages));
  await writeFile(files.txt, fixtureText(fixture("s-multi-page")), "utf8");
  await writeFile(files.k, fixtureText(fixture("k-weighed")), "utf8");
  await writeFile(
    files.bill,
    fixtureText(fixture("unknown-restaurant-bill")),
    "utf8",
  );
  await writeFile(files.broken, "not a pdf");
  await writeFile(files.empty, "  \n");
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    // The example list prices itself after setup; wait so that later counts belong to imports.
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value.quotedAt,
      )
      .not.toBeNull();
    const before = (await page.evaluate(() => window.korikone.load())).value;
    const pick = async (path: string | null, input?: unknown) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: path === null,
          filePaths: path === null ? [] : [path],
        });
      }, path);
      return page.evaluate(
        (input) => window.korikone.importPurchaseReceipt(input),
        input,
      );
    };

    const cancelled = await pick(null);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.value.purchaseImport).toBeNull();

    const pdf = await pick(files.pdf);
    expect(pdf.value.purchaseImport).toMatchObject({
      source: "receipt",
      outcome: "added",
      lines: 15,
      unreadableLines: 0,
      reconciliation: "balanced",
    });
    // The text file of the same receipt is the same trip.
    expect((await pick(files.txt)).value.purchaseImport).toMatchObject({
      outcome: "duplicate",
    });
    expect(
      (await pick(files.k, { keepOriginal: true })).value.purchaseImport,
    ).toMatchObject({ outcome: "added", reconciliation: "balanced" });
    expect((await pick(files.bill)).value.purchaseImport).toMatchObject({
      outcome: "unsupported",
      eventId: null,
      reconciliation: null,
    });
    // The reader's own errors are kept, and a failure changes nothing.
    expect(await pick(files.broken)).toMatchObject({
      ok: false,
      error: "receiptUnreadable",
    });
    expect(await pick(files.empty)).toMatchObject({
      ok: false,
      error: "receiptNoText",
    });
    expect((await pick(files.txt, { keepOriginal: "yes" })).ok).toBe(false);

    const after = (await page.evaluate(() => window.korikone.load())).value;
    expect(after.state).toEqual(before.state);
    expect(after.basket).toEqual(before.basket);
    expect([
      after.developmentRequests,
      after.developmentStoreWrites,
      after.developmentCatalogueRequests - before.developmentCatalogueRequests,
    ]).toEqual([0, 0, 0]);

    // Review, correction and one consented enrichment request through the same IPC.
    type Listed = {
      receipts: {
        purchases: {
          eventId: string;
          chain: string;
          revision: number;
          lines: {
            id: string;
            review: string[];
            quantity: { amount: number };
          }[];
        }[];
      };
      developmentAIProvider: string | null;
    };
    const list = async () =>
      (await page.evaluate(() => window.korikone.listPurchases()))
        .value as unknown as Listed;
    const listed = await list();
    expect(listed.receipts.purchases.map((p) => p.chain).sort()).toEqual([
      "k-group",
      "s-group",
    ]);
    const k = listed.receipts.purchases.find((p) => p.chain === "k-group")!;
    expect(k.lines.map((l) => l.review)).toEqual([
      ["uninterpreted"],
      ["uninterpreted"],
    ]);
    const providerId = listed.developmentAIProvider ?? "chatgpt";
    const enriched = await page.evaluate(
      async ({ eventId, providerId }) => {
        await window.korikone.signInAI();
        return window.korikone.enrichPurchase({
          eventId,
          consent: { providerId, scope: 1 },
        });
      },
      { eventId: k.eventId, providerId },
    );
    expect(enriched.value.receiptEnrichment).toMatchObject({
      status: "enriched",
      accepted: 1,
      unresolved: 1,
    });
    expect(
      (await page.evaluate(() => window.korikone.load())).value
        .developmentRequests,
    ).toBe(1);
    const corrected = await page.evaluate(
      (eventId) =>
        window.korikone.correctPurchase({
          eventId,
          lineId: "l1",
          revision: 1,
          field: "quantity",
          amount: 900,
          unit: "g",
        }),
      k.eventId,
    );
    expect(corrected.ok).toBe(true);
    const afterCorrection = (await list()).receipts.purchases.find(
      (p) => p.eventId === k.eventId,
    )!;
    expect(afterCorrection.revision).toBe(2);
    expect(afterCorrection.lines[0].quantity.amount).toBe(900);
    expect(
      await page.evaluate(
        (eventId) =>
          window.korikone.correctPurchase({
            eventId,
            lineId: "l1",
            revision: 1,
            field: "quantity",
            amount: 1,
            unit: "g",
          }),
        k.eventId,
      ),
    ).toMatchObject({ ok: false, error: "purchaseStale" });

    // The backup has both purchases, sanitized, and no retained original unless asked for.
    const backup = join(data, "backup.json");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, backup);
    await page.evaluate(() => window.korikone.exportData());
    const saved = JSON.parse(
      await (await import("node:fs/promises")).readFile(backup, "utf8"),
    );
    expect(
      saved.purchases.events.map((e: { chain: string; lines: unknown[] }) => [
        e.chain,
        e.lines.length,
      ]),
    ).toEqual([
      ["s-group", 5],
      ["k-group", 2],
    ]);
    expect(
      saved.purchases.sources.map((s: { retention: string }) => s.retention),
    ).toEqual(["sanitized", "original"]);
    expect("purchaseOriginals" in saved).toBe(false);

    // The explicit legacy import after a restart: one receipt leaves the old text, a note stays.
    await page.evaluate(
      async (text) => {
        const state = (await window.korikone.load()).value.state;
        const saved = await window.korikone.save({
          ...state,
          receiptText: text,
        });
        if (!saved.ok) throw new Error(saved.error);
      },
      `Oma muistiinpano\n${fixtureText(fixture("s-basic-campaign"))}`,
    );
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const legacy = await page.evaluate(() =>
      window.korikone.importLegacyReceipts(),
    );
    expect(legacy.value.purchaseImport).toEqual({
      source: "legacy",
      added: 1,
      updated: 0,
      duplicate: 0,
      unsupported: 1,
    });
    expect(legacy.value.state.receiptText).toBe("Oma muistiinpano");
    expect(legacy.value.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
