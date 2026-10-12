import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { requirements } from "../src/domain/planner";
import { DemoProvider } from "../src/stores/demo";
import { editPlan } from "./helpers/edit-plan";
import { memoryStorage } from "./helpers/purchase-fixtures";

const coffee = {
  id: "coffee",
  name: "Kahvi",
  amount: 500,
  unit: "g" as const,
  everyDays: 14,
  lastPurchased: null,
  enabled: true,
};
async function fixture(
  change: (state: ReturnType<typeof editPlan>) => void = () => {},
  quoted = true,
) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const state = editPlan();
  state.staples = [coffee];
  state.note = "pastaa ja keittoa";
  state.assumptions = "Neljälle hengelle.";
  state.calendar = {
    "2026-10-13": { mealIds: ["m-soup"], leftovers: false },
  };
  state.quantities = { "milk:ml": 3000 };
  change(state);
  await store.storage.set("state", state);
  await service.init();
  if (quoted) await service.buildBasket();
  const provider = service.registry.get("demo-k") as DemoProvider;
  provider.searchRequests = 0;
  return { ...store, service, provider };
}
const clear = (service: Service) =>
  service.clearList({ revision: service.state.revision });

test("clearing empties the list and keeps everything that is not the list", async () => {
  const { service, provider, entries } = await fixture();
  const before = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  const quotedAt = service.quotedAt;
  await service.prepare({ allowMissing: true });
  provider.searchRequests = 0;
  const snapshot = await clear(service);
  expect(snapshot.state).toEqual({
    ...before,
    revision: before.revision + 1,
    meals: [],
    extras: [],
    skipped: [],
    removed: [],
    quantities: {},
    requestIntents: [],
    calendar: {},
    note: "",
    assumptions: "",
    recurringPaused: true,
  });
  // Recipes, recurring definitions, settings and remembered choices are exactly as before.
  expect(snapshot.state.recipes).toEqual(before.recipes);
  expect(snapshot.state.staples).toEqual([coffee]);
  expect(snapshot.state.accepted).toEqual(before.accepted);
  expect(snapshot.state.household).toEqual(before.household);
  // The recurring coffee adds nothing to the cleared list.
  expect(requirements(snapshot.state)).toEqual([]);
  expect(snapshot.basket).toEqual([]);
  expect(snapshot.pricingState).toBe("empty");
  expect(snapshot.review).toBeNull();
  expect(snapshot.edit).toMatchObject({
    status: "cleared",
    applied: [
      { op: "removeMeal", name: "Tomaattipasta" },
      { name: "Peruna-porkkanakeitto" },
      { name: "Kaurapuuro" },
    ],
  });
  expect(snapshot.editUndoAvailable).toBe(true);
  expect(entries.get("state")).toEqual(service.state);
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);

  // Undo restores the list, its request text, the week plan and the earlier quote.
  const undone = await service.undoEdit({ revision: service.state.revision });
  expect(undone.state).toEqual({ ...before, revision: before.revision + 2 });
  expect(undone.basket).toEqual(basket);
  expect(undone.quotedAt).toBe(quotedAt);
  expect(undone.edit).toMatchObject({ status: "undone" });
  expect(undone.editUndoAvailable).toBe(false);
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);
});

test("an empty list has nothing to clear, and a stale or failed clear changes nothing", async () => {
  const empty = await fixture((state) => {
    state.meals = [];
    state.extras = [];
    state.staples = [];
    state.note = "";
    state.assumptions = "";
  }, false);
  const untouched = await clear(empty.service);
  expect(untouched.state.revision).toBe(7);
  expect(untouched.state.recurringPaused).toBe(false);
  expect(untouched.editUndoAvailable).toBe(false);
  expect(untouched.edit).toBeNull();

  const { service, entries, failNext, provider } = await fixture();
  const state = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  await expect(service.clearList({ revision: 6 })).rejects.toThrow(
    "draftStale",
  );
  await expect(service.clearList({})).rejects.toThrow();
  await expect(
    service.clearList({ revision: 7, everything: true }),
  ).rejects.toThrow();
  failNext("before");
  await expect(clear(service)).rejects.toThrow("storageFailed");
  failNext(null);
  expect(service.state).toEqual(state);
  expect(service.basket).toEqual(basket);
  expect(entries.get("state")).toEqual(state);
  expect(service.snapshot().editUndoAvailable).toBe(false);
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);
});

test("recurring items stay away after a restart and return on an explicit update or a new list", async () => {
  const { service, storage } = await fixture();
  await clear(service);
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  const provider = restarted.registry.get("demo-k") as DemoProvider;
  expect(restarted.state.recurringPaused).toBe(true);
  expect(restarted.snapshot()).toMatchObject({
    basket: [],
    pricingState: "empty",
    editUndoAvailable: true,
  });
  expect(provider.searchRequests).toBe(0);
  // Adding a row to the cleared list prices that row only; coffee is still held back.
  const added = await restarted.refreshAfterChange(() =>
    restarted.save({
      ...restarted.state,
      extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    }),
  );
  expect(added.basket.map((l) => l.requirement.name)).toEqual(["Maito"]);
  expect(restarted.state.recurringPaused).toBe(true);
  // The explicit price update brings the due recurring item back as a new revision.
  const revision = restarted.state.revision;
  const updated = await restarted.updatePrices();
  expect(updated.state.recurringPaused).toBe(false);
  expect(updated.state.revision).toBe(revision + 1);
  expect(updated.basket.map((l) => l.requirement.name).sort()).toEqual([
    "Kahvi",
    "Maito",
  ]);
  expect(updated.state.staples).toEqual([coffee]);

  // A new list resumes them as well.
  const other = await fixture();
  await clear(other.service);
  const reused = await other.service.reuseWeek().catch(() => null);
  expect(reused).toBeNull();
  await other.service.undoEdit({ revision: other.service.state.revision });
  expect(other.service.state.recurringPaused).toBe(false);
  expect(
    requirements(other.service.state).some((r) => r.name === "Kahvi"),
  ).toBe(true);
});

test("clearing after a verified transfer keeps the transfer record and writes nothing", async () => {
  const { service, provider } = await fixture();
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
  if (service.review)
    await service.execute({ id: service.review.id, acknowledged: true });
  expect(service.journal?.status).toBe("verified");
  const writes = provider.writes;
  const carts = JSON.stringify([...provider.carts]);
  const history = structuredClone(service.state.listHistory);
  const searches = provider.searchRequests;
  const snapshot = await clear(service);
  expect(snapshot.state.meals).toEqual([]);
  expect(snapshot.journal?.status).toBe("verified");
  expect(snapshot.state.listHistory).toEqual(history);
  expect(JSON.stringify([...provider.carts])).toBe(carts);
  expect([provider.writes, provider.searchRequests]).toEqual([
    writes,
    searches,
  ]);
  const undone = await service.undoEdit({ revision: service.state.revision });
  expect(undone.state.meals).toHaveLength(3);
  expect(undone.journal?.status).toBe("verified");
  expect(JSON.stringify([...provider.carts])).toBe(carts);
  expect(provider.writes).toBe(writes);
});

test("undo of a removed dish also restores its place in the week plan", async () => {
  const { service } = await fixture();
  await service.editLocally({
    revision: service.state.revision,
    operations: [{ op: "removeMeal", mealId: "m-soup" }],
  });
  expect(service.state.calendar["2026-10-13"].mealIds).toEqual([]);
  await service.undoEdit({ revision: service.state.revision });
  expect(service.state.calendar["2026-10-13"].mealIds).toEqual(["m-soup"]);
});
