import { test, expect } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
import { priceRises } from "../src/domain/prices";
import { attention } from "../src/ui/confirm";
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

test("diagnostics carry no observed prices", async () => {
  const service = new Service(memory());
  await ready(service);
  expect((await service.priceHistory()).length).toBeGreaterThan(0);
  const report = JSON.stringify(
    diagnostics(service.snapshot(), { app: "test" }),
  );
  expect(report).not.toMatch(/priceHistory|unitPrice|prices:/);
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

test("a verified transfer remembers what it paid, and only a rise of more than 5 % is reported", async () => {
  const service = new Service(memory());
  await ready(service);
  await service.execute({ id: service.review!.id, acknowledged: true });
  const [latest] = service.state.listHistory;
  const paid = Object.entries(latest.prices);
  expect(latest.storeKey).toBe("demo-k:demo-helsinki");
  expect(latest.transferred.map((t) => [t.productId, t.price])).toEqual(paid);
  expect(paid.length).toBe(
    service.review ? 0 : service.basket.filter((l) => l.product).length,
  );

  const lines = service.basket.filter((l) => l.product);
  const at = (price: number) =>
    lines.map((l) => ({ ...l, product: { ...l.product!, price } }));
  const [id, price] = paid[0];
  const one = (p: number) => at(p).filter((l) => l.product!.id === id);
  expect(priceRises(one(Math.floor(price * 1.05)), [latest])).toEqual([]);
  expect(
    priceRises(one(price + Math.ceil(price * 0.06)), [latest]),
  ).toHaveLength(1);
  // A fall is not a rise.
  expect(priceRises(one(Math.floor(price * 0.5)), [latest])).toEqual([]);
  // A product the history never included is left out; an empty history reports nothing.
  expect(priceRises(one(price * 3), [{ prices: {} }])).toEqual([]);
  expect(priceRises(one(price * 3), [])).toEqual([]);
  // The newest transfer that included the product decides.
  expect(
    priceRises(one(price * 3), [{ prices: { [id]: price * 3 } }, latest]),
  ).toEqual([]);

  // The demo store's small price change (3 %) stays below the limit.
  const provider = service.registry.get("demo-k") as DemoProvider;
  provider.priceChange = true;
  await service.buildBasket();
  await service.prepare();
  const small = attention(service.review!, 100000, service.state.listHistory);
  expect(small.risen).toEqual([]);
  const big = attention(
    { ...service.review!, quotes: at(price * 2) },
    100000,
    service.state.listHistory,
  );
  expect(big.risen.map((r) => r.productId)).toEqual([id]);
});
