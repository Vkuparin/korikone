import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { diagnostics } from "../src/application/diagnostics";
import {
  LEGACY_SOURCE_ID,
  PURCHASES_KEY,
  deletePurchase,
  emptyLedger,
  purchaseEventSchema,
  purchaseLedgerSchema,
  purchaseOriginalKey,
  putPurchase,
  readLedger,
  sanitizeLabel,
  type PurchaseLedger,
} from "../src/domain/purchases";
import { initialState, stateSchema } from "../src/domain/model";
import {
  memoryStorage,
  purchaseEvent,
  purchaseLine,
  purchaseSource,
} from "./helpers/purchase-fixtures";

function twoEvents(): PurchaseLedger {
  let ledger = putPurchase(
    emptyLedger(),
    purchaseSource("s1", { retention: "original" }),
    purchaseEvent("e1", "s1"),
  );
  ledger = putPurchase(
    ledger,
    purchaseSource("s2", {
      chain: "k-group",
      parser: { id: "k-group", version: 1 },
    }),
    purchaseEvent("e2", "s2", {
      chain: "k-group",
      purchasedAt: "2026-10-03T09:00:00.000Z",
    }),
  );
  return {
    ...ledger,
    annotations: [
      {
        eventId: "e1",
        lineId: "l1",
        origin: "rule",
        sourceRevision: 1,
        name: "Maito",
        category: "milk",
        qualifiers: [{ kind: "fat", value: "semi-skimmed" }],
        scope: "food",
        model: null,
        at: "2026-10-01T10:00:00.000Z",
      },
    ],
    consent: {
      automatic: {
        providerId: "chatgpt",
        scope: 1,
        grantedAt: "2026-10-01T10:00:00.000Z",
      },
      asked: true,
    },
  };
}

test("an old profile has an empty ledger and its receipt text is one undated legacy source", async () => {
  const { storage } = memoryStorage();
  const state = initialState();
  state.receiptText = "S-MARKET\nKEVYTMAITO 1,19\n\nYHTEENSÄ 1,19";
  await storage.set("state", state);
  const service = new Service(storage);
  await service.init();
  expect(await service.purchases.ledger()).toEqual(emptyLedger());
  const legacy = service.purchases.legacy(service.state.receiptText)!;
  expect(legacy).toMatchObject({
    id: LEGACY_SOURCE_ID,
    kind: "legacy-text",
    chain: "unknown",
    parser: null,
    lines: 3,
    unreadableLines: 3,
    importedAt: "1970-01-01T00:00:00.000Z",
  });
  expect(service.purchases.legacy("  \n ")).toBeNull();
  // The legacy text can never back a purchase event.
  expect(() =>
    purchaseLedgerSchema.parse({
      ...emptyLedger(),
      sources: [legacy],
      events: [purchaseEvent("e1", LEGACY_SOURCE_ID)],
    }),
  ).toThrow();
  // A damaged document reads as empty rather than as partial facts.
  expect(readLedger({ version: 1, events: "x" })).toEqual(emptyLedger());
  expect(readLedger(undefined)).toEqual(emptyLedger());
});

test("two events stay distinct, with facts, interpretations and consent kept apart", () => {
  const ledger = purchaseLedgerSchema.parse(twoEvents());
  expect(ledger.events.map((e) => [e.id, e.chain, e.sourceIds])).toEqual([
    ["e1", "s-group", ["s1"]],
    ["e2", "k-group", ["s2"]],
  ]);
  // One source backs one event only.
  expect(() =>
    purchaseLedgerSchema.parse({
      ...ledger,
      events: [...ledger.events, purchaseEvent("e3", "s1")],
    }),
  ).toThrow();
  // Reprocessing replaces the same source and event; a stale interpretation does not carry over.
  const reprocessed = putPurchase(
    ledger,
    purchaseSource("s1", { revision: 2 }),
    purchaseEvent("e1", "s1", {
      lines: [purchaseLine("l1", "KEVYTMAITO 1L", 119)],
      printed: [],
      reconciliation: {
        status: "incomplete",
        computedTotal: 119,
        printedTotal: null,
        difference: null,
        reasons: ["no-printed-total"],
      },
    }),
  );
  expect(reprocessed.events).toHaveLength(2);
  expect(reprocessed.sources.find((s) => s.id === "s1")?.revision).toBe(2);
  expect(reprocessed.annotations).toEqual([]);
  expect(() =>
    putPurchase(ledger, purchaseSource("s9"), purchaseEvent("e9", "s1")),
  ).toThrow("purchaseInvalid");
});

