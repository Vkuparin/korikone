import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import type { TransferRecord } from "../src/domain/memory";
import { initialState } from "../src/domain/model";
import {
  actualPurchases,
  confirmedTransfers,
  decideLink,
  linkCandidates,
  linkStrong,
} from "../src/domain/purchase-links";
import {
  deletePurchase,
  emptyLedger,
  putPurchase,
  type PurchaseLedger,
} from "../src/domain/purchases";
import { DemoProvider, demoOrders } from "../src/stores/demo";
import {
  memoryStorage,
  purchaseEvent,
  purchaseLine,
  purchaseSource,
} from "./helpers/purchase-fixtures";

const span = { page: 1, line: 9, endLine: 9 };
const rows = ["KEVYTMAITO 1L", "RUISLEIPÄ", "KAHVI 500G", "BANAANI"];
function add(
  ledger: PurchaseLedger,
  id: string,
  options: {
    origin?: "receipt" | "order";
    at?: string | null;
    day?: boolean;
    total?: number | null;
    labels?: string[];
    status?: "completed" | "pending" | "cancelled";
    chain?: "s-group" | "k-group";
  } = {},
) {
  const total = options.total === undefined ? 1047 : options.total;
  const at = options.at === undefined ? "2026-10-12T11:35:00.000Z" : options.at;
  return putPurchase(
    ledger,
    purchaseSource(`s-${id}`, {
      kind: options.origin === "order" ? "order" : "receipt",
      chain: options.chain ?? "s-group",
      fingerprint: id.padEnd(16, "0").replace(/[^0-9a-f]/g, "c"),
    }),
    purchaseEvent(id, `s-${id}`, {
      origin: options.origin ?? "receipt",
      status: options.status ?? "completed",
      chain: options.chain ?? "s-group",
      purchasedAt: at,
      datePrecision: at === null ? "unknown" : options.day ? "day" : "minute",
      lines: (options.labels ?? rows).map((label, i) =>
        purchaseLine(`l${i + 1}`, label, 100),
      ),
      printed: total === null ? [] : [{ role: "total", amount: total, span }],
      reconciliation: {
        status: "incomplete",
        computedTotal: null,
        printedTotal: total,
        difference: null,
        reasons: ["missing-line-amount"],
      },
    }),
  );
}
const order = {
  origin: "order" as const,
  at: "2026-10-12T00:00:00.000Z",
  day: true,
};
const transfer = (
  id: string,
  date: string,
  names: string[],
  storeKey = "s-kaupat:1",
): TransferRecord => ({
  id,
  date,
  storeKey,
  items: names.map((name) => ({ name, quantity: 1, unit: "kpl", price: 100 })),
});

