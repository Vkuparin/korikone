import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { applyEdits } from "../src/domain/edits";
import { DemoProvider } from "../src/stores/demo";
import { editNow as now, editPlan } from "./helpers/edit-plan";
import { memoryStorage } from "./helpers/purchase-fixtures";

async function quoted(
  change: (state: ReturnType<typeof editPlan>) => void = () => {},
) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const state = editPlan();
  change(state);
  await store.storage.set("state", state);
  await service.init();
  await service.buildBasket();
  const provider = service.registry.get("demo-k") as DemoProvider;
  provider.searchRequests = 0;
  return { ...store, service, provider };
}
const line = (service: Service, key: string) =>
  service.basket.find(
    (l) => `${l.requirement.id}:${l.requirement.unit}` === key,
  );
const local = (service: Service, operations: unknown[]) =>
  service.editLocally({ revision: service.state.revision, operations });

test("removing a row is immediate and local: every other row keeps its product, price and time", async () => {
  const { service, provider, entries } = await quoted();
  const quotedAt = service.quotedAt;
  const others = structuredClone(
    service.basket.filter((l) => l.requirement.id !== "pasta"),
  );
  // Preparing a transfer checks current prices; the removal after it must read nothing.
  await service.prepare({ allowMissing: true });
  provider.searchRequests = 0;
  const snapshot = await local(service, [
    { op: "removeItem", rowKey: "pasta:g" },
  ]);
  expect(provider.searchRequests).toBe(0);
  expect(snapshot.basket).toEqual(others);
  expect(snapshot.quotedAt).toBe(quotedAt);
  expect(snapshot.state.removed).toEqual(["pasta:g"]);
  expect(snapshot.state.revision).toBe(8);
  // The prepared approval is void, and the removal can be undone locally.
  expect(snapshot.review).toBeNull();
  expect(snapshot.edit).toMatchObject({
    status: "applied",
    applied: [{ op: "removeItem", targetId: "row:pasta:g" }],
    delta: { price: { status: "exact", difference: -129 } },
  });
  expect(snapshot.editUndoAvailable).toBe(true);
  expect(entries.get("state")).toEqual(service.state);
  const undone = await service.undoEdit({ revision: 8 });
  expect(line(service, "pasta:g")).toMatchObject({ total: 129 });
  expect(undone.quotedAt).toBe(quotedAt);
  expect(provider.searchRequests).toBe(0);
  expect(provider.writes).toBe(0);
});

