import { expect, test } from "vitest";
import { planningFixtureReply } from "../src/ai/planning-fixtures";
import { inferenceTasks } from "../src/ai/tasks";
import { EDIT_UNDO_KEY } from "../src/application/edits";
import type { PlanningRun } from "../src/application/planning";
import { Service } from "../src/application/service";
import { requirements } from "../src/domain/planner";
import { DemoProvider } from "../src/stores/demo";
import { editPlan } from "./helpers/edit-plan";
import { ScriptedInferenceProvider } from "./helpers/inference";
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
async function fixture(populated = true) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const state = editPlan();
  state.staples = [coffee];
  if (populated) {
    state.note = "pastaa ja keittoa";
    state.assumptions = "Neljälle hengelle.";
    state.quantities = { "milk:ml": 3000 };
    state.specifications = { "pasta:g": "Täysjyväpasta" };
    state.calendar = {
      "2026-10-13": { mealIds: ["m-soup"], leftovers: false },
      "2026-10-14": { mealIds: [], leftovers: true },
    };
  } else {
    state.meals = [];
    state.extras = [];
    state.skipped = [];
    state.recurringPaused = true;
  }
  await store.storage.set("state", state);
  await service.init();
  if (populated) {
    await service.buildBasket();
    // An edit leaves an Undo and a summary; neither may survive the reset.
    await service.editLocally({
      revision: service.state.revision,
      operations: [{ op: "removeItem", rowKey: "ruisleipä:g" }],
    });
  }
  const provider = service.registry.get("demo-k") as DemoProvider;
  provider.searchRequests = 0;
  return { ...store, service, provider };
}
const reset = (service: Service) =>
  service.resetList({ revision: service.state.revision });
function ai(note: string, gate?: Promise<unknown>, fail = false) {
  const provider = new ScriptedInferenceProvider("reset-fixture", async () => {
    await gate;
    if (fail) throw new Error("aiFailed");
    return {
      completion: "complete",
      text: JSON.stringify(planningFixtureReply(note, 4)),
    };
  });
  provider.models[0].capabilities.tasks = inferenceTasks;
  return provider;
}
const bind =
  (provider: ScriptedInferenceProvider) => async (run: PlanningRun) =>
    run.bindInference(provider, (await provider.discoverModels(run.signal))[0]);

test("New list clears the whole current list and its screen state, and keeps everything else", async () => {
  const { service, provider, entries, storage } = await fixture();
  const before = structuredClone(service.state);
  expect(service.snapshot()).toMatchObject({
    editUndoAvailable: true,
    pricingState: "quoted",
  });
  const snapshot = await reset(service);
  expect(snapshot.state).toEqual({
    ...before,
    revision: before.revision + 1,
    meals: [],
    extras: [],
    skipped: [],
    removed: [],
    quantities: {},
    specifications: {},
    requestIntents: [],
    note: "",
    assumptions: "",
    recurringPaused: true,
    // The leftovers day is the shopper's own plan; only links to the removed meals go.
    calendar: { "2026-10-14": { mealIds: [], leftovers: true } },
    // The cleared meals become the latest earlier week.
    history: [
      { savedAt: snapshot.state.history[0].savedAt, meals: before.meals },
      ...before.history,
    ],
  });
  expect(snapshot.state.recipes).toEqual(before.recipes);
  expect(snapshot.state.staples).toEqual([coffee]);
  expect(snapshot.state.accepted).toEqual(before.accepted);
  expect(snapshot.state.listHistory).toEqual(before.listHistory);
  // A fresh screen: no rows, no price, no edit summary, no Undo, no preview, no review.
  expect(snapshot).toMatchObject({
    basket: [],
    quotedAt: null,
    pricingState: "empty",
    pricingError: null,
    edit: null,
    editUndoAvailable: false,
    planning: null,
    review: null,
    comparison: null,
    transferException: null,
    committedIntents: [],
    proposal: { sides: [], quantities: [] },
    reset: { revision: before.revision + 1 },
  });
  expect(requirements(snapshot.state)).toEqual([]);
  expect(entries.get("state")).toEqual(service.state);
  expect(entries.get("last-quote") ?? null).toBeNull();
  expect(entries.get(EDIT_UNDO_KEY) ?? null).toBeNull();
  await expect(
    service.undoEdit({ revision: service.state.revision }),
  ).rejects.toThrow("undoUnavailable");
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);

  // Resetting the empty list again changes nothing and still reports a reset.
  const again = await reset(service);
  expect(again.state).toEqual(snapshot.state);
  expect(again.reset).toMatchObject({ revision: snapshot.state.revision });

  // After a restart the list is empty, nothing is read, and no stale reset is announced.
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  expect(restarted.snapshot()).toMatchObject({
    basket: [],
    pricingState: "empty",
    reset: null,
    editUndoAvailable: false,
  });
  expect(restarted.state).toEqual(snapshot.state);
  expect(
    (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
  ).toBe(0);
});

test("a stale or failed reset changes nothing", async () => {
  const { service, entries, failNext, provider } = await fixture();
  const state = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  await expect(
    service.resetList({ revision: state.revision - 1 }),
  ).rejects.toThrow("draftStale");
  for (const invalid of [{}, { revision: "7" }, { revision: 8, all: true }])
    await expect(service.resetList(invalid)).rejects.toThrow();
  failNext("before");
  await expect(reset(service)).rejects.toThrow("storageFailed");
  failNext(null);
  expect(service.state).toEqual(state);
  expect(service.basket).toEqual(basket);
  expect(entries.get("state")).toEqual(state);
  expect(service.snapshot()).toMatchObject({
    editUndoAvailable: true,
    reset: null,
  });
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);
});

