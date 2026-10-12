import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { diagnostics } from "../src/application/diagnostics";
import { orderPurchase } from "../src/domain/order-evidence";
import { DemoProvider, demoOrders } from "../src/stores/demo";
import { S_KAUPAT_TOOLS, SKaupatProvider } from "../src/stores/s-kaupat";
import { SKaupatLibrary } from "../src/stores/s-kaupat-library";
import { memoryStorage } from "./helpers/purchase-fixtures";

const digest = "a".repeat(64);

test("an order becomes evidence with its own quantities and unknowns, and no line totals", () => {
  const { source, event } = orderPurchase(
    demoOrders[0],
    "s-group",
    digest,
    "2026-10-12T08:00:00.000Z",
  );
  expect(source).toMatchObject({
    kind: "order",
    format: "order",
    chain: "s-group",
    parser: { id: "retailer-order", version: 1 },
    fingerprint: digest,
    retention: "sanitized",
    lines: 3,
  });
  expect(event).toMatchObject({
    origin: "order",
    status: "completed",
    purchasedAt: "2026-10-02T00:00:00.000Z",
    datePrecision: "day",
    printed: [{ role: "total", amount: 1267 }],
    reconciliation: {
      status: "incomplete",
      computedTotal: null,
      printedTotal: 1267,
      reasons: ["missing-line-amount"],
    },
  });
  expect(
    event.lines.map((l) => [
      l.label,
      l.quantity.amount,
      l.quantity.unit,
      l.unitPrice,
      l.unitPriceBasis,
      l.gross,
      l.net,
    ]),
  ).toEqual([
    ["Kevytmaito 1 l", 2, "pcs", 119, "pcs", null, null],
    ["Banaani", 850, "g", 169, "kg", null, null],
    ["Kahvi suodatinjauhatus 500 g", 1, "pcs", 599, "pcs", null, null],
  ]);
  // A fractional piece count, a missing name, date, total and price all stay unknown.
  const unknown = orderPurchase(
    demoOrders[3],
    "s-group",
    digest,
    "2026-10-12T08:00:00.000Z",
  );
  expect(unknown.event).toMatchObject({
    store: null,
    purchasedAt: null,
    datePrecision: "unknown",
    printed: [],
    reconciliation: { reasons: ["no-printed-total", "missing-line-amount"] },
  });
  expect(unknown.event.lines[0]).toMatchObject({
    label: "…",
    quantity: { amount: null, unit: null, provenance: "unknown" },
    unitPrice: null,
    unitPriceBasis: null,
  });
  // The order ID is identity for dedupe only; it is not written into the evidence.
  expect(JSON.stringify([source, event])).not.toContain("fixture-order");
  expect(() =>
    orderPurchase(
      { ...demoOrders[0], address: "Katu 1" },
      "s-group",
      digest,
      "2026-10-12T08:00:00.000Z",
    ),
  ).toThrow();
});