test("removing a meal subtracts only its share and recomputes packs from the products already read", async () => {
  const { service, provider, storage } = await quoted((state) => {
    state.skipped = [];
    // Lasagne shares tomato with pasta and milk with porridge and the carton.
    state.meals.push({
      id: "m-lasagne",
      recipeId: "lasagne",
      day: 3,
      servings: 4,
      leftovers: false,
    });
    state.calendar = {
      "2026-10-13": { mealIds: ["m-lasagne", "m-soup"], leftovers: false },
    };
  });
  expect(line(service, "tomato:g")).toMatchObject({
    requirement: { amount: 1200 },
    packs: 3,
    total: 297,
  });
  expect(line(service, "milk:ml")).toMatchObject({
    requirement: { amount: 2300 },
    packs: 3,
  });
  const potato = structuredClone(line(service, "potato:g"));
  const quotedAt = service.quotedAt;
  const snapshot = await local(service, [
    { op: "removeMeal", mealId: "m-lasagne" },
  ]);
  expect(provider.searchRequests).toBe(0);
  // Shared rows shrink to what the other sources need, with packs and totals recomputed.
  expect(line(service, "tomato:g")).toMatchObject({
    requirement: { amount: 800, sources: ["Tomaattipasta"] },
    packs: 2,
    total: 198,
  });
  expect(line(service, "milk:ml")).toMatchObject({
    requirement: { amount: 1800 },
    packs: 2,
    total: 238,
  });
  // The row only that dish needed is gone and an unrelated row is exactly as it was.
  expect(line(service, "lasagne-sheets:g")).toBeUndefined();
  expect(line(service, "potato:g")).toEqual(potato);
  expect(snapshot.quotedAt).toBe(quotedAt);
  expect(snapshot.state.meals.map((m) => m.id)).toEqual([
    "m-pasta",
    "m-soup",
    "m-porridge",
  ]);
  expect(snapshot.state.calendar["2026-10-13"].mealIds).toEqual(["m-soup"]);
  // The recipe stays saved.
  expect(snapshot.state.recipes.some((r) => r.id === "lasagne")).toBe(true);
  expect(snapshot.edit).toMatchObject({
    applied: [
      {
        op: "removeMeal",
        targetId: "meal:m-lasagne",
        name: "Lasagne",
        before: 4,
        after: 0,
      },
    ],
    delta: { meals: [{ change: "removed", name: "Lasagne" }] },
  });
  // After a restart the same quote is restored without a read.
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  expect(restarted.basket).toEqual(service.basket);
  expect(restarted.snapshot().editUndoAvailable).toBe(true);
  expect(
    (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
  ).toBe(0);
});

test("servings, quantity and at-home changes are local too; a row with nothing read stays unpriced", async () => {
  const { service, provider } = await quoted();
  const snapshot = await local(service, [
    { op: "changeServings", mealId: "m-soup", servings: 8 },
    { op: "markAtHome", rowKey: "pasta:g", atHome: true },
    {
      op: "changeQuantity",
      rowKey: "milk:ml",
      quantity: { kind: "packs", count: 3 },
    },
    // Carrot was at home when prices were read, so nothing is known about it.
    { op: "markAtHome", rowKey: "carrot:g", atHome: false },
  ]);
  expect(provider.searchRequests).toBe(0);
  expect(line(service, "potato:g")).toMatchObject({
    requirement: { amount: 1600 },
    packs: 2,
    total: 398,
  });
  expect(line(service, "milk:ml")).toMatchObject({
    requirement: { amount: 3000 },
    packs: 3,
    total: 357,
  });
  expect(line(service, "pasta:g")).toBeUndefined();
  expect(line(service, "carrot:g")).toMatchObject({
    product: null,
    total: null,
    candidates: [],
    matching: { reason: "bounded-out" },
  });
  // The difference is not stated while a changed row has no price.
  expect(snapshot.edit).toMatchObject({
    delta: { price: { status: "incomplete", difference: null } },
  });
  // An explicit update then reads prices as usual.
  await service.buildBasket();
  expect(line(service, "carrot:g")?.product).not.toBeNull();
});

test("a stale, invalid or failed local edit changes nothing, and other edits are not accepted here", async () => {
  const { service, provider, entries, failNext } = await quoted();
  const state = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  await expect(
    service.editLocally({
      revision: 6,
      operations: [{ op: "removeItem", rowKey: "pasta:g" }],
    }),
  ).rejects.toThrow("draftStale");
  await expect(
    local(service, [{ op: "removeItem", rowKey: "saffron:g" }]),
  ).rejects.toThrow("unknownTarget");
  await expect(
    local(service, [{ op: "removeMeal", mealId: "nope" }]),
  ).rejects.toThrow("unknownTarget");
  // Adding or replacing needs a catalogue read and is refused on this path.
  for (const operation of [
    {
      op: "addItem",
      name: "Kahvi",
      quantity: { kind: "amount", amount: 500, unit: "g" },
    },
    { op: "addMeal", recipe: { kind: "saved", recipeId: "lasagne" } },
    {
      op: "replaceMeal",
      mealId: "m-soup",
      replacement: { kind: "saved", recipeId: "lasagne" },
    },
    {
      op: "setItem",
      name: "Kahvi",
      quantity: { kind: "amount", amount: 500, unit: "g" },
    },
  ])
    await expect(local(service, [operation])).rejects.toThrow();
  await expect(local(service, [])).rejects.toThrow();
  failNext("before");
  await expect(
    local(service, [{ op: "removeItem", rowKey: "pasta:g" }]),
  ).rejects.toThrow("storageFailed");
  failNext(null);
  expect(service.state).toEqual(state);
  expect(service.basket).toEqual(basket);
  expect(entries.get("state")).toEqual(state);
  expect(service.snapshot().editUndoAvailable).toBe(false);
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);
});

test("without a quote a local edit saves the list and leaves it unpriced", async () => {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  await store.storage.set("state", editPlan());
  await service.init();
  const snapshot = await local(service, [
    { op: "removeMeal", mealId: "m-soup" },
  ]);
  expect(snapshot.state.meals).toHaveLength(2);
  expect(snapshot.basket).toEqual([]);
  expect(snapshot.quotedAt).toBeNull();
  expect((service.registry.get("demo-k") as DemoProvider).searchRequests).toBe(
    0,
  );
});

test("removing a requested dish settles its request instead of leaving it missing", () => {
  const state = editPlan();
  state.note = "tomaattipasta";
  state.requestIntents = [
    {
      intent: {
        id: "intent-0-13",
        kind: "meal",
        label: "tomaattipasta",
        evidence: { start: 0, end: 13, quote: "tomaattipasta" },
        provenance: "explicit-note",
        quantity: null,
        mealIndex: 0,
        itemIndex: null,
        unresolvedReason: null,
      },
      recipeId: "pasta",
      requirementKeys: ["pasta:g", "tomato:g"],
    },
  ];
  const { state: next } = applyEdits(
    state,
    {
      version: 1,
      revision: 7,
      operations: [{ op: "removeMeal", mealId: "m-pasta" }],
    },
    { now },
  );
  expect(next.requestIntents).toEqual([]);
  expect(next.meals.map((m) => m.id)).toEqual(["m-soup", "m-porridge"]);
});