test("a receipt and an order of one purchase link only on strong evidence and count once", () => {
  let ledger = add(add(emptyLedger(), "receipt"), "order", order);
  expect(linkCandidates(ledger, [])).toEqual([
    {
      kind: "purchase",
      eventIds: ["receipt", "order"],
      strength: "strong",
      matchedRows: 4,
      rows: 4,
      sameTotal: true,
    },
  ]);
  const linked = linkStrong(ledger, []);
  expect(linked).toMatchObject({ linked: 1, review: [] });
  expect(linked.ledger.links).toEqual([
    { eventIds: ["order", "receipt"], by: "rule" },
  ]);
  // One purchase, the receipt's total, both records kept as sources.
  expect(actualPurchases(linked.ledger)).toEqual([
    {
      eventIds: ["receipt", "order"],
      chain: "s-group",
      purchasedAt: "2026-10-12T11:35:00.000Z",
      datePrecision: "minute",
      total: 1047,
      totalSource: "receipt",
      totals: [
        { eventId: "receipt", origin: "receipt", total: 1047 },
        { eventId: "order", origin: "order", total: 1047 },
      ],
      conflictingTotals: false,
      foodSubtotal: null,
      nonFoodSubtotal: null,
    },
  ]);
  expect(linked.ledger.events).toHaveLength(2);
  // Running it again, or reprocessing a source, neither repeats nor loses the link.
  expect(linkStrong(linked.ledger, []).linked).toBe(0);
  const reprocessed = putPurchase(
    linked.ledger,
    { ...linked.ledger.sources[0], revision: 2 },
    linked.ledger.events[0],
  );
  expect(reprocessed.links).toHaveLength(1);
  expect(actualPurchases(reprocessed)).toHaveLength(1);
  // Deleting one record removes the link with it; the other still counts once.
  const without = deletePurchase(linked.ledger, {
    eventId: "order",
    scope: "event",
  }).ledger;
  expect(without.links).toEqual([]);
  expect(actualPurchases(without).map((p) => p.eventIds)).toEqual([
    ["receipt"],
  ]);

  // Each weaker case is a review candidate or nothing, and unlinked records count separately.
  const cases: [string, Parameters<typeof add>[2], "review" | null][] = [
    ["another total", { ...order, total: 1147 }, "review"],
    ["unknown total", { ...order, total: null }, "review"],
    [
      "half the rows",
      {
        ...order,
        labels: ["KEVYTMAITO 1L", "RUISLEIPÄ", "JUUSTO", "TOMAATTI"],
      },
      "review",
    ],
    [
      "two rows only",
      { ...order, labels: ["KEVYTMAITO 1L", "RUISLEIPÄ"] },
      "review",
    ],
    ["two days later", { ...order, at: "2026-10-14T00:00:00.000Z" }, "review"],
    ["a week later", { ...order, at: "2026-10-20T00:00:00.000Z" }, null],
    ["another chain", { ...order, chain: "k-group" }, null],
    ["a cancelled order", { ...order, status: "cancelled" }, null],
    [
      "nothing in common",
      { ...order, total: 500, labels: ["JUUSTO", "TOMAATTI", "KURKKU"] },
      null,
    ],
  ];
  for (const [name, options, expected] of cases) {
    ledger = add(add(emptyLedger(), "receipt"), "order", options);
    const result = linkStrong(ledger, []);
    expect([name, result.linked, result.review.map((c) => c.strength)]).toEqual(
      [name, 0, expected ? [expected] : []],
    );
    expect(result.ledger.links).toEqual([]);
  }
  // Conflicting totals stay visible when the shopper says the records are one purchase.
  ledger = add(add(emptyLedger(), "receipt"), "order", {
    ...order,
    total: 1147,
  });
  const decided = decideLink(
    ledger,
    { kind: "purchase", eventIds: ["receipt", "order"] },
    true,
  );
  expect(actualPurchases(decided)).toMatchObject([
    {
      total: 1047,
      totalSource: "receipt",
      conflictingTotals: true,
      totals: [{ total: 1047 }, { total: 1147 }],
    },
  ]);
  expect(linkCandidates(decided, [])).toEqual([]);
  // "Not the same" is remembered too, and both then count.
  const rejected = decideLink(
    ledger,
    { kind: "purchase", eventIds: ["receipt", "order"] },
    false,
  );
  expect(linkCandidates(rejected, [])).toEqual([]);
  expect(actualPurchases(rejected)).toHaveLength(2);
  expect(() =>
    decideLink(
      ledger,
      { kind: "purchase", eventIds: ["receipt", "gone"] },
      true,
    ),
  ).toThrow("purchaseMissing");
});

test("similar visits are never merged by a guess", () => {
  // Two receipts that both fit one order: neither is the unique match.
  let ledger = add(emptyLedger(), "morning", {
    at: "2026-10-12T07:00:00.000Z",
  });
  ledger = add(ledger, "evening", { at: "2026-10-12T16:00:00.000Z" });
  ledger = add(ledger, "order", order);
  const result = linkStrong(ledger, []);
  expect(result.linked).toBe(0);
  expect(result.review.map((c) => c.strength)).toEqual(["review", "review"]);
  expect(actualPurchases(result.ledger)).toHaveLength(3);
  // Two receipts are never candidates for each other, however alike.
  expect(
    linkCandidates(
      add(add(emptyLedger(), "a"), "b", { at: "2026-10-12T11:40:00.000Z" }),
      [],
    ),
  ).toEqual([]);
});

