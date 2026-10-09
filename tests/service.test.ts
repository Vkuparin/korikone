import { test, expect } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
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

test("automatically chooses available products and respects explicit swaps and brand preferences", async () => {
  const service = new Service(memory());
  const provider = service.registry.get("demo-k") as DemoProvider;
  const search = provider.searchProducts.bind(provider);
  provider.searchProducts = async (...args) => {
    const products = await search(...args);
    return products.flatMap((p) => [
      { ...p, id: p.id + "-brand", name: "Brand coffee", price: 500 },
      { ...p, id: p.id + "-store", name: "Pirkka kahvi", price: 600 },
      { ...p, id: p.id + "-unavailable", price: 1, available: false },
    ]);
  };
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("coffee-brand");
  await service.save({ ...service.state, productPreference: "storeBrand" });
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("coffee-store");
  await service.accept({ ingredientId: "coffee", productId: "coffee-brand" });
  expect(service.basket[0].product?.id).toBe("coffee-brand");
  await service.save({
    ...service.state,
    productPreference: "avoidStoreBrand",
    accepted: {},
  });
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("coffee-brand");
});

test("approved drafts replace the list while retaining saved recipes, and stale drafts cannot overwrite edits", async () => {
  const service = new Service(memory());
  service.draft = {
    recipes: [],
    meals: [{ day: 0, recipeId: "pasta", servings: 4, leftovers: false }],
    items: [{ id: "pizza", name: "Pakastepizza", amount: 700, unit: "g" }],
    notes: "Two pizzas",
  };
  service.draftRevision = service.state.revision;
  service.draftNote = "Pasta and pizza";
  await service.approveDraft();
  expect(service.state.extras[0].amount).toBe(700);
  expect(service.state.note).toBe("Pasta and pizza");
  expect(service.state.assumptions).toBe("Two pizzas");
  expect(service.state.recipes).toHaveLength(3);
  service.draft = {
    recipes: [],
    meals: [],
    items: [{ id: "x", name: "x", amount: 1, unit: "pcs" }],
    notes: "",
  };
  service.draftRevision = service.state.revision;
  await service.save({ ...service.state, extras: [] });
  await expect(service.approveDraft()).rejects.toThrow("draftStale");
});

test("partial batches explicitly record missing requirements without hiding them from the list", async () => {
  const service = new Service(memory());
  service.state.extras = [
    { id: "missing", name: "Missing product", amount: 1, unit: "pcs" },
  ];
  await service.buildBasket();
  await expect(service.prepare()).rejects.toThrow("unresolved");
  await service.prepare({ allowMissing: true });
  expect(service.review?.unresolved?.map((r) => r.name)).toEqual([
    "Missing product",
  ]);
  expect(service.review?.targets).toHaveLength(1);
  await service.execute({ id: service.review!.id, acknowledged: false });
  expect(service.state.history).toHaveLength(1);
  expect(service.state.extras).toHaveLength(1);
  expect(service.journal?.review.unresolved).toHaveLength(1);
});