test("the S-kaupat adapter reads orders through the two read-only tools only", async () => {
  const calls: [string, unknown][] = [];
  const provider = new SKaupatProvider(async (name, args) => {
    calls.push([name, args]);
    if (name === "get_orders")
      return {
        needsPayment: [
          {
            orderId: "o-unpaid",
            state: "received",
            total: 12.5,
            payment: "payment_failed",
          },
        ],
        active: [
          {
            orderId: "o-active",
            state: "being_picked",
            storeName: "Prisma Esimerkki",
            deliveryDate: "2026-10-14",
            deliveryTime: "16:00-18:00",
            total: 23.1,
            paymentLinkUrl: "https://pay.example.invalid/x",
          },
        ],
        past: [
          {
            orderId: "o-done",
            state: "done",
            storeName: "Prisma Esimerkki",
            deliveryDate: "2026-10-02T00:00:00+03:00",
            total: 12.67,
          },
          { orderId: "o-broken", state: "done", total: null },
          { orderId: "o-cancelled", state: "cancelled", total: 18.9 },
          { orderId: "o-odd", state: "something-new", deliveryDate: "soon" },
        ],
      };
    if (
      name === "get_order_items" &&
      (args as { orderId: string }).orderId === "o-done"
    )
      return {
        orderId: "o-done",
        items: [
          {
            productId: "6410000000001",
            name: "Kevytmaito 1 l",
            quantity: 2,
            unit: "KPL",
            price: 1.19,
            allowSubstitutes: true,
            note: "ovikoodi 1234",
          },
          {
            productId: "6410000000002",
            name: "Banaani",
            quantity: 0.85,
            unit: "KG",
            price: 1.69,
            allowSubstitutes: false,
            note: null,
          },
          {
            productId: "6410000000003",
            name: null,
            quantity: 1,
            unit: "L",
            price: null,
            allowSubstitutes: false,
            note: null,
          },
        ],
      };
    throw new Error("storeUnavailable");
  });
  expect(provider.capabilities.orderHistory).toBe(true);
  const orders = await provider.orderHistory(500);
  expect(calls).toEqual([
    ["get_orders", { limit: 50 }],
    ["get_order_items", { orderId: "o-done" }],
    ["get_order_items", { orderId: "o-broken" }],
  ]);
  expect(orders).toEqual([
    {
      orderId: "o-done",
      state: "completed",
      storeName: "Prisma Esimerkki",
      date: "2026-10-02",
      total: 1267,
      items: [
        { name: "Kevytmaito 1 l", quantity: 2, unit: "pcs", unitPrice: 119 },
        { name: "Banaani", quantity: 0.85, unit: "kg", unitPrice: 169 },
        { name: null, quantity: 1, unit: null, unitPrice: null },
      ],
    },
    // Rows that could not be read leave the order without lines; it is not dropped.
    {
      orderId: "o-broken",
      state: "completed",
      storeName: null,
      date: null,
      total: null,
      items: null,
    },
    {
      orderId: "o-cancelled",
      state: "cancelled",
      storeName: null,
      date: null,
      total: 1890,
      items: null,
    },
    {
      orderId: "o-odd",
      state: "unknown",
      storeName: null,
      date: null,
      total: null,
      items: null,
    },
    {
      orderId: "o-active",
      state: "pending",
      storeName: "Prisma Esimerkki",
      date: "2026-10-14",
      total: 2310,
      items: null,
    },
    {
      orderId: "o-unpaid",
      state: "pending",
      storeName: null,
      date: null,
      total: 1250,
      items: null,
    },
  ]);
  // Product IDs, notes, payment links and times never leave the adapter.
  expect(JSON.stringify(orders)).not.toMatch(
    /6410|ovikoodi|pay\.example|16:00/,
  );
  // The allow-list holds the two reads and no tool that orders, pays or cancels.
  expect(S_KAUPAT_TOOLS).toEqual(
    expect.arrayContaining(["get_orders", "get_order_items"]),
  );
  for (const forbidden of [
    "place_order",
    "pay_order",
    "confirm_payment",
    "cancel_order",
    "review_order",
    "get_order",
    "get_checkout_options",
  ])
    expect(S_KAUPAT_TOOLS).not.toContain(forbidden);
});

test("the pinned library accepts the order read and refuses order tools", async () => {
  const library = new SKaupatLibrary({
    dataDir: await mkdtemp(join(tmpdir(), "korikone-orders-")),
    demo: true,
  });
  try {
    const provider = new SKaupatProvider((name, args) =>
      library.call(name, args),
    );
    // The read is allowed and reaches the library, which asks for its own sign-in first.
    await expect(provider.orderHistory(20)).rejects.toThrow("loginRequired");
    await expect(library.call("place_order", {})).rejects.toThrow(
      "unsupported",
    );
    await expect(
      library.call("cancel_order", { orderId: "x" }),
    ).rejects.toThrow("unsupported");
  } finally {
    await library.close();
  }
});

async function development() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const provider = new DemoProvider("s-kaupat");
  service.registry.register(provider);
  service.registry.register(new DemoProvider("k-ruoka"));
  await service.init();
  service.storeLogins["s-kaupat"] = "signedIn";
  return { ...store, service, provider };
}