test("a transfer is never spending; only a strongly matching completed purchase confirms it", () => {
  const sent = transfer("t1", "2026-10-11T18:00:00.000Z", [
    "Kevytmaito 1 l",
    "Ruisleipä 500 g",
    "Kahvi suodatinjauhatus 500 g",
    "Banaani",
  ]);
  const base = add(emptyLedger(), "receipt");
  expect(linkCandidates(base, [sent])).toEqual([
    {
      kind: "transfer",
      transferId: "t1",
      eventId: "receipt",
      strength: "strong",
      matchedRows: 4,
      rows: 4,
    },
  ]);
  const linked = linkStrong(base, [sent]);
  expect(linked.ledger.transferLinks).toEqual([
    { transferId: "t1", eventId: "receipt", by: "rule" },
  ]);
  expect(confirmedTransfers(linked.ledger)).toMatchObject([
    {
      transferId: "t1",
      eventId: "receipt",
      by: "rule",
      purchasedAt: "2026-10-12T11:35:00.000Z",
    },
  ]);
  // Linked or not, the transfer adds nothing to actual purchases.
  expect(actualPurchases(linked.ledger)).toHaveLength(1);
  expect(actualPurchases(emptyLedger())).toEqual([]);

  const weaker: [string, TransferRecord, PurchaseLedger, "review" | null][] = [
    // Half the products within three days: the old automatic rule is now only a question.
    [
      "half the products",
      transfer("t1", "2026-10-11T18:00:00.000Z", [
        "Kevytmaito 1 l",
        "Ruisleipä",
        "Juusto",
        "Tomaatti",
      ]),
      base,
      "review",
    ],
    [
      "two of two products",
      transfer("t1", "2026-10-11T18:00:00.000Z", [
        "Kevytmaito 1 l",
        "Ruisleipä",
      ]),
      base,
      "review",
    ],
    [
      "bought before the transfer",
      transfer("t1", "2026-10-14T18:00:00.000Z", rows),
      base,
      null,
    ],
    [
      "nine days later",
      transfer("t1", "2026-10-03T08:00:00.000Z", rows),
      base,
      null,
    ],
    [
      "another chain",
      transfer("t1", "2026-10-11T18:00:00.000Z", rows, "k-ruoka:1"),
      base,
      null,
    ],
    [
      "a pending order",
      transfer("t1", "2026-10-11T18:00:00.000Z", rows),
      add(emptyLedger(), "order", { ...order, status: "pending" }),
      null,
    ],
    [
      "a cancelled order",
      transfer("t1", "2026-10-11T18:00:00.000Z", rows),
      add(emptyLedger(), "order", { ...order, status: "cancelled" }),
      null,
    ],
    [
      "an undated receipt",
      transfer("t1", "2026-10-11T18:00:00.000Z", rows),
      add(emptyLedger(), "receipt", { at: null }),
      null,
    ],
  ];
  for (const [name, record, ledger, expected] of weaker) {
    const result = linkStrong(ledger, [record]);
    expect([name, result.linked, result.review.map((c) => c.strength)]).toEqual(
      [name, 0, expected ? [expected] : []],
    );
    expect(confirmedTransfers(result.ledger)).toEqual([]);
  }
  // Two transfers of the same list before one purchase: the purchase confirms neither by itself.
  const twice = linkStrong(base, [
    sent,
    { ...sent, id: "t2", date: "2026-10-12T06:00:00.000Z" },
  ]);
  expect(twice.linked).toBe(0);
  expect(twice.review).toHaveLength(2);
  // The shopper may confirm one; a purchase and a transfer each link once.
  const chosen = decideLink(
    base,
    { kind: "transfer", transferId: "t2", eventId: "receipt" },
    true,
  );
  expect(confirmedTransfers(chosen)).toMatchObject([
    { transferId: "t2", by: "user" },
  ]);
  expect(() =>
    decideLink(
      chosen,
      { kind: "transfer", transferId: "t1", eventId: "receipt" },
      true,
    ),
  ).toThrow("purchaseInvalid");
});

