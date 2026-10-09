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
test("displayed transfer writes once and remains protected after restart", async () => {
  const storage = memory();
  const service = new Service(storage);
  await ready(service);
  const approval = {
    revision: service.state.revision,
    quotedAt: service.quotedAt,
    batchKey: service.snapshot().transferBatchKey,
  };
  await service.transferDisplayed(approval);
  expect(service.journal?.status).toBe("verified");
  const provider = service.registry.get("demo-k") as DemoProvider;
  const writes = provider.writes;
  await service.transferDisplayed(approval);
  expect(provider.writes).toBe(writes);
  const restarted = new Service(storage);
  await restarted.init();
  await restarted.transferDisplayed({
    revision: restarted.state.revision,
    quotedAt: restarted.quotedAt,
    batchKey: restarted.snapshot().transferBatchKey,
  });
  expect((restarted.registry.get("demo-k") as DemoProvider).writes).toBe(0);
});
test("displayed transfer stops for budget, changed prices and stale approval", async () => {
  const service = new Service(memory());
  await ready(service);
  const approval = {
    revision: service.state.revision,
    quotedAt: service.quotedAt,
    batchKey: service.snapshot().transferBatchKey,
  };
  service.state.household.budget = 0;
  await service.transferDisplayed(approval);
  expect(service.transferException).toBe("acknowledgeReview");
  expect(service.review).not.toBeNull();
  const provider = service.registry.get("demo-k") as DemoProvider;
  expect(provider.writes).toBe(0);
  service.state.household.budget = 12000;
  provider.priceChange = true;
  await service.transferDisplayed(approval);
  expect(service.transferException).toBe("priceChanged");
  expect(provider.writes).toBe(0);
  await expect(
    service.transferDisplayed({ ...approval, revision: 999 }),
  ).rejects.toThrow("draftStale");
});
test("concurrent displayed approvals cannot add duplicate quantities", async () => {
  const service = new Service(memory());
  await ready(service);
  const approval = {
    revision: service.state.revision,
    quotedAt: service.quotedAt,
    batchKey: service.snapshot().transferBatchKey,
  };
  const outcomes = await Promise.allSettled([
    service.transferDisplayed(approval),
    service.transferDisplayed(approval),
  ]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(service.journal?.status).toBe("verified");
  expect((service.registry.get("demo-k") as DemoProvider).writes).toBe(
    service.journal!.review.targets.length,
  );
});
test("existing quantities and missing rows require an exception decision before writes", async () => {
  const service = new Service(memory());
  await ready(service);
  const provider = service.registry.get("demo-k") as DemoProvider;
  const cart = await provider.getCart(service.state.context);
  const product = service.basket[0].product!;
  cart.lines.push({
    productId: product.id,
    name: product.name,
    quantity: 2,
    unit: product.nativeUnit,
  });
  provider.carts.set(JSON.stringify(service.state.context), cart);
  const approval = {
    revision: service.state.revision,
    quotedAt: service.quotedAt,
    batchKey: service.snapshot().transferBatchKey,
  };
  await service.transferDisplayed(approval);
  expect(service.transferException).toBe("acknowledgeReview");
  expect(service.review!.targets[0].before).toBe(2);
  expect(provider.writes).toBe(0);
  await service.save({
    ...service.state,
    extras: [{ id: "unknown", name: "Unknown food", amount: 1, unit: "pcs" }],
  });
  await service.buildBasket();
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt,
    batchKey: service.snapshot().transferBatchKey,
  });
  expect(service.review!.unresolved!.map((line) => line.id)).toContain(
    "unknown",
  );
  expect(provider.writes).toBe(0);
});
test("changed packs and account changes cannot substitute the approved batch", async () => {
  const service = new Service(memory());
  await ready(service);
  const provider = service.registry.get("demo-k") as DemoProvider;
  const search = provider.searchProducts.bind(provider);
  provider.searchProducts = async (...args) =>
    (await search(...args)).map((product) => ({
      ...product,
      packAmount: product.packAmount * 2,
    }));
  const approval = {
    revision: service.state.revision,
    quotedAt: service.quotedAt,
    batchKey: service.snapshot().transferBatchKey,
  };
  await service.transferDisplayed(approval);
  expect(service.review).toBeNull();
  expect(service.transferException).toBe("priceChanged");
  expect(provider.writes).toBe(0);
  provider.searchProducts = search;
  await service.transferDisplayed(approval);
  const cart = await provider.getCart(service.state.context);
  cart.accountId = "different-account";
  provider.carts.set(JSON.stringify(service.state.context), cart);
  await expect(service.transferDisplayed(approval)).rejects.toThrow(
    "accountChanged",
  );
  expect(provider.writes).toBe(service.journal!.review.targets.length);
});
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
test("model-only preference preserves quote and review across persistence", async () => {
  const storage = memory();
  const service = new Service(storage);
  await ready(service);
  const before = structuredClone(service.snapshot());
  await service.setAIModel("fixture-large");
  expect(service.state.revision).toBe(before.state.revision);
  expect(service.review).toEqual(before.review);
  expect(service.basket).toEqual(before.basket);
  expect(service.quotedAt).toEqual(before.quotedAt);
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.state.aiModel).toBe("fixture-large");
  expect(restarted.basket).toEqual(before.basket);
});
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
      { ...p, id: p.id + "-brand", name: "Brand kahvi", price: 500 },
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
  expect(service.state.listHistory).toHaveLength(1);
  expect(service.state.extras).toHaveLength(1);
  expect(service.journal?.review.unresolved).toHaveLength(1);
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