test("an unfinished planning run is discarded, its late reply cannot be committed, and a failed generation leaves the empty list", async () => {
  // A preview that is ready but not committed.
  const ready = await fixture(false);
  const planned = await ready.service.planShopping(
    { prompt: "1 l maitoa", consent: true },
    bind(ai("1 l maitoa")),
  );
  expect(planned.planning?.phase).toBe("ready");
  const cleared = await reset(ready.service);
  expect(cleared.planning).toBeNull();
  await expect(
    ready.service.commitPlanning({
      operationId: planned.planning!.operationId,
    }),
  ).rejects.toThrow("planningStale");
  expect(ready.service.state.extras).toEqual([]);

  // A reply that arrives after the reset.
  const late = await fixture();
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  const pending = late.service.planShopping(
    { prompt: "1 l maitoa", consent: true },
    bind(ai("1 l maitoa", gate)),
  );
  const settled = pending.then(
    () => "resolved",
    (error: Error) => error.message,
  );
  await new Promise((done) => setTimeout(done, 5));
  const during = await reset(late.service);
  expect(during.planning).toBeNull();
  release();
  expect(await settled).toMatch(/draftStale|aiCancelled|planningStale/);
  expect(late.service.state.meals).toEqual([]);
  expect(late.service.snapshot()).toMatchObject({
    basket: [],
    planning: null,
  });

  // A generation that fails after the reset leaves the new empty workspace as it is.
  const empty = structuredClone(late.service.state);
  await expect(
    late.service.planShopping(
      { prompt: "1 l maitoa", consent: true },
      bind(ai("1 l maitoa", undefined, true)),
    ),
  ).rejects.toThrow();
  expect(late.service.state).toEqual(empty);
  expect(late.service.basket).toEqual([]);

  // A successful generation fills it and brings the recurring item back.
  const done = await late.service.planShopping(
    { prompt: "1 l maitoa", consent: true },
    bind(ai("1 l maitoa")),
  );
  const committed = await late.service.commitPlanning({
    operationId: done.planning!.operationId,
  });
  expect(committed.state.recurringPaused).toBe(false);
  expect(committed.reset).toBeNull();
  expect(committed.basket.map((l) => l.requirement.name).sort()).toEqual([
    "Kahvi",
    "Maito",
  ]);
});

test("the transfer record survives a reset, and a reset waits for a write in flight", async () => {
  const { service, provider } = await fixture();
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
  expect(service.journal?.status).toBe("verified");
  const journal = structuredClone(service.journal);
  const carts = JSON.stringify([...provider.carts]);
  const listHistory = structuredClone(service.state.listHistory);
  const writes = provider.writes;
  const snapshot = await reset(service);
  // The record stays; only the next transfer no longer counts it as already sent.
  expect(snapshot.journal).toEqual({ ...journal, listClosed: true });
  expect(snapshot.state.listHistory).toEqual(listHistory);
  expect(JSON.stringify([...provider.carts])).toBe(carts);
  expect(provider.writes).toBe(writes);

  // A partly written transfer keeps its recovery evidence; only its review is hidden.
  const partial = await fixture();
  partial.provider.failAfter = 1;
  await partial.service.transferDisplayed({
    revision: partial.service.state.revision,
    quotedAt: partial.service.quotedAt!,
    batchKey: partial.service.snapshot().transferBatchKey,
  });
  expect(partial.service.journal?.status).toBe("partial");
  const evidence = structuredClone(partial.service.journal);
  const after = await reset(partial.service);
  expect(after.journal).toEqual(evidence);
  expect(after.review).toBeNull();
  expect(after.state.meals).toEqual([]);

  // While a write is in flight the reset is refused with its own reason and nothing changes.
  const busy = await fixture();
  const state = structuredClone(busy.service.state);
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  const write = busy.provider.setQuantity.bind(busy.provider);
  busy.provider.setQuantity = async (context, target) => {
    await gate;
    return write(context, target);
  };
  const click = busy.service.transferDisplayed({
    revision: busy.service.state.revision,
    quotedAt: busy.service.quotedAt!,
    batchKey: busy.service.snapshot().transferBatchKey,
  });
  await new Promise((done) => setTimeout(done, 20));
  await expect(reset(busy.service)).rejects.toThrow("transferInProgress");
  expect(busy.service.state).toEqual(state);
  release();
  await click;
  expect(busy.service.journal?.status).toBe("verified");
  // Any other running operation refuses it as busy.
  busy.service.busy = true;
  await expect(reset(busy.service)).rejects.toThrow("busy");
  busy.service.busy = false;
  expect(busy.service.state.meals).toHaveLength(3);
});

test("Clear list keeps its own Undo and summary, separate from New list", async () => {
  const { service } = await fixture();
  const cleared = await service.clearList({ revision: service.state.revision });
  expect(cleared).toMatchObject({
    edit: { status: "cleared" },
    editUndoAvailable: true,
    reset: null,
  });
  const undone = await service.undoEdit({ revision: service.state.revision });
  expect(undone.state.meals).toHaveLength(3);
});