async function shop() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const provider = new DemoProvider("s-kaupat");
  service.registry.register(provider);
  const state = initialState();
  state.context = {
    providerId: "s-kaupat",
    storeId: "1",
    storeName: "S",
    fulfillment: "pickup",
  };
  state.staples = [
    {
      id: "coffee",
      name: "Kahvi",
      amount: 500,
      unit: "g",
      everyDays: 21,
      lastPurchased: null,
      enabled: true,
    },
    {
      id: "rice",
      name: "Riisi",
      amount: 1000,
      unit: "g",
      everyDays: 30,
      lastPurchased: null,
      enabled: true,
    },
  ];
  state.listHistory = [
    {
      id: "t1",
      date: "2026-10-01T18:00:00.000Z",
      note: "",
      meals: [],
      recipes: [],
      extras: [],
      skipped: [],
      removed: [],
      quantities: {},
      prices: {},
      storeKey: "s-kaupat:1",
      transferred: [
        {
          productId: "a",
          name: "Kevytmaito 1 l",
          quantity: 2,
          unit: "kpl",
          price: 119,
        },
        {
          productId: "b",
          name: "Banaani",
          quantity: 1,
          unit: "kg",
          price: 169,
        },
        {
          productId: "c",
          name: "Kahvi suodatinjauhatus 500 g",
          quantity: 1,
          unit: "kpl",
          price: 599,
        },
      ],
    },
  ];
  await store.storage.set("state", state);
  await service.init();
  service.storeLogins["s-kaupat"] = "signedIn";
  return { ...store, service, provider };
}

test("imported order evidence confirms its transfer once and advances only what was bought", async () => {
  const { service, provider, entries } = await shop();
  // Before any evidence: the transfer alone confirms nothing and no statistic exists.
  expect((await service.purchaseInsights()).confirmedTransfers).toEqual([]);
  expect((await service.memory()).purchases).toEqual([]);
  const snapshot = await service.importOrders();
  expect(snapshot.purchaseSignals).toEqual([
    {
      transferId: "t1",
      eventId: expect.stringMatching(/^order-/),
      strength: "confirmed",
    },
  ]);
  expect(entries.get("ordered-t1")).toEqual({
    confirmedAt: "2026-10-02T00:00:00.000Z",
    by: "evidence",
    eventId: snapshot.purchaseSignals[0].eventId,
  });
  // Coffee was on the order and advances to the purchase day; rice was not and does not.
  expect(snapshot.state.staples.map((s) => [s.name, s.lastPurchased])).toEqual([
    ["Kahvi", "2026-10-02T00:00:00.000Z"],
    ["Riisi", null],
  ]);
  // A repeated import and a restart confirm nothing a second time.
  const revision = service.state.revision;
  await service.importOrders();
  expect(service.state.revision).toBe(revision);
  expect((await service.purchases.ledger()).transferLinks).toHaveLength(1);
  // The pending and cancelled orders of the same account confirmed nothing and are no spending.
  const insights = await service.purchaseInsights();
  expect(insights.actualPurchases.map((p) => p.total)).toEqual([1267, null]);
  expect(insights.confirmedTransfers).toHaveLength(1);
  expect(provider.writes).toBe(0);
});

test("a weak match waits for the shopper, and the manual confirmation keeps its own provenance", async () => {
  const { service, entries, provider } = await shop();
  const history = provider.orderHistory!;
  provider.orderHistory = async () => [
    {
      ...demoOrders[0],
      items: [
        demoOrders[0].items![0],
        { name: "Juusto", quantity: 1, unit: "pcs", unitPrice: 349 },
      ],
    },
    demoOrders[2],
  ];
  const weak = await service.importOrders();
  // One of three transferred products is on the order: not even a review candidate.
  expect(weak.purchaseSignals).toEqual([]);
  provider.orderHistory = async () => [
    { ...demoOrders[0], items: demoOrders[0].items!.slice(0, 2) },
  ];
  const partial = await service.importOrders();
  expect(partial.purchaseSignals).toEqual([
    { transferId: "t1", eventId: expect.any(String), strength: "review" },
  ]);
  expect(entries.has("ordered-t1")).toBe(false);
  expect(service.state.staples.every((s) => s.lastPurchased === null)).toBe(
    true,
  );
  // The shopper says it was that purchase: now it confirms, as the shopper's link.
  const decided = await service.decidePurchaseLink({
    candidate: {
      kind: "transfer",
      transferId: "t1",
      eventId: partial.purchaseSignals[0].eventId,
    },
    same: true,
  });
  expect(decided.purchaseSignals).toMatchObject([{ strength: "confirmed" }]);
  expect((await service.purchaseInsights()).confirmedTransfers).toMatchObject([
    { by: "user" },
  ]);
  expect(entries.get("ordered-t1")).toMatchObject({ by: "evidence" });
  await expect(
    service.decidePurchaseLink({
      candidate: { kind: "transfer", transferId: "t1" },
      same: true,
    }),
  ).rejects.toThrow();
  provider.orderHistory = history;
});
