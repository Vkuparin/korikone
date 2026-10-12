import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { diagnostics } from "../src/application/diagnostics";
import { receiptFingerprint } from "../src/application/purchases";
import {
  PURCHASES_KEY,
  purchaseOriginalKey,
  type PurchaseLedger,
} from "../src/domain/purchases";
import { parseReceipt } from "../src/receipts/parsers";
import { readReceipt } from "../src/receipts/read";
import { fixtureText, receiptFixtures } from "./fixtures/receipts";
import { receiptTextPDF } from "./fixtures/receipts/pdf";
import { memoryStorage } from "./helpers/purchase-fixtures";

const fixture = (id: string, format = "txt") =>
  receiptFixtures.find((f) => f.id === id && f.format === format)!;
async function profile() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  await service.init();
  return { ...store, service };
}
const receipt = (service: Service, id: string, extra = {}) =>
  service.importReceiptText({
    text: fixtureText(fixture(id)),
    format: "txt",
    ...extra,
  });

test("a receipt is committed whole: source, evidence, balance and rule interpretations", async () => {
  const { service, entries } = await profile();
  const state = structuredClone(service.state);
  const snapshot = await receipt(service, "s-multiple-milk");
  expect(snapshot.purchaseImport).toMatchObject({
    source: "receipt",
    outcome: "added",
    lines: fixture("s-multiple-milk").source.lines,
    unreadableLines: 0,
    reconciliation: "balanced",
  });
  const ledger = entries.get(PURCHASES_KEY) as PurchaseLedger;
  expect(ledger.sources).toHaveLength(1);
  expect(ledger.sources[0]).toMatchObject({
    kind: "receipt",
    chain: "s-group",
    format: "txt",
    parser: { id: "s-group", version: 1 },
    retention: "sanitized",
    revision: 1,
    pages: 1,
  });
  expect(ledger.events[0].id).toBe(ledger.sources[0].id);
  expect(ledger.events[0].lines).toHaveLength(5);
  // Milk variants stay separate facts and separate rule interpretations; oat drink gets none.
  expect(
    ledger.annotations.map((a) => [
      a.lineId,
      a.origin,
      a.category,
      a.qualifiers.map((q) => q.value),
    ]),
  ).toEqual([
    ["l1", "rule", "milk", ["semi-skimmed"]],
    ["l2", "rule", "milk", ["skimmed"]],
    ["l3", "rule", "milk", ["semi-skimmed", "free"]],
    ["l5", "rule", "milk", ["semi-skimmed"]],
  ]);
  // A purchase is not shopping state: nothing else moved and nothing outside was called.
  expect(service.state).toEqual(state);
  expect(entries.has(purchaseOriginalKey(ledger.sources[0].id))).toBe(false);
});

test("an exact repeat, and the same trip as a PDF, create no event; another day is its own", async () => {
  const { service, entries } = await profile();
  await receipt(service, "trip-original");
  const stored = JSON.stringify(entries.get(PURCHASES_KEY));
  expect(
    (await receipt(service, "trip-original")).purchaseImport,
  ).toMatchObject({
    outcome: "duplicate",
  });
  // The PDF of the same text has other spacing and another format, and is the same trip.
  const pdf = fixture("trip-original", "pdf");
  const asRead = fixtureText(pdf)
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n");
  expect(
    (await service.importReceiptText({ text: asRead, format: "pdf" }))
      .purchaseImport,
  ).toMatchObject({ outcome: "duplicate" });
  expect(JSON.stringify(entries.get(PURCHASES_KEY))).toBe(stored);
  expect(
    (await receipt(service, "trip-distinct")).purchaseImport,
  ).toMatchObject({
    outcome: "added",
  });
  const ledger = await service.purchases.ledger();
  expect(ledger.events.map((e) => e.purchasedAt)).toEqual([
    "2026-10-27T14:20:00.000Z",
    "2026-11-03T14:25:00.000Z",
  ]);
  expect(new Set(ledger.sources.map((s) => s.fingerprint)).size).toBe(2);
});

