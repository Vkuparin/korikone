import { test, expect } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
import { diagnostics } from "../src/application/diagnostics";
function memory() {
  const entries = new Map<string, unknown>();
  return {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
}
async function ready(service: Service) {
  await service.init();
  await service.buildBasket();
  for (const line of [...service.basket])
    await service.accept({
      ingredientId: line.requirement.id,
      productId: line.candidates.find((p) => p.available)!.id,
    });
  await service.prepare();
}
test("language-only changes preserve the approval and quantities", async () => {
  const service = new Service(memory());
  await ready(service);
  const review = structuredClone(service.review);
  const revision = service.state.revision;
  await service.setLanguage("en");
  expect(service.review).toEqual(review);
  expect(service.state.revision).toBe(revision);
});

test("failed saves preserve saved state and existing approval", async () => {
  const storage = memory();
  const service = new Service(storage);
  await ready(service);
  const before = structuredClone(service.snapshot());
  storage.set = async () => {
    throw new Error("storageFailed");
  };
  await expect(
    service.save({
      ...service.state,
      household: { ...service.state.household, servings: 2 },
    }),
  ).rejects.toThrow("storageFailed");
  expect(service.snapshot()).toEqual(before);
  await expect(service.setLanguage("en")).rejects.toThrow("storageFailed");
  expect(service.snapshot()).toEqual(before);
});

test("a language change during a save retains both edits in storage", async () => {
  const storage = memory();
  const service = new Service(storage);
  await service.init();
  await Promise.all([
    service.save({
      ...service.state,
      household: { ...service.state.household, servings: 2 },
    }),
    service.setLanguage("en"),
  ]);
  expect(service.state.language).toBe("en");
  expect(service.state.household.servings).toBe(2);
  expect(await storage.get("state")).toEqual(service.state);
});
test("store switching preserves meals and invalidates review without writing carts", async () => {
  const service = new Service(memory());
  await ready(service);
  const meals = structuredClone(service.state.meals);
  await service.save({
    ...service.state,
    context: { ...service.state.context, providerId: "demo-s" },
  });
  expect(service.state.meals).toEqual(meals);
  expect(service.review).toBeNull();
  expect((service.registry.get("demo-k") as DemoProvider).writes).toBe(0);
  expect((service.registry.get("demo-s") as DemoProvider).writes).toBe(0);
});
test("transfer does not advance staple cadence; purchase confirmation does", async () => {
  const service = new Service(memory());
  await ready(service);
  await service.execute({ id: service.review!.id, acknowledged: false });
  expect(service.journal?.status).toBe("verified");
  expect(service.state.staples[0].lastPurchased).toBeNull();
  await service.confirmPurchase();
  const purchased = service.state.staples[0].lastPurchased;
  expect(purchased).not.toBeNull();
  await service.confirmPurchase();
  expect(service.state.staples[0].lastPurchased).toBe(purchased);
});
test("rejects stale and duplicate approvals and enforces budget acknowledgement", async () => {
  const service = new Service(memory());
  await service.init();
  service.state.household.budget = 0;
  await ready(service);
  const id = service.review!.id;
  await expect(service.execute({ id, acknowledged: false })).rejects.toThrow(
    "acknowledgeReview",
  );
  await service.execute({ id, acknowledged: true });
  await expect(service.execute({ id, acknowledged: true })).rejects.toThrow(
    "reviewRequired",
  );
});
test("restart retains partial operations and reconciles successful timeout writes", async () => {
  const storage = memory();
  const service = new Service(storage);
  await ready(service);
  (service.registry.get("demo-k") as DemoProvider).failAfter = 1;
  await service.execute({ id: service.review!.id, acknowledged: false });
  expect(service.journal?.status).toBe("partial");
  const resumed = new Service(storage);
  await resumed.init();
  await resumed.recover();
  expect(resumed.review?.targets).toHaveLength(0);
  await resumed.execute({ id: resumed.review!.id, acknowledged: false });
  expect(resumed.journal?.status).toBe("verified");
});

test("omitting a basket line skips it and rematches the rest", async () => {
  const service = new Service(memory());
  await service.init();
  await service.buildBasket();
  const key = "coffee:g";
  expect(
    service.basket.some(
      (l) => `${l.requirement.id}:${l.requirement.unit}` === key,
    ),
  ).toBe(true);
  await service.omit(key);
  expect(service.state.skipped).toContain(key);
  expect(
    service.basket.some(
      (l) => `${l.requirement.id}:${l.requirement.unit}` === key,
    ),
  ).toBe(false);
  await expect(service.omit("missing:g")).rejects.toThrow("unresolved");
});

test("a new week keeps the old plan for reuse without duplicates", async () => {
  const service = new Service(memory());
  await service.init();
  await expect(service.reuseWeek()).rejects.toThrow("noEarlierWeek");
  await service.save({
    ...service.state,
    meals: [
      { id: "a", day: 0, recipeId: "pasta", servings: 4, leftovers: false },
    ],
  });
  await service.newWeek();
  expect(service.state.meals).toEqual([]);
  expect(service.state.history).toHaveLength(1);
  await service.reuseWeek();
  expect(service.state.meals).toMatchObject([
    { day: 0, recipeId: "pasta", servings: 4 },
  ]);
  expect(service.state.meals[0].id).not.toBe("a");
  await service.newWeek();
  expect(service.state.history).toHaveLength(1);
});

test("diagnostics leave out recipes, products and account details", async () => {
  const service = new Service(memory());
  await ready(service);
  const report = JSON.stringify(
    diagnostics(
      {
        ...service.snapshot(),
        ai: { state: "connected", email: "a@b.fi", error: null, models: [] },
      },
      { app: "test" },
    ),
  );
  for (const secret of [
    "Tomaattipasta",
    "Pasta 500 g",
    "demo-household",
    "a@b.fi",
  ])
    expect(report).not.toContain(secret);
  expect(JSON.parse(report).counts.recipes).toBe(3);
});
