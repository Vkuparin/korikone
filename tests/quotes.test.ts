import { expect, test } from "vitest";
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
async function ready() {
  const storage = memory();
  const service = new Service(storage);
  await service.init();
  await service.save(service.state);
  await service.buildBasket();
  return { service, storage };
}

test("retained quotes load without catalogue calls and stay out of AppState and diagnostics", async () => {
  const { service, storage } = await ready();
  const before = service.snapshot();
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.basket).toEqual(before.basket);
  expect(restarted.quotedAt).toBe(before.quotedAt);
  expect(
    (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
  ).toBe(0);
  expect(await storage.get("state")).not.toHaveProperty("basket");
  expect(JSON.stringify(diagnostics(restarted.snapshot(), {}))).not.toContain(
    "Kahvi 500 g",
  );
  await restarted.prepare();
  expect(
    (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
  ).toBe(1);
});

test("profiles with no previous quote or an invalid cache make no catalogue requests", async () => {
  const storage = memory();
  for (const quote of [null, { key: "bad" }]) {
    await storage.set("last-quote", quote);
    const service = new Service(storage);
    await service.init();
    expect(service.basket).toEqual([]);
    expect(service.quotedAt).toBeNull();
    expect(
      (service.registry.get("demo-k") as DemoProvider).searchRequests,
    ).toBe(0);
  }
});

test("a cached quote from another store is ignored even if its key was copied", async () => {
  const { storage } = await ready();
  const cached = (await storage.get("last-quote")) as { context: object };
  await storage.set("last-quote", {
    ...cached,
    context: { ...cached.context, storeId: "other-store" },
  });
  const service = new Service(storage);
  await service.init();
  expect(service.basket).toEqual([]);
  expect(service.quotedAt).toBeNull();
});

test("a catalogue failure after an explicit edit shows the saved list without incompatible prices", async () => {
  const { service, storage } = await ready();
  const provider = service.registry.get("demo-k") as DemoProvider;
  provider.failSearch = true;
  const result = await service.refreshAfterChange(() =>
    service.save({ ...service.state, quantities: { "coffee:g": 1000 } }),
  );
  expect(result.state.quantities).toEqual({ "coffee:g": 1000 });
  expect(result.basket).toEqual([]);
  expect(result.quotedAt).toBeNull();
  expect(result.pricingError).toBe("storeBusy");
  expect(
    ((await storage.get("state")) as { quantities: object }).quantities,
  ).toEqual({ "coffee:g": 1000 });
  provider.failSearch = false;
  await service.buildBasket();
  expect(service.basket[0].packs).toBe(2);
  expect(service.pricingError).toBeNull();
});

test.each(["accept", "omit"] as const)(
  "%s retains its saved edit when the subsequent catalogue request fails",
  async (operation) => {
    const { service, storage } = await ready();
    await service.save({
      ...service.state,
      extras: [{ id: "potato", name: "Peruna", amount: 800, unit: "g" }],
    });
    await service.buildBasket();
    const line = service.basket.find(
      (line) => line.requirement.id === "coffee",
    )!;
    (service.registry.get("demo-k") as DemoProvider).failSearch = true;
    const result =
      operation === "accept"
        ? await service.accept({
            ingredientId: "coffee",
            productId: line.product!.id,
          })
        : await service.omit("coffee:g");
    expect(result.pricingError).toBe("storeBusy");
    expect(result.basket).toEqual([]);
    expect(result.quotedAt).toBeNull();
    const saved = (await storage.get("state")) as typeof service.state;
    if (operation === "accept")
      expect(Object.values(saved.accepted)).toContainEqual([line.product!.id]);
    else expect(saved.skipped).toContain("coffee:g");
  },
);

test("changed quantities and stores invalidate incompatible cached quotes", async () => {
  const { service, storage } = await ready();
  await service.save({ ...service.state, quantities: { "coffee:g": 1000 } });
  expect(service.basket).toEqual([]);
  expect(service.quotedAt).toBeNull();
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.basket).toEqual([]);
  await restarted.refreshAfterChange(() =>
    restarted.save({
      ...restarted.state,
      context: { ...restarted.state.context, providerId: "demo-s" },
    }),
  );
  expect(restarted.basket[0].product?.providerId).toBe("demo-s");
  expect(restarted.basket[0].packs).toBe(2);
  expect(
    (restarted.registry.get("demo-s") as DemoProvider).searchRequests,
  ).toBe(1);
});

test("calendar, language, budget and unrelated recipe edits reuse compatible quotes", async () => {
  const { service, storage } = await ready();
  const quote = service.quotedAt;
  const basket = structuredClone(service.basket);
  const requests = (service.registry.get("demo-k") as DemoProvider)
    .searchRequests;
  await service.setLanguage("en");
  await service.refreshAfterChange(() =>
    service.save({
      ...service.state,
      calendar: { "2026-10-09": { mealIds: [], leftovers: true } },
      household: { ...service.state.household, budget: 1 },
      recipes: [
        ...service.state.recipes,
        { ...service.state.recipes[0], id: "unused" },
      ],
    }),
  );
  expect(service.basket).toEqual(basket);
  expect(service.quotedAt).toBe(quote);
  expect((service.registry.get("demo-k") as DemoProvider).searchRequests).toBe(
    requests,
  );
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.basket).toEqual(basket);
});

test("fresh review rejects a price rise after loading a retained quote", async () => {
  const { service, storage } = await ready();
  const restarted = new Service(storage);
  await restarted.init();
  (restarted.registry.get("demo-k") as DemoProvider).priceChange = true;
  await expect(restarted.prepare()).rejects.toThrow("priceChanged");
  expect(restarted.basket).toEqual(service.basket);
  expect((restarted.registry.get("demo-k") as DemoProvider).writes).toBe(0);
});

test("retailer and storage failures preserve the last successful quote", async () => {
  const { service, storage } = await ready();
  const basket = structuredClone(service.basket);
  const quotedAt = service.quotedAt;
  const provider = service.registry.get("demo-k") as DemoProvider;
  const search = provider.searchProducts.bind(provider);
  provider.searchProducts = async () => {
    throw new Error("storeBusy");
  };
  await expect(service.buildBasket()).rejects.toThrow("storeBusy");
  expect(service.basket).toEqual(basket);
  provider.searchProducts = search;
  provider.priceChange = true;
  storage.set = async () => {
    throw new Error("storageFailed");
  };
  await expect(service.buildBasket()).rejects.toThrow("storageFailed");
  expect(service.basket).toEqual(basket);
  expect(service.quotedAt).toBe(quotedAt);
});

test("changed state during a catalogue request cannot publish a stale quote", async () => {
  const { service } = await ready();
  const provider = service.registry.get("demo-k") as DemoProvider;
  const search = provider.searchProducts.bind(provider);
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider.searchProducts = async (...args) => {
    start();
    await gate;
    return search(...args);
  };
  const pending = service.buildBasket();
  await started;
  await service.save({ ...service.state, quantities: { "coffee:g": 1000 } });
  release();
  await expect(pending).rejects.toThrow("draftStale");
  expect(service.basket).toEqual([]);
});