test("payment, card and loyalty rows are in no fingerprint, record, backup or diagnostic", async () => {
  const { service } = await profile();
  const base = fixtureText(fixture("trip-original"));
  const trailer = (card: string) =>
    `${base}\nKORTTI ************${card}\nVIITE 1234567890123456\nBONUSKORTTI 9246 0000 1111 ${card}\nasiakas@example.test`;
  const one = parseReceipt(trailer("4321"));
  const two = parseReceipt(trailer("8765"));
  if (one.outcome !== "event" || two.outcome !== "event")
    throw new Error("unsupported");
  expect(receiptFingerprint(one)).toBe(receiptFingerprint(two));
  expect(receiptFingerprint(one)).toMatch(/^[0-9a-f]{64}$/);
  await service.importReceiptText({ text: trailer("4321"), format: "txt" });
  expect(
    (await service.importReceiptText({ text: trailer("8765"), format: "txt" }))
      .purchaseImport,
  ).toMatchObject({ outcome: "duplicate" });
  const everything = JSON.stringify([
    await service.purchases.ledger(),
    await service.exportBackup(),
    service.snapshot().purchaseImport,
    diagnostics(service.snapshot(), {}),
  ]);
  expect(everything).not.toMatch(
    /4321|8765|9246|1234567890|asiakas|KORTTI|VIITE/,
  );
  // Only an explicit choice keeps the original, and a later repeat can add it without a new event.
  const kept = await service.importReceiptText({
    text: trailer("4321"),
    format: "txt",
    keepOriginal: true,
  });
  expect(kept.purchaseImport).toMatchObject({ outcome: "duplicate" });
  const ledger = await service.purchases.ledger();
  expect(ledger.events).toHaveLength(1);
  expect(ledger.sources[0].retention).toBe("original");
  expect(await service.purchases.original(ledger.sources[0].id)).toContain(
    "KORTTI",
  );
  expect(JSON.stringify(await service.exportBackup())).not.toContain("KORTTI");
});

test("unreadable and unbalanced receipts keep their evidence and counts; unsupported files add nothing", async () => {
  const { service, entries } = await profile();
  expect(
    (await receipt(service, "partial-missing-total")).purchaseImport,
  ).toMatchObject({
    outcome: "added",
    unreadableLines: 1,
    reconciliation: "incomplete",
  });
  expect(
    (await receipt(service, "unbalanced-total")).purchaseImport,
  ).toMatchObject({
    outcome: "added",
    reconciliation: "unbalanced",
  });
  const ledger = await service.purchases.ledger();
  expect(ledger.events[0].lines.map((l) => l.role)).toEqual([
    "product",
    "unreadable",
    "product",
  ]);
  expect(ledger.events[1].reconciliation).toMatchObject({ difference: -10 });
  const stored = JSON.stringify(entries.get(PURCHASES_KEY));
  for (const id of ["unknown-restaurant-bill", "unknown-plain-note"]) {
    const f = fixture(id);
    expect((await receipt(service, id)).purchaseImport).toEqual({
      source: "receipt",
      outcome: "unsupported",
      eventId: null,
      lines: f.source.lines,
      unreadableLines: f.source.lines,
      reconciliation: null,
    });
  }
  expect(JSON.stringify(entries.get(PURCHASES_KEY))).toBe(stored);
  for (const invalid of [
    { text: "", format: "txt" },
    { text: "x".repeat(50_001), format: "txt" },
    { text: "x", format: "docx" },
    { text: "x", format: "txt", revision: 1 },
  ])
    await expect(service.importReceiptText(invalid)).rejects.toThrow();
});

test("a failed write rolls back, a lost acknowledgement is not repeated and a restart keeps history", async () => {
  const { service, storage, entries, failNext } = await profile();
  await receipt(service, "trip-original");
  const before = JSON.stringify(entries.get(PURCHASES_KEY));
  failNext("before");
  await expect(receipt(service, "trip-distinct")).rejects.toThrow(
    "storageFailed",
  );
  expect(JSON.stringify(entries.get(PURCHASES_KEY))).toBe(before);
  failNext("after");
  expect(
    (await receipt(service, "trip-distinct")).purchaseImport,
  ).toMatchObject({
    outcome: "added",
  });
  failNext(null);
  expect(
    (await receipt(service, "trip-distinct")).purchaseImport,
  ).toMatchObject({
    outcome: "duplicate",
  });
  const restarted = new Service(storage);
  await restarted.init();
  expect((await restarted.purchases.ledger()).events).toHaveLength(2);
  expect(
    (await receipt(restarted, "trip-original")).purchaseImport,
  ).toMatchObject({
    outcome: "duplicate",
  });
  // Deleting an event forgets its fingerprint, so the same receipt can be imported again.
  const [first] = (await restarted.purchases.ledger()).events;
  await restarted.purchases.delete({ eventId: first.id, scope: "event" });
  expect(
    (await receipt(restarted, "trip-original")).purchaseImport,
  ).toMatchObject({
    outcome: "added",
  });
});

