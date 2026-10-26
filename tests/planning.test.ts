import { expect, test } from "vitest";
import {
  PlanningLifecycle,
  planningLimits,
  planningSnapshotSchema,
  planningFailure,
} from "../src/application/planning";
import { initialState, type Requirement } from "../src/domain/model";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { interpretShopping } from "../src/ai/output";
import { InferenceError, InferenceSession } from "../src/ai/provider";
import { shoppingDraftTask } from "../src/ai/tasks";
import { matchRequirement } from "../src/domain/matching";
import { retailerEvidence } from "../src/stores/candidates";
import { createFixtureService } from "./fixtures/ai-shopping/environment";

function setup() {
  let state = initialState();
  state.staples = [];
  const lifecycle = new PlanningLifecycle(() => state);
  const events: unknown[] = [];
  lifecycle.onChange = (value) => events.push(value);
  const provider = new ScriptedInferenceProvider(
    "planning-local",
    async () => ({
      text: JSON.stringify({
        items: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
      }),
      completion: "complete",
    }),
  );
  const run = lifecycle.start("Maitoa");
  const session = run.bindInference(provider, provider.models[0]);
  return {
    lifecycle,
    run,
    session,
    provider,
    events,
    get state() {
      return state;
    },
    replace: (next: typeof state) => {
      state = next;
    },
  };
}