test("unknown quantities, amounts and discount allocations stay unknown", () => {
  const event = purchaseEventSchema.parse(
    purchaseEvent("e1", "s1", {
      lines: [
        purchaseLine("l1", "BANAANI", null, {
          quantity: { amount: null, unit: null, provenance: "unknown" },
        }),
        purchaseLine("l2", "TONNIKALA 3-PACK", 399),
        purchaseLine("l3", "TONNIKALA 3-PACK", 399),
      ],
      adjustments: [
        {
          id: "a1",
          kind: "campaign",
          label: "KAMPANJA",
          span: { page: 1, line: 5, endLine: 5 },
          amount: -100,
          allocation: "group",
          lineIds: ["l2", "l3"],
          provenance: "source",
        },
        {
          id: "a2",
          kind: "discount",
          label: "ALENNUS",
          span: { page: 1, line: 6, endLine: 6 },
          amount: null,
          allocation: "unknown",
          lineIds: [],
          provenance: "source",
        },
      ],
      purchasedAt: null,
      datePrecision: "unknown",
      reconciliation: {
        status: "incomplete",
        computedTotal: null,
        printedTotal: 348,
        difference: null,
        reasons: [
          "missing-line-amount",
          "missing-adjustment-amount",
          "unallocated-adjustment",
        ],
      },
    }),
  );
  expect(event.lines[0]).toMatchObject({ net: null, unitPrice: null });
  const invalid = (change: object) =>
    purchaseEventSchema.safeParse({ ...event, ...change }).success;
  // A quantity is wholly known or wholly unknown; a line allocation needs its lines.
  expect(
    invalid({
      lines: [
        purchaseLine("l1", "BANAANI", null, {
          quantity: { amount: 3, unit: null, provenance: "source" } as never,
        }),
      ],
      adjustments: [],
    }),
  ).toBe(false);
  for (const adjustment of [
    { allocation: "line", lineIds: [] },
    { allocation: "group", lineIds: ["l2"] },
    { allocation: "receipt", lineIds: ["l2"] },
    { allocation: "line", lineIds: ["l9"] },
  ])
    expect(
      invalid({ adjustments: [{ ...event.adjustments[0], ...adjustment }] }),
    ).toBe(false);
  // Money is whole cents and a date without precision is not a date.
  expect(
    invalid({
      lines: [purchaseLine("l1", "MAITO", 1.5), ...event.lines.slice(1)],
    }),
  ).toBe(false);
  expect(invalid({ purchasedAt: "2026-10-01T10:00:00.000Z" })).toBe(false);
  // A balanced result has no difference and no reason; any other names its reasons.
  for (const reconciliation of [
    {
      status: "balanced",
      computedTotal: 348,
      printedTotal: 347,
      difference: 1,
      reasons: [],
    },
    {
      status: "unbalanced",
      computedTotal: 348,
      printedTotal: 347,
      difference: 1,
      reasons: [],
    },
    {
      status: "unbalanced",
      computedTotal: 348,
      printedTotal: 347,
      difference: 2,
      reasons: ["difference"],
    },
  ])
    expect(invalid({ reconciliation })).toBe(false);
});

test("scoped deletion removes the original copy, the interpretations or the whole event", () => {
  const ledger = twoEvents();
  const original = deletePurchase(ledger, { eventId: "e1", scope: "original" });
  expect(original.originals).toEqual(["s1"]);
  expect(original.ledger.sources[0].retention).toBe("sanitized");
  expect(original.ledger.events).toHaveLength(2);
  expect(original.ledger.annotations).toHaveLength(1);
  const annotations = deletePurchase(ledger, {
    eventId: "e1",
    scope: "annotations",
  });
  expect(annotations.ledger.annotations).toEqual([]);
  expect(annotations.ledger.events).toHaveLength(2);
  expect(annotations.originals).toEqual([]);
  const event = deletePurchase(ledger, { eventId: "e1", scope: "event" });
  expect(event.ledger.events.map((e) => e.id)).toEqual(["e2"]);
  expect(event.ledger.sources.map((s) => s.id)).toEqual(["s2"]);
  expect(event.ledger.annotations).toEqual([]);
  expect(event.originals).toEqual(["s1"]);
  // The fingerprint is forgotten with the event, so the same file may be imported again.
  expect(event.ledger.sources.some((s) => s.fingerprint.startsWith("s1"))).toBe(
    false,
  );
  expect(() =>
    deletePurchase(ledger, { eventId: "e9", scope: "event" }),
  ).toThrow("purchaseMissing");
  expect(() =>
    deletePurchase(ledger, { eventId: "e1", scope: "everything" }),
  ).toThrow();
  expect(purchaseLedgerSchema.parse(ledger)).toEqual(ledger);
});

