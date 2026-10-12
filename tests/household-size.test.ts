import { expect, test } from "vitest";
import { householdScaling } from "../src/application/edits";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
import { editPlan } from "./helpers/edit-plan";
import { memoryStorage } from "./helpers/purchase-fixtures";

async function fixture(
  change: (state: ReturnType<typeof editPlan>) => void = () => {},
  quoted = true,
) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const state = editPlan();
  state.skipped = [];
  // The soup was deliberately planned for six; lasagne shares tomato and milk with other dishes.
  state.meals[1].servings = 6;
  state.meals.push({
    id: "m-lasagne",
    recipeId: "lasagne",
    day: 3,
    servings: 4,
    leftovers: false,
  });
  change(state);
  await store.storage.set("state", state);
  await service.init();
  if (quoted) await service.buildBasket();
  const provider = service.registry.get("demo-k") as DemoProvider;
  provider.searchRequests = 0;
  return { ...store, service, provider };
}
const line = (service: Service, key: string) =>
  service.basket.find(
    (l) => `${l.requirement.id}:${l.requirement.unit}` === key,
  );
const resize = (service: Service, servings: number) =>
  service.setHouseholdSize({ revision: service.state.revision, servings });

test("the preview names the meals that follow the new size and the ones that keep their own", () => {
  const state = editPlan();
  state.meals[1].servings = 6;
  expect(householdScaling(state, 2)).toEqual({
    from: 4,
    to: 2,
    scaled: [
      { mealId: "m-pasta", name: "Tomaattipasta", before: 4, after: 2 },
      { mealId: "m-porridge", name: "Kaurapuuro", before: 4, after: 2 },
    ],
    kept: [{ mealId: "m-soup", name: "Peruna-porkkanakeitto", servings: 6 }],
  });
  expect(householdScaling(state, 4)).toMatchObject({ scaled: [] });
});

test("a new household size scales the meals planned for the old one, locally and from the retained quote", async () => {
  const { service, provider, entries, storage } = await fixture((state) => {
    state.quantities = { "ruisleipä:g": 1000 };
  });
  const before = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  const quotedAt = service.quotedAt;
  const potato = structuredClone(line(service, "potato:g"));
  const bread = structuredClone(line(service, "paahtoleipä:g"));
  expect(line(service, "tomato:g")?.requirement.amount).toBe(1200);
  expect(service.previewHouseholdSize({ servings: 8 }).scaled).toHaveLength(3);
  await service.prepare({ allowMissing: true });
  provider.searchRequests = 0;

  const snapshot = await resize(service, 8);
  expect(provider.searchRequests).toBe(0);
  expect(snapshot.state.household).toEqual({
    ...before.household,
    servings: 8,
  });
  expect(snapshot.state.meals.map((m) => [m.id, m.servings])).toEqual([
    ["m-pasta", 8],
    ["m-soup", 6],
    ["m-porridge", 8],
    ["m-lasagne", 8],
  ]);
  // Recipe definitions, extras and the shopper's own row quantity are untouched.
  expect(snapshot.state.recipes).toEqual(before.recipes);
  expect(snapshot.state.extras).toEqual(before.extras);
  expect(snapshot.state.quantities).toEqual({ "ruisleipä:g": 1000 });
  expect(line(service, "ruisleipä:g")?.requirement.amount).toBe(1000);
  // Shared rows double exactly, with packs and totals recomputed from the products already read.
  expect(line(service, "tomato:g")).toMatchObject({
    requirement: { amount: 2400 },
    packs: 6,
    total: 594,
  });
  // The carton is an extra: only the dishes' share of the milk grows.
  const milk = line(service, "milk:ml")!;
  const milkBefore = basket.find((l) => l.requirement.id === "milk")!;
  expect(milk.requirement.amount).toBe(
    (milkBefore.requirement.amount - 1000) * 2 + 1000,
  );
  // The soup kept its six servings, so its rows and an extra are exactly as they were.
  expect(line(service, "potato:g")).toEqual(potato);
  expect(line(service, "paahtoleipä:g")).toEqual(bread);
  expect(snapshot.quotedAt).toBe(quotedAt);
  expect(snapshot.review).toBeNull();
  expect(snapshot.edit).toMatchObject({
    status: "resized",
    applied: [
      { op: "changeServings", targetId: "meal:m-pasta", before: 4, after: 8 },
      { op: "changeServings", targetId: "meal:m-porridge" },
      { op: "changeServings", targetId: "meal:m-lasagne" },
    ],
  });
  expect(entries.get("state")).toEqual(service.state);

  // The change and its undo survive a restart without a read.
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  expect(restarted.basket).toEqual(service.basket);
  expect(restarted.snapshot().editUndoAvailable).toBe(true);
  const undone = await restarted.undoEdit({
    revision: restarted.state.revision,
  });
  expect(undone.state).toEqual({ ...before, revision: before.revision + 2 });
  expect(undone.basket).toEqual(basket);
  expect(
    (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
  ).toBe(0);
  expect(provider.writes).toBe(0);
});

test("the same size is a no-op, and an invalid, stale or failed change saves nothing", async () => {
  const { service, entries, failNext, provider } = await fixture();
  const state = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  const same = await resize(service, 4);
  expect(same.state.revision).toBe(7);
  expect(same.editUndoAvailable).toBe(false);
  for (const servings of [0, -1, 2.5, 101, "3", null])
    await expect(
      service.setHouseholdSize({ revision: 7, servings }),
    ).rejects.toThrow();
  expect(() => service.previewHouseholdSize({ servings: 0 })).toThrow();
  await expect(
    service.setHouseholdSize({ revision: 6, servings: 2 }),
  ).rejects.toThrow("draftStale");
  failNext("before");
  await expect(resize(service, 2)).rejects.toThrow("storageFailed");
  failNext(null);
  expect(service.state).toEqual(state);
  expect(service.basket).toEqual(basket);
  expect(entries.get("state")).toEqual(state);
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);
});

test("without a quote the size and meals are saved and the list stays unpriced", async () => {
  const { service, provider } = await fixture(() => {}, false);
  const snapshot = await resize(service, 2);
  expect(snapshot.state.household.servings).toBe(2);
  expect(snapshot.state.meals.map((m) => m.servings)).toEqual([2, 6, 2, 2]);
  expect(snapshot.quotedAt).toBeNull();
  expect(snapshot.basket).toEqual([]);
  expect(provider.searchRequests).toBe(0);
  // With no meal at the old size only the setting changes.
  const only = await fixture((state) => {
    for (const meal of state.meals) meal.servings = 6;
  });
  const total = only.service.snapshot().basket.map((l) => l.total);
  const changed = await resize(only.service, 3);
  expect(changed.state.household.servings).toBe(3);
  expect(changed.edit).toMatchObject({ status: "resized", applied: [] });
  expect(changed.basket.map((l) => l.total)).toEqual(total);
  expect(changed.editUndoAvailable).toBe(true);
});
