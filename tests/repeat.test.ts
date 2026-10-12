import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { editTargets } from "../src/domain/edits";
import { initialState, type AppState } from "../src/domain/model";
import { DemoProvider } from "../src/stores/demo";
import { memoryStorage } from "./helpers/purchase-fixtures";

/** A list of soup, milk and an unknown grocery, transferred once at the demo K store. */
async function transferred(change: (state: AppState) => void = () => {}) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const state = initialState();
  state.staples = [];
  state.household.budget = 100_000;
  state.meals = [
    { id: "m-soup", recipeId: "soup", day: 0, servings: 4, leftovers: false },
  ];
  state.extras = [
    { id: "milk", name: "Maito", amount: 2000, unit: "ml" },
    { id: "sahrami", name: "Sahrami", amount: 1, unit: "g" },
  ];
  state.skipped = ["carrot:g"];
  state.quantities = { "potato:g": 1500 };
  state.note = "keitto ja maitoa";
  await store.storage.set("state", state);
  await service.init();
  await service.buildBasket();
  const provider = service.registry.get("demo-k") as DemoProvider;
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
  if (service.review)
    await service.execute({ id: service.review.id, acknowledged: true });
  expect(service.journal?.status).toBe("verified");
  const [entry] = service.state.listHistory;
  // The shopper has since started a new week and the history entry may be altered for a case.
  await service.newWeek();
  const next = structuredClone(service.state);
  change(next);
  if (JSON.stringify(next) !== JSON.stringify(service.state)) {
    await store.storage.set("state", next);
    await service.init();
  }
  return { ...store, service, provider, entry };
}
const repeat = (service: Service, historyId: string) =>
  service.repeatList({ historyId, revision: service.state.revision });

test("repeat restores the transferred list with fresh prices, no AI request and no retailer write", async () => {
  const { service, provider, entry, entries } = await transferred();
  expect(service.state.meals).toEqual([]);
  const writes = provider.writes;
  const carts = JSON.stringify([...provider.carts]);
  const revision = service.state.revision;
  const snapshot = await repeat(service, entry.id);
  expect(snapshot.state.revision).toBe(revision + 1);
  expect(snapshot.state.meals).toMatchObject([
    { recipeId: "soup", servings: 4 },
  ]);
  expect(snapshot.state.meals[0].id).not.toBe("m-soup");
  expect(snapshot.state).toMatchObject({
    extras: entry.extras,
    skipped: ["carrot:g"],
    quantities: { "potato:g": 1500 },
    note: "keitto ja maitoa",
    requestIntents: [],
  });
  // Rows: potato (explicit 1,5 kg), cream, milk and the grocery no store search finds.
  expect(
    snapshot.basket.map((l) => [l.requirement.id, l.packs, l.total]),
  ).toEqual([
    ["potato", 2, 398],
    ["cream", 1, 109],
    ["milk", 2, 238],
    ["sahrami", 0, null],
  ]);
  expect(snapshot.repeat).toEqual({
    historyId: entry.id,
    revision: revision + 1,
    transferredAt: entry.date,
    rows: 4,
    unresolvedRows: 1,
    storeChanged: false,
    partialHistory: false,
    missingRecipes: [],
    changedPrices: [],
    notSelected: [],
  });
  expect(snapshot.quotedAt).not.toBeNull();
  expect(snapshot.review).toBeNull();
  expect(snapshot.developmentRequests).toBe(0);
  // Nothing was written to the store: the cart is as the earlier transfer left it.
  expect(provider.writes).toBe(writes);
  expect(JSON.stringify([...provider.carts])).toBe(carts);
  expect(entries.get("state")).toEqual(service.state);
  // The repeated list is an ordinary list: edits can target its rows and meal.
  const targets = editTargets(service.state);
  expect(targets.rows.map((r) => r.key)).toEqual([
    "potato:g",
    "carrot:g",
    "cream:ml",
    "milk:ml",
    "sahrami:g",
  ]);
  expect(targets.meals).toMatchObject([{ recipeId: "soup" }]);
  // An unchanged repeat is the same batch as the verified transfer, so the existing duplicate
  // guard holds: pressing transfer again writes nothing without the explicit repeat approval.
  expect(snapshot.transferBatchKey).toBe(service.journal?.batchKey);
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: snapshot.transferBatchKey,
  });
  expect(provider.writes).toBe(writes);
  // The result describes its own revision only.
  await service.omit("milk:ml");
  expect(service.snapshot().repeat).toBeNull();
});