test("backups carry sanitized records, originals only on request, and never consent", async () => {
  const { storage, entries } = memoryStorage();
  const service = new Service(storage);
  await service.init();
  await service.purchases.write(twoEvents(), [
    { sourceId: "s1", text: "ALKUPERÄINEN KUITTI 1234 5678 9012" },
  ]);
  const backup = await service.exportBackup();
  expect(backup.purchases.events).toHaveLength(2);
  expect(backup.purchases.consent).toEqual({ automatic: null, asked: false });
  expect("purchaseOriginals" in backup).toBe(false);
  expect(JSON.stringify(backup)).not.toContain("ALKUPERÄINEN");
  const full = await service.exportBackup({ includeOriginals: true });
  expect(full.purchaseOriginals).toEqual({
    s1: "ALKUPERÄINEN KUITTI 1234 5678 9012",
  });
  // The state schema of earlier releases still reads the file.
  expect(stateSchema.safeParse(backup).success).toBe(true);

  // Restoring into a profile that had another purchase and a retained original.
  const other = memoryStorage();
  const target = new Service(other.storage);
  await target.init();
  await target.purchases.write(
    putPurchase(
      emptyLedger(),
      purchaseSource("old", { retention: "original" }),
      purchaseEvent("old-event", "old"),
    ),
    [{ sourceId: "old", text: "VANHA" }],
  );
  await target.importBackup(backup);
  const restored = await target.purchases.ledger();
  expect(restored.events.map((e) => e.id)).toEqual(["e1", "e2"]);
  // No original came with the file, so none is claimed, and consent must be asked again.
  expect(restored.sources.map((s) => s.retention)).toEqual([
    "sanitized",
    "sanitized",
  ]);
  expect(restored.consent).toEqual({ automatic: null, asked: false });
  expect(other.entries.get(purchaseOriginalKey("old"))).toBeNull();
  await target.importBackup(full);
  expect((await target.purchases.ledger()).sources[0].retention).toBe(
    "original",
  );
  expect(await target.purchases.original("s1")).toContain("ALKUPERÄINEN");

  // A backup from before 0.9.0 leaves purchase records alone; an invalid one changes nothing.
  const { purchases: _purchases, ...old } = backup;
  await target.importBackup(old);
  expect((await target.purchases.ledger()).events).toHaveLength(2);
  const before = structuredClone(target.state);
  await expect(
    target.importBackup({
      ...backup,
      note: "changed",
      purchases: { version: 2 },
    }),
  ).rejects.toThrow();
  expect(target.state).toEqual(before);
  expect((await target.purchases.ledger()).events).toHaveLength(2);

  // Deleting through the store removes the retained copy in the same write.
  await service.purchases.delete({ eventId: "e1", scope: "event" });
  expect(entries.get(purchaseOriginalKey("s1"))).toBeNull();
  expect((entries.get(PURCHASES_KEY) as PurchaseLedger).events).toHaveLength(1);
  // Diagnostics have no receipt content, label or identifier.
  const report = JSON.stringify(diagnostics(service.snapshot(), {}));
  expect(report).not.toMatch(/KEVYTMAITO|RUISLEIPÄ|Esimerkkikauppa|purchase/i);
});

test("labels lose identifiers and keep the product words", () => {
  expect(sanitizeLabel("  KEVYTMAITO   1L ")).toBe("KEVYTMAITO 1L");
  expect(sanitizeLabel("KORTTI ************1234")).toBe("KORTTI …");
  expect(sanitizeLabel("VIITE 123456789012")).toBe("VIITE …");
  expect(sanitizeLabel("asiakas matti@example.fi")).toBe("asiakas …");
  expect(sanitizeLabel("PLUSSA 9246 1234 5678 9012")).toBe("PLUSSA …");
  expect(sanitizeLabel("TONNIKALA 3X185G")).toBe("TONNIKALA 3X185G");
  expect(sanitizeLabel("   ")).toBe("…");
  expect(sanitizeLabel("x".repeat(500))).toHaveLength(200);
});