test("automatic choices cannot bypass household exclusions through saved products or brand preferences", async () => {
  const service = new Service(memory());
  const provider = service.registry.get("demo-k") as DemoProvider;
  const search = provider.searchProducts.bind(provider);
  provider.searchProducts = async (...args) =>
    (await search(...args)).flatMap((p) => [
      { ...p, id: "excluded", name: "Pirkka kahvi", price: 100 },
      { ...p, id: "allowed", name: "Other kahvi", price: 600 },
    ]);
  service.state.productPreference = "storeBrand";
  service.state.household.exclusions = "pirkka";
  service.state.accepted["demo-k:demo-helsinki:coffee"] = ["excluded"];
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("allowed");
  expect(service.basket[0].excluded).toBe(1);
  await expect(
    service.accept({ ingredientId: "coffee", productId: "excluded" }),
  ).rejects.toThrow("unresolved");
});

test("a language change during transfer-history persistence retains both updates", async () => {
  const storage = memory();
  const service = new Service(storage);
  await ready(service);
  const originalSet = storage.set;
  let entered!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  storage.set = async (key, value) => {
    if (
      key === "state" &&
      (value as any).listHistory.length &&
      (value as any).language === "fi"
    ) {
      entered();
      await gate;
    }
    return originalSet(key, value);
  };
  const transfer = service.execute({
    id: service.review!.id,
    acknowledged: false,
  });
  await writing;
  const language = service.setLanguage("en");
  release();
  await Promise.all([transfer, language]);
  expect(service.state.language).toBe("en");
  expect(service.state.listHistory).toHaveLength(1);
  expect(await storage.get("state")).toEqual(service.state);
});

test("live stores choose the ingredient itself, not a cheaper compound, variant or ready meal", async () => {
  const service = new Service(memory());
  await service.init();
  const context = {
    providerId: "s-kaupat",
    storeId: "631940293",
    storeName: "S-market Herttoniemi",
    fulfillment: "pickup" as const,
  };
  const names: Record<string, [string, number, number, "g" | "pcs"][]> = {
    sipuli: [
      ["Coop valkosipuli 100 g", 89, 100, "g"],
      ["Kotimaista sipuli 500 g", 89, 500, "g"],
    ],
    jauheliha: [
      ["Kotimaista kanan jauheliha 4% 400 g", 329, 400, "g"],
      ["Kotimaista sika-nauta jauheliha 23 % 400 g", 385, 400, "g"],
    ],
    kananmuna: [["Kotimaista vapaan kanan munat M6 348 g", 175, 6, "pcs"]],
  };
  service.registry.register({
    id: "s-kaupat",
    capabilities: { catalogue: true, cart: true, orderHistory: false },
    searchStores: async () => [context],
    searchProducts: async (_c, _q, ingredientId) =>
      names[ingredientId].map(([name, price, packAmount, unit], i) => ({
        id: `${ingredientId}-${i}`,
        providerId: "s-kaupat",
        storeId: context.storeId,
        ingredientId,
        name,
        packAmount,
        unit,
        price,
        available: true,
        deposit: 0,
        nativeUnit: "kpl",
        increment: 1,
        observedAt: new Date().toISOString(),
      })),
    getCart: async () => ({ accountId: "s-kaupat:x", context, lines: [] }),
    setQuantity: async () => {},
  });
  service.state.context = context;
  service.state.meals = [];
  service.state.staples = [];
  service.state.extras = [
    { id: "sipuli", name: "Sipuli", amount: 100, unit: "g" },
    { id: "jauheliha", name: "Jauheliha", amount: 400, unit: "g" },
    { id: "kananmuna", name: "Kananmuna", amount: 2, unit: "pcs" },
  ];
  await service.buildBasket();
  expect(service.basket.map((l) => l.product?.name)).toEqual([
    "Kotimaista sipuli 500 g",
    "Kotimaista sika-nauta jauheliha 23 % 400 g",
    "Kotimaista vapaan kanan munat M6 348 g",
  ]);
});