test("changed prices are shown against the transfer, and another store compares nothing", async () => {
  const { service, provider, entry } = await transferred();
  provider.priceChange = true;
  const dearer = await repeat(service, entry.id);
  expect(dearer.repeat!.changedPrices).toEqual([
    { name: "Peruna 1 kg", before: 199, now: 219 },
    { name: "Ruokakerma 2 dl", before: 109, now: 129 },
    { name: "Maito 1 l", before: 119, now: 139 },
  ]);
  expect(dearer.repeat!.notSelected).toEqual([]);
  provider.priceChange = false;

  const elsewhere = await transferred();
  await elsewhere.service.save({
    ...elsewhere.service.state,
    context: {
      providerId: "demo-s",
      storeId: "demo-helsinki",
      storeName: "S (demo)",
      fulfillment: "pickup",
    },
  });
  const other = await repeat(elsewhere.service, elsewhere.entry.id);
  expect(other.repeat).toMatchObject({
    storeChanged: true,
    changedPrices: [],
    notSelected: [],
    rows: 4,
  });
  // Prices are the other store's own fresh ones.
  expect(other.basket[2]).toMatchObject({
    product: { providerId: "demo-s" },
    total: 258,
  });
});

test("a product that is no longer chosen, a missing recipe and partial history are reported honestly", async () => {
  // The transferred potato pack is not what the store offers now.
  const gone = await transferred((state) => {
    state.listHistory[0].transferred[0] = {
      ...state.listHistory[0].transferred[0],
      productId: "potato-old",
      name: "Peruna 2 kg",
    };
  });
  expect(
    (await repeat(gone.service, gone.entry.id)).repeat!.notSelected,
  ).toEqual(["Peruna 2 kg"]);

  // The recipe was deleted since, and the entry kept no copy: the meal is left out, not guessed.
  const missing = await transferred((state) => {
    state.recipes = state.recipes.filter((r) => r.id !== "soup");
    state.listHistory[0].recipes = [];
  });
  const withoutMeal = await repeat(missing.service, missing.entry.id);
  expect(withoutMeal.state.meals).toEqual([]);
  expect(withoutMeal.repeat).toMatchObject({
    missingRecipes: ["soup"],
    partialHistory: true,
    rows: 2,
  });
  expect(withoutMeal.basket.map((l) => l.requirement.id)).toEqual([
    "milk",
    "sahrami",
  ]);

  // The entry's own copy restores a recipe the shopper deleted.
  const restored = await transferred((state) => {
    state.recipes = state.recipes.filter((r) => r.id !== "soup");
  });
  const again = await repeat(restored.service, restored.entry.id);
  expect(again.state.recipes.some((r) => r.id === "soup")).toBe(true);
  expect(again.repeat).toMatchObject({
    missingRecipes: [],
    partialHistory: false,
  });

  // An entry from before stores and products were kept: usable, labelled partial.
  const old = await transferred((state) => {
    state.listHistory[0] = {
      ...state.listHistory[0],
      storeKey: "",
      transferred: [],
      prices: {},
    };
  });
  expect((await repeat(old.service, old.entry.id)).repeat).toMatchObject({
    partialHistory: true,
    storeChanged: true,
    changedPrices: [],
    rows: 4,
  });
});

test("a stale, unknown or failed repeat keeps the current list", async () => {
  const { service, provider, entry, entries } = await transferred();
  await service.save({
    ...service.state,
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
  });
  await service.buildBasket();
  const state = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  await expect(
    service.repeatList({ historyId: entry.id, revision: state.revision - 1 }),
  ).rejects.toThrow("draftStale");
  await expect(
    service.repeatList({ historyId: "nope", revision: state.revision }),
  ).rejects.toThrow("historyMissing");
  await expect(service.repeatList({ historyId: entry.id })).rejects.toThrow();
  provider.failSearch = true;
  await expect(repeat(service, entry.id)).rejects.toThrow("storeBusy");
  provider.failSearch = false;
  expect(service.state).toEqual(state);
  expect(service.basket).toEqual(basket);
  expect(entries.get("state")).toEqual(state);
  expect(service.busy).toBe(false);
  expect(service.snapshot().repeat).toBeNull();
  // The list in progress is archived like any replaced list when a repeat succeeds.
  await service.save({
    ...service.state,
    meals: [
      { id: "x", recipeId: "pasta", day: 0, servings: 2, leftovers: false },
    ],
  });
  const done = await repeat(service, entry.id);
  expect(done.state.history[0].meals).toMatchObject([{ recipeId: "pasta" }]);
});