test("shutdown cancels a pending planning run without mutating saved state", () => {
  const state = initialState();
  const before = structuredClone(state);
  const lifecycle = new PlanningLifecycle(() => state);
  const run = lifecycle.start("1 l maitoa");
  expect(() => lifecycle.cancelForShutdown()).not.toThrow();
  expect(run.signal.aborted).toBe(true);
  expect(lifecycle.snapshot()!.phase).toBe("cancelled");
  expect(state).toEqual(before);
});
const requirement: Requirement = {
  id: "milk",
  name: "Maito",
  amount: 1000,
  unit: "ml",
  sources: ["extra"],
};
async function interpreted() {
  const state = setup();
  state.run.publishDraft(
    await interpretShopping(state.session, "Maitoa", state.run.sourceState()),
  );
  return state;
}
test("typed lifecycle pins provider/model and exposes only domain-validated provisional meals and rows", async () => {
  const state = await interpreted();
  expect(state.lifecycle.snapshot()).toMatchObject({
    phase: "interpreted",
    source: { revision: 0, note: "Maitoa" },
    model: { providerId: "planning-local", modelId: "same-model-name" },
    transferEligible: false,
    counters: { aiCalls: 1, searches: 0 },
  });
  state.run.setRequirements([requirement]);
  const before = state.lifecycle.snapshot();
  state.run.publishRow({
    ...matchRequirement(requirement, []),
    product: { id: "fabricated" } as never,
    packs: 20,
    total: 1,
  });
  expect(state.lifecycle.snapshot()!.provisional.rows[0]).toMatchObject({
    status: "unresolved",
    product: null,
    total: null,
    packs: 0,
    reason: "empty-search",
  });
  expect(before!.provisional.rows[0].status).toBe("pending");
  expect(state.state.extras).toEqual([]);
  expect(
    state.events.every(
      (event) => planningSnapshotSchema.safeParse(event).success,
    ),
  ).toBe(true);
  expect(Object.isFrozen(state.lifecycle.snapshot()!.provisional.rows)).toBe(
    true,
  );
  expect(() =>
    state.run.bindInference(state.provider, state.provider.models[0]),
  ).toThrow("planningPhase");
});
test("invalid draft references and provider deltas cannot become provisional planning events", () => {
  const state = setup();
  expect(() =>
    state.run.publishDraft({
      recipes: [],
      meals: [{ recipeId: "invented", day: 0, servings: 2, leftovers: false }],
      items: [],
      notes: "",
    }),
  ).toThrow("invalidDraft");
  expect(
    planningSnapshotSchema.safeParse({ type: "text-delta", text: '{"meals":' })
      .success,
  ).toBe(false);
  expect(
    planningSnapshotSchema.safeParse({
      ...state.lifecycle.snapshot(),
      transferEligible: true,
    }).success,
  ).toBe(false);
  expect(
    planningSnapshotSchema.safeParse({
      ...state.lifecycle.snapshot(),
      phase: "committed",
    }).success,
  ).toBe(false);
  expect(state.lifecycle.snapshot()!.provisional.meals).toEqual([]);
});
test.each(["note", "store", "model", "preferences", "quantity"])(
  "%s changes obsolete the run and reject late output",
  async (field) => {
    const state = await interpreted();
    const next = structuredClone(state.state);
    if (field === "note") next.note = "Different note";
    if (field === "store") next.context.storeId = "other";
    if (field === "model") next.aiModel = "different-model";
    if (field === "preferences")
      next.categoryPreferences = [
        {
          category: "milk",
          qualifiers: [{ kind: "fat", value: "whole" }],
          strength: "required",
        },
      ];
    if (field === "quantity") next.quantities = { "milk:ml": 2000 };
    state.replace(next);
    expect(state.lifecycle.snapshot()).toMatchObject({
      phase: "obsolete",
      failure: "source-changed",
      provisional: { meals: [], rows: [] },
    });
    expect(state.run.signal.aborted).toBe(true);
    expect(() => state.run.setRequirements([requirement])).toThrow(
      "draftStale",
    );
  },
);
test("appearance and calendar changes preserve source; a superseded operation cannot cancel its replacement", async () => {
  const state = await interpreted();
  state.replace({
    ...state.state,
    appearance: "dark",
    calendar: { "2026-10-10": { mealIds: [], leftovers: true } },
  });
  expect(state.lifecycle.snapshot()!.phase).toBe("interpreted");
  const newer = state.lifecycle.start("Kahvia");
  expect(state.run.snapshot()).toMatchObject({
    phase: "obsolete",
    failure: "superseded",
  });
  expect(() =>
    state.lifecycle.control({ operationId: state.run.operationId }),
  ).toThrow("planningStale");
  expect(newer.signal.aborted).toBe(false);
  state.lifecycle.control(
    { operationId: newer.operationId, reason: "note-changed" },
    true,
  );
  expect(newer.snapshot().phase).toBe("obsolete");
});
test("search slots and per-row/global reads are bounded and releases are idempotent", async () => {
  const state = await interpreted();
  const rows = Array.from({ length: 100 }, (_, i) => ({
    ...requirement,
    id: `milk-${i}`,
  }));
  state.run.setRequirements(rows);
  const a = state.run.beginSearch("milk-0:ml"),
    b = state.run.beginSearch("milk-1:ml");
  expect(() => state.run.beginSearch("milk-2:ml")).toThrow(
    "planningConcurrency",
  );
  a();
  a();
  b();
  state.run.beginSearch("milk-0:ml")();
  state.run.beginSearch("milk-0:ml")();
  expect(() => state.run.beginSearch("milk-0:ml")).toThrow("planningLimit");
  state.run.beginSearch("milk-1:ml")();
  state.run.beginSearch("milk-1:ml")();
  for (let i = 2; i < 100; i++)
    for (let n = 0; n < 3; n++)
      if (
        state.lifecycle.snapshot()!.counters.searches < planningLimits.searches
      )
        state.run.beginSearch(`milk-${i}:ml`)();
  expect(() => state.run.beginSearch("milk-99:ml")).toThrow("planningLimit");
  expect(state.lifecycle.snapshot()!.counters.searches).toBe(200);
});
test("partial coverage records every bounded requirement and ready refuses pending rows", async () => {
  const state = await interpreted();
  const rows = Array.from({ length: 105 }, (_, i) => ({
    ...requirement,
    id: `milk-${i}`,
  }));
  state.run.setRequirements(rows);
  expect(
    state.lifecycle
      .snapshot()!
      .coverage.filter((row) => row.status === "bounded-out"),
  ).toHaveLength(5);
  expect(state.lifecycle.snapshot()!.provisional.rows).toHaveLength(100);
  expect(() => state.run.ready()).toThrow("planningPhase");
  expect(() => state.run.resolving()).toThrow("planningPhase");
  for (const row of rows.slice(0, 100))
    state.run.boundOutRequirement(`${row.id}:ml`);
  state.run.resolving();
  state.run.ready();
  expect(state.lifecycle.snapshot()!.coverage).toHaveLength(105);
  expect(state.lifecycle.snapshot()!.phase).toBe("ready");
});
test("commit events require the exact staged saved state and retain a false transfer flag", async () => {
  const state = await interpreted();
  state.run.setRequirements([requirement]);
  state.run.publishRow(matchRequirement(requirement, []));
  state.run.ready();
  const next = { ...state.state, revision: 1, note: "Maitoa" };
  expect(() => state.run.beginCommit({ ...next, revision: 2 })).toThrow(
    "draftStale",
  );
  state.run.beginCommit(next);
  expect(() => state.run.committed()).toThrow("planningPhase");
  state.replace(next);
  state.run.committed();
  expect(state.lifecycle.snapshot()).toMatchObject({
    phase: "committed",
    committedRevision: 1,
    transferEligible: false,
  });
  expect(state.state.extras).toEqual([]); // The lifecycle did not perform persistence.
});
test("terminal failure drops previews and exposes fixed codes without provider response bodies", async () => {
  const state = await interpreted();
  state.run.fail(new InferenceError("usageLimit"));
  expect(state.lifecycle.snapshot()).toMatchObject({
    phase: "failed",
    failure: "limit",
    provisional: { meals: [], rows: [] },
  });
  state.run.fail(new Error("private response body"));
  expect(state.lifecycle.snapshot()!.failure).toBe("limit");
  expect(planningFailure(new Error("private response body"))).toBe("provider");
});
test("task output/time bounds can only narrow the pinned session limits", async () => {
  const state = setup();
  await expect(
    state.session.invoke(
      shoppingDraftTask,
      "Tiny task",
      { mode: "text" },
      undefined,
      { maxOutputCharacters: 5, timeoutMs: 1000 },
    ),
  ).rejects.toMatchObject({ code: "invalidOutput" });
  expect(state.provider.calls[0].maxOutputCharacters).toBe(5);
  await state.session.invoke(
    shoppingDraftTask,
    "Larger requested bounds",
    { mode: "text" },
    undefined,
    { maxOutputCharacters: 1_000_000, timeoutMs: 600_000 },
  );
  expect(state.provider.calls[1].maxOutputCharacters).toBe(
    planningLimits.outputCharacters,
  );
  const provider = new ScriptedInferenceProvider(
    "bounded-time",
    async () => new Promise(() => {}),
  );
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 3, maxOutputCharacters: 1000, timeoutMs: 1000 },
    new AbortController().signal,
  );
  await expect(
    session.invoke(
      shoppingDraftTask,
      "Short deadline",
      { mode: "text" },
      undefined,
      { maxOutputCharacters: 1000, timeoutMs: 5 },
    ),
  ).rejects.toMatchObject({ code: "timeout" });
  expect(provider.calls).toHaveLength(1);
  expect(provider.signals[0].aborted).toBe(true);
});
test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s Service keeps provisional products out of saved quotes and transfer approval",
  async (chain) => {
    const { service, tools } = await createFixtureService(chain, {
      "*": [{ id: "milk-real", name: "Kevytmaito 1 l", price: 1 }],
    });
    await service.save({ ...service.state, extras: [requirement] });
    await service.buildBasket();
    const before = structuredClone(service.snapshot());
    const run = service.planning.start("Maitoa");
    const provider = new ScriptedInferenceProvider(
      "preview-local",
      async () => ({
        text: JSON.stringify({
          items: [{ id: "milk", name: "Maito", amount: 2000, unit: "ml" }],
        }),
        completion: "complete",
      }),
    );
    const session = run.bindInference(provider, provider.models[0]);
    run.publishDraft(
      await interpretShopping(session, "Maitoa", run.sourceState()),
    );
    const revised = { ...requirement, amount: 2000 };
    run.setRequirements([revised]);
    run.publishRow(
      matchRequirement(revised, [
        {
          ...service.basket[0].candidates[0],
          id: "provisional-only",
          evidence: retailerEvidence("Kevytmaito 1 l"),
        },
      ]),
    );
    expect(service.snapshot().planning!.provisional.rows[0].product!.id).toBe(
      "provisional-only",
    );
    expect(service.state).toEqual(before.state);
    expect(service.basket).toEqual(before.basket);
    const reads = tools.length;
    await expect(service.prepare()).rejects.toThrow("planningPending");
    await expect(service.transferDisplayed({})).rejects.toThrow(
      "planningPending",
    );
    await expect(service.execute({})).rejects.toThrow("planningPending");
    expect(service.review).toEqual(before.review);
    expect(tools).toHaveLength(reads);
    expect(tools.some((name) => /add|update|write/.test(name))).toBe(false);
  },
);

test("B5.9: switching FI/EN keeps a running plan; changing the note still makes it obsolete", () => {
  const planning = setup();
  planning.replace({ ...planning.state, language: "en" });
  planning.lifecycle.invalidateFor(planning.state);
  expect(planning.lifecycle.snapshot()!.phase).not.toBe("obsolete");
  planning.replace({ ...planning.state, note: "Kermaa" });
  planning.lifecycle.invalidateFor(planning.state);
  expect(planning.lifecycle.snapshot()!.phase).toBe("obsolete");
});