test("importing orders keeps completed, pending and cancelled apart and repeats create nothing", async () => {
  const { service, provider, entries } = await development();
  const state = structuredClone(service.state);
  const first = await service.importOrders();
  expect(first.purchaseImport).toEqual({
    source: "orders",
    added: 4,
    updated: 0,
    duplicate: 0,
  });
  const ledger = await service.purchases.ledger();
  expect(ledger.events.map((e) => [e.status, e.lines.length])).toEqual([
    ["completed", 3],
    ["pending", 0],
    ["cancelled", 0],
    ["completed", 1],
  ]);
  expect(ledger.events.every((e) => e.origin === "order")).toBe(true);
  expect(new Set(ledger.sources.map((s) => s.fingerprint)).size).toBe(4);
  // Exact repeat: no event, no revision change and no write.
  const stored = JSON.stringify(entries.get("purchases"));
  const again = await service.importOrders();
  expect(again.purchaseImport).toEqual({
    source: "orders",
    added: 0,
    updated: 0,
    duplicate: 4,
  });
  expect(JSON.stringify(entries.get("purchases"))).toBe(stored);
  // The pending order is delivered: the same event is updated, never duplicated.
  const history = provider.orderHistory!;
  provider.orderHistory = async (limit) =>
    (await history(limit)).map((order) =>
      order.orderId === "fixture-order-2"
        ? {
            ...order,
            state: "completed" as const,
            items: [
              {
                name: "Ruisleipä",
                quantity: 1,
                unit: "pcs" as const,
                unitPrice: 229,
              },
            ],
          }
        : order,
    );
  const updated = await service.importOrders();
  expect(updated.purchaseImport).toEqual({
    source: "orders",
    added: 0,
    updated: 1,
    duplicate: 3,
  });
  const next = await service.purchases.ledger();
  expect(next.events).toHaveLength(4);
  expect(next.events[1]).toMatchObject({
    status: "completed",
    id: ledger.events[1].id,
  });
  expect(
    next.sources.find((s) => s.id === ledger.events[1].sourceIds[0]),
  ).toMatchObject({
    revision: 2,
    importedAt: ledger.sources[1].importedAt,
  });
  // Nothing else moved: no list change, quote, AI request or retailer write.
  expect(service.state).toEqual(state);
  expect(provider.writes).toBe(0);
  expect(provider.searchRequests).toBe(0);
  expect(provider.orderReads).toBe(3);
  // Order IDs appear nowhere; backups carry the sanitized records and diagnostics none of it.
  const backup = JSON.stringify(await service.exportBackup());
  expect(backup).toContain("Kevytmaito 1 l");
  expect(backup).not.toContain("fixture-order");
  expect(JSON.stringify(diagnostics(service.snapshot(), {}))).not.toMatch(
    /Kevytmaito|Ruisleipä|fixture-order/,
  );
});

test("order import needs a chain with an order read and a failed read changes nothing", async () => {
  const { service, provider, entries } = await development();
  provider.failSearch = true;
  await expect(service.importOrders()).rejects.toThrow("storeBusy");
  expect(entries.has("purchases")).toBe(false);
  expect(service.snapshot().purchaseImport).toBeNull();
  // K-Ruoka has no established order read: its stand-in offers none.
  const k = new DemoProvider("k-ruoka");
  expect(k.capabilities.orderHistory).toBe(false);
  expect(k.orderHistory).toBeUndefined();
  const only = new Service(memoryStorage().storage);
  only.registry.register(k);
  await only.init();
  await expect(only.importOrders()).rejects.toThrow("ordersUnavailable");
  // A live chain that is not signed in is refused before any read.
  const live = new Service(memoryStorage().storage);
  const s = new DemoProvider("s-kaupat");
  live.registry.register(s);
  await live.init();
  await expect(live.importOrders()).rejects.toThrow("ordersUnavailable");
  expect(s.orderReads).toBe(0);
});