test("the explicit legacy import takes the receipts it can read and leaves the rest as text", async () => {
  const { service, storage } = await profile();
  const note = "Vanha muistiinpano ilman kuittia\nmaito 1,19";
  await service.save({
    ...service.state,
    receiptText: [
      note,
      fixtureText(fixture("s-basic-campaign")),
      fixtureText(fixture("k-weighed")),
      fixtureText(fixture("s-basic-campaign")),
    ].join("\n"),
  });
  // Until the shopper asks, the text is only a legacy source and no purchase.
  expect((await service.purchases.ledger()).events).toEqual([]);
  expect(service.purchases.legacy(service.state.receiptText)?.kind).toBe(
    "legacy-text",
  );
  const snapshot = await service.importLegacyReceipts();
  expect(snapshot.purchaseImport).toEqual({
    source: "legacy",
    added: 2,
    updated: 0,
    duplicate: 1,
    unsupported: 1,
  });
  expect(snapshot.state.receiptText).toBe(note);
  const ledger = await service.purchases.ledger();
  expect(ledger.events.map((e) => [e.chain, e.reconciliation.status])).toEqual([
    ["s-group", "balanced"],
    ["k-group", "balanced"],
  ]);
  // Running it again finds nothing more and changes nothing.
  const again = await service.importLegacyReceipts();
  expect(again.purchaseImport).toMatchObject({
    added: 0,
    duplicate: 0,
    unsupported: 1,
  });
  expect(again.state.revision).toBe(snapshot.state.revision);
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.state.receiptText).toBe(note);
});

test("the real reader returns both layouts and a two-page PDF with its page break", async () => {
  const worker = pathToFileURL(
    join(process.cwd(), "dist/main/receipt-worker.js"),
  );
  if (!existsSync(join(process.cwd(), "dist/main/receipt-worker.js"))) return;
  const directory = await mkdtemp(join(tmpdir(), "korikone-receipt-import-"));
  const { service } = await profile();
  for (const id of [
    "s-multi-page",
    "k-quantity-before-price",
    "s-five-groups",
  ]) {
    const f = fixture(id);
    const path = join(directory, `${id}.pdf`);
    await writeFile(path, receiptTextPDF(f.pages));
    const text = await readReceipt(path, worker);
    const parsed = parseReceipt(text);
    if (parsed.outcome !== "event") throw new Error(`${id} unsupported`);
    expect(parsed.receipt.pages).toBe(f.source.pages);
    expect(parsed.facts.reconciliation).toEqual(f.event!.reconciliation);
    expect(
      parsed.facts.lines.map((l) => [
        l.label,
        l.span.page,
        l.quantity.amount,
        l.gross,
        l.net,
      ]),
    ).toEqual(
      f.event!.lines.map((l) => [
        l.label,
        l.span.page,
        l.quantity.amount,
        l.gross,
        l.net,
      ]),
    );
    expect(
      (await service.importReceiptText({ text, format: "pdf" })).purchaseImport,
    ).toMatchObject({ outcome: "added", reconciliation: "balanced" });
    // The text file of the same receipt is then a duplicate.
    expect(
      (await service.importReceiptText({ text: fixtureText(f), format: "txt" }))
        .purchaseImport,
    ).toMatchObject({ outcome: "duplicate" });
  }
  const txt = join(directory, "plain.txt");
  await writeFile(txt, fixtureText(fixture("k-weighed")), "utf8");
  expect(parseReceipt(await readReceipt(txt)).outcome).toBe("event");
  await writeFile(join(directory, "empty.txt"), "  \n");
  await expect(readReceipt(join(directory, "empty.txt"))).rejects.toThrow(
    "receiptNoText",
  );
  await writeFile(join(directory, "big.txt"), "x".repeat(50_001));
  await expect(readReceipt(join(directory, "big.txt"))).rejects.toThrow(
    "receiptTooLarge",
  );
  await writeFile(join(directory, "broken.pdf"), "not a pdf");
  await expect(
    readReceipt(join(directory, "broken.pdf"), worker),
  ).rejects.toThrow("receiptUnreadable");
  await writeFile(join(directory, "list.docx"), "x");
  await expect(readReceipt(join(directory, "list.docx"))).rejects.toThrow(
    "receiptUnreadable",
  );
}, 120000);
