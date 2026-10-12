import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider, demoOrders, demoWeeklyOrders } from "../src/stores/demo";
import { memoryStorage } from "./helpers/purchase-fixtures";
import { fixtureText, receiptFixtures } from "./fixtures/receipts";

/**
 * Registered development histories (F6.4). The `history` scenario of `Service.scenario` adds the
 * weekly S-kaupat order sequence from `demoWeeklyOrders`; receipt histories are the fixtures of
 * `tests/fixtures/receipts` imported through `importReceiptText`. Nothing is live.
 */
async function development() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  service.registry.register(new DemoProvider("s-kaupat"));
  await service.init();
  service.storeLogins["s-kaupat"] = "signedIn";
  return { ...store, service };
}
const now = new Date();

test("the default order history is unchanged and the scenario adds a deterministic weekly sequence", async () => {
  const { service } = await development();
  await service.importOrders();
  expect((await service.purchases.ledger()).events).toHaveLength(
    demoOrders.length,
  );
  expect((await service.purchaseInsights(now)).suggestions).toEqual([]);

  await service.scenario("history");
  const orders = demoWeeklyOrders(now);
  // Six completed weeks, one cancelled and one with unreadable rows.
  expect(orders.filter((o) => o.state === "completed")).toHaveLength(7);
  expect(demoWeeklyOrders(now)).toEqual(orders);
  const imported = await service.importOrders();
  expect(imported.purchaseImport).toMatchObject({
    source: "orders",
    added: orders.length,
    duplicate: demoOrders.length,
  });
  // Importing again adds nothing.
  expect((await service.importOrders()).purchaseImport).toMatchObject({
    added: 0,
    duplicate: demoOrders.length + orders.length,
  });
});

test("the sequence gives milk as an evidence-backed suggestion; bananas stay unresolved and coffee has no cadence", async () => {
  const { service } = await development();
  await service.scenario("history");
  await service.importOrders();
  const insights = await service.purchaseInsights(now);
  const names = insights.suggestions.map((s) => s.label.toLowerCase());
  expect(names.some((n) => n.includes("kevytmaito"))).toBe(true);
  // Two coffee visits establish no cadence.
  expect(names.some((n) => n.includes("kahvi"))).toBe(false);
  expect(insights.suggestions.length).toBeLessThanOrEqual(5);
  const milk = insights.suggestions.find((s) =>
    s.label.toLowerCase().includes("kevytmaito"),
  )!;
  // Six weekly visits of two pieces: at least four of eight weeks and a typical quantity of two.
  expect(milk.weeksOfLastEight).toBeGreaterThanOrEqual(4);
  expect(milk.typical).toMatchObject({ amount: 2, unit: "pcs" });
  // No rule reads bananas, so they are honest uncertainty, not a guessed category.
  expect(insights.unresolved.map((u) => u.label)).toContain("Banaani");
  expect(names.some((n) => n.includes("banaani"))).toBe(false);
  // Cancelled and unreadable orders are never observations.
  const ledger = await service.purchases.ledger();
  expect(ledger.events.some((e) => e.status === "cancelled")).toBe(true);
  expect(
    (await service.memory()).purchases.every((p) =>
      ledger.events.some((e) => e.id === p.eventId && e.status === "completed"),
    ),
  ).toBe(true);
  // Nothing was added to any list and no request left the device.
  expect(service.snapshot().state.staples).toEqual(
    (await development()).service.snapshot().state.staples,
  );
});

test("an empty history and two receipts give no suggestion, and a dismissal keeps one away", async () => {
  const { service } = await development();
  expect((await service.purchaseInsights(now)).suggestions).toEqual([]);
  for (const id of ["s-basic-campaign", "trip-distinct"]) {
    const fixture = receiptFixtures.find((f) => f.id === id)!;
    await service.importReceiptText({
      text: fixtureText(fixture),
      format: "txt",
    });
  }
  // Two visits establish no weekly cadence.
  expect((await service.purchaseInsights(now)).suggestions).toEqual([]);

  await service.scenario("history");
  await service.importOrders();
  const before = (await service.purchaseInsights(now)).suggestions;
  expect(before.length).toBeGreaterThan(0);
  await service.dismissSuggestion({ key: before[0].key });
  const after = (await service.purchaseInsights(now)).suggestions;
  expect(after.map((s) => s.key)).not.toContain(before[0].key);
});
