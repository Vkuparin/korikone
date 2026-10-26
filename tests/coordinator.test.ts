import { expect, test, vi } from "vitest";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { inferenceTasks } from "../src/ai/tasks";
import { planningFixtureReply } from "../src/ai/planning-fixtures";
import { InferenceError } from "../src/ai/provider";
import { coordinatorLimits } from "../src/application/coordinator";
import type { PlanningRun } from "../src/application/planning";
import type { BaselineProduct } from "./fixtures/matching-baseline";

const milk: BaselineProduct = {
  id: "milk",
  name: "Kevytmaito 1 l",
  price: 150,
};
const creams: BaselineProduct[] = [
  { id: "cooking", name: "Ruokakerma 200 ml", price: 100 },
  { id: "whipping", name: "Kuohukerma 200 ml", price: 200 },
];
test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s neutral planning uses the chosen price basis without extra inference",
  async (chain) => {
    const env = await createFixtureService(chain, {
      "*": [
        { id: "small", name: "Basmati riisi 500 g", price: 2 },
        { id: "large", name: "Basmati riisi 1 kg", price: 3 },
      ],
    });
    for (const basis of ["unit", "total"] as const) {
      await env.service.setPriceBasis({ priceBasis: basis });
      const provider = ai("500 g riisiä");
      const reply = await env.service.planShopping(
        { prompt: "500 g riisiä", consent: true },
        bind(provider),
      );
      expect(reply.planning!.phase).toBe("ready");
      expect(reply.planning!.provisional.rows[0]).toMatchObject({
        product: { id: basis === "unit" ? "large" : "small" },
        packs: 1,
        total: basis === "unit" ? 300 : 200,
      });
      expect(reply.planning!.counters).toEqual({ aiCalls: 1, searches: 1 });
      await env.service.commitPlanning({
        operationId: reply.planning!.operationId,
      });
      expect(env.service.basket[0].priceBasis).toBe(basis);
    }
    expect(
      env.tools.every((tool) =>
        ["search_products", "check_basket"].includes(tool),
      ),
    ).toBe(true);
  },
);
function ai(note: string, repair = false) {
  let interpretations = 0;
  const provider = new ScriptedInferenceProvider(
    "coordinator-fixture",
    async () => ({
      completion: "complete",
      text:
        repair && interpretations++ === 0
          ? "{}"
          : JSON.stringify(planningFixtureReply(note, 4)),
    }),
  );
  provider.models[0].capabilities.tasks = inferenceTasks;
  return provider;
}
function bind(provider: ScriptedInferenceProvider) {
  return async (run: PlanningRun) => {
    const models = await provider.discoverModels(run.signal);
    return run.bindInference(provider, models[0]);
  };
}
async function setup(
  catalogue: Record<string, BaselineProduct[]> = { "*": [milk] },
) {
  const env = await createFixtureService("k-ruoka", catalogue);
  const before = structuredClone(env.service.snapshot());
  return { ...env, before };
}
function expectUnchanged(env: Awaited<ReturnType<typeof setup>>) {
  expect(env.service.state).toEqual(env.before.state);
  expect(env.service.basket).toEqual(env.before.basket);
  expect(env.service.review).toEqual(env.before.review);
  expect(env.service.journal).toEqual(env.before.journal);
  expect(
    env.tools.every(
      (tool) => tool === "search_products" || tool === "check_basket",
    ),
  ).toBe(true);
}

test("fresh planning clears row holds and one-time correction choices with the same note", async () => {
  const note = "1 l maitoa";
  const env = await setup({
    "*": [
      { ...milk, price: 1 },
      { ...milk, id: "other", name: "Rasvaton maito 1 l", price: 2 },
    ],
  });
  const plan = () =>
    env.service.planShopping({ prompt: note, consent: true }, bind(ai(note)));
  const first = await plan();
  await env.service.commitPlanning({
    operationId: first.planning!.operationId,
  });
  const row = env.service.basket[0].requirement;
  await env.service.correctRow({
    revision: env.service.state.revision,
    requirementKey: `${row.id}:${row.unit}`,
    reason: "wrong-product-type",
    replacementProductId: "other",
  });
  expect(env.service.basket[0].product?.id).toBe("other");
  const second = await plan();
  expect(second.planning!.provisional.rows[0].product?.id).toBe("milk");
  await env.service.commitPlanning({
    operationId: second.planning!.operationId,
  });
  expect(env.service.state.correctionChoices).toEqual([]);
  const currentRow = env.service.basket[0].requirement;
  await env.service.correctRow({
    revision: env.service.state.revision,
    requirementKey: `${currentRow.id}:${currentRow.unit}`,
    reason: "unsuitable-alternative",
    replacementProductId: null,
  });
  expect(env.service.basket[0].product).toBeNull();
  const third = await plan();
  await env.service.commitPlanning({
    operationId: third.planning!.operationId,
  });
  expect(env.service.basket[0].product?.id).toBe("milk");
  expect(env.service.state.correctionHolds).toEqual([]);
  expect(env.service.state.categoryPreferences).toEqual([]);
});
test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s: mixed identified requests reach ready without saving or transferring",
  async (chain) => {
    const env = await createFixtureService(chain, { "*": [milk] });
    const state = structuredClone(env.service.state);
    const note = "1 l maitoa ja kahvia";
    const provider = ai(note);
    const reply = await env.service.planShopping(
      { prompt: note, consent: true },
      bind(provider),
    );
    expect(reply.planning!.phase).toBe("ready");
    expect(
      reply.planning!.intents.map((intent) => [
        intent.intent.label,
        intent.status,
        intent.reason,
      ]),
    ).toEqual([
      ["1 l maitoa", "resolved", null],
      ["kahvia", "unresolved", "unknown-quantity"],
    ]);
    expect(reply.planning!.counters).toEqual({ aiCalls: 1, searches: 1 });
    const retained = env.service.planningResult(reply.planning!.operationId);
    expect(retained.intents).toEqual(reply.planning!.intents);
    expect(retained.coverage).toEqual(reply.planning!.coverage);
    expect(retained.requirements).toHaveLength(1);
    retained.state.note = "Changed returned clone";
    expect(
      env.service.planningResult(reply.planning!.operationId).state.note,
    ).toBe(note);
    expect((await env.service.operationMetrics()).at(-1)!.unresolved).toEqual({
      "missing-request": 1,
    });
    expect(
      env.service.planningResult(reply.planning!.operationId).resolver.status,
    ).toBe("skipped");
    expect(env.service.state).toEqual(state);
    expect(env.service.basket).toEqual([]);
    await expect(env.service.prepare()).rejects.toThrow("planningPending");
    expect(
      env.tools.filter(
        (tool) => tool !== "search_products" && tool !== "check_basket",
      ),
    ).toEqual([]);
  },
);
// Nothing shows resolver suggestions yet, so an ambiguous row never costs a resolver request,
// whatever an older profile saved. Re-enabling the resolver needs a UI for its suggestions first.
test.each([false, true])(
  "saved resolver setting %s: an ambiguous row needs approval without a resolver request",
  async (enabled) => {
    const env = await setup({ "*": creams });
    await env.service.save({ ...env.service.state, resolverEnabled: enabled });
    env.before = structuredClone(env.service.snapshot());
    const note = "200 ml kermaa";
    const provider = ai(note, true);
    const reply = await env.service.planShopping(
      { prompt: note, consent: true },
      bind(provider),
    );
    const result = env.service.planningResult(reply.planning!.operationId);
    expect(result.lines[0].product).toBeNull();
    expect(reply.planning!.intents[0].status).toBe("approval-required");
    expect(provider.calls.map((call) => call.task.id)).toEqual([
      "shopping-plan",
      "shopping-plan",
    ]);
    expect(result.resolver).toEqual({
      status: "skipped",
      failure: null,
      suggestions: [],
    });
    const metric = (await env.service.operationMetrics()).at(-1)!;
    expect(metric.aiCalls).toBe(2);
    expect(metric.repairCalls).toBe(1);
    expect(metric.resolverCalls).toBe(0);
    expect(metric.searches).toBe(reply.planning!.counters.searches);
    expectUnchanged(env);
  },
);
test("an ambiguous row next to a clear one keeps the clear row with one request", async () => {
  const env = await setup({ "*": [milk, ...creams] });
  const note = "1 l maitoa ja 200 ml kermaa";
  const provider = ai(note);
  const reply = await env.service.planShopping(
    { prompt: note, consent: true },
    bind(provider),
  );
  expect(reply.planning!.phase).toBe("ready");
  const result = env.service.planningResult(reply.planning!.operationId);
  expect(result.resolver.status).toBe("skipped");
  expect(result.lines[0].product?.id).toBe("milk");
  expect(result.lines[1].product).toBeNull();
  expect(provider.calls).toHaveLength(1);
  expectUnchanged(env);
});
test("empty searches retain every intent; unknown-only requests make no catalogue reads", async () => {
  const env = await setup({});
  let note = "1 l maitoa ja kahvia";
  let reply = await env.service.planShopping(
    { prompt: note, consent: true },
    bind(ai(note)),
  );
  expect(reply.planning!.intents.map((result) => result.reason)).toEqual([
    "empty-search",
    "unknown-quantity",
  ]);
  expect(reply.planning!.counters.searches).toBe(2);
  env.tools.length = 0;
  note = "kahvia";
  reply = await env.service.planShopping(
    { prompt: note, consent: true },
    bind(ai(note)),
  );
  expect(reply.planning!.phase).toBe("ready");
  expect(reply.planning!.coverage).toEqual([]);
  expect(env.tools).toEqual([]);
  expectUnchanged(env);
});
test.each(["discovery", "interpretation", "search"] as const)(
  "cancel during %s discards late output and keeps the saved plan",
  async (phase) => {
    const env = await setup({ "*": creams });
    const note = "200 ml kermaa";
    const provider = ai(note);
    let release: (() => void) | undefined;
    if (phase === "interpretation") {
      provider.invoke = async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          text: JSON.stringify(planningFixtureReply(note, 4)),
          completion: "complete",
        };
      };
    }
    if (phase === "search") {
      const adapter = env.service.registry.get("k-ruoka");
      const real = adapter.searchProducts.bind(adapter);
      adapter.searchProducts = async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return real(...args);
      };
    }
    const pending = env.service.planShopping(
      { prompt: note, consent: true },
      phase === "discovery"
        ? async (run) => {
            await new Promise<void>((resolve, reject) => {
              release = resolve;
              run.signal.addEventListener(
                "abort",
                () => reject(new InferenceError("cancelled")),
                { once: true },
              );
            });
            return bind(provider)(run);
          }
        : bind(provider),
    );
    // Attach rejection handling immediately while waiting for the actual external phase.
    const rejected = expect(pending).rejects.toThrow("aiCancelled");
    await vi.waitFor(() =>
      expect(env.service.planning.snapshot()!.phase).toBe(
        phase === "discovery"
          ? "discovering"
          : phase === "interpretation"
            ? "interpreting"
            : "searching",
      ),
    );
    if (phase === "interpretation" || phase === "search")
      await vi.waitFor(() => expect(release).toBeDefined());
    env.service.planning.cancel();
    await rejected;
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.service.planning.snapshot()!).toMatchObject({
      phase: "cancelled",
      intents: [],
      provisional: { meals: [], rows: [] },
    });
    expectUnchanged(env);
  },
);
test.each(["note", "store"] as const)(
  "changed %s obsoletes a pending read without replacing state",
  async (change) => {
    const env = await setup();
    const note = "1 l maitoa";
    const adapter = env.service.registry.get("k-ruoka");
    adapter.searchProducts = () => new Promise(() => {});
    const pending = env.service.planShopping(
      { prompt: note, consent: true },
      bind(ai(note)),
    );
    const rejected = expect(pending).rejects.toThrow("draftStale");
    await vi.waitFor(() =>
      expect(env.service.planning.snapshot()!.counters.searches).toBe(1),
    );
    await env.service.save({
      ...env.service.state,
      ...(change === "note"
        ? { note: "Changed source" }
        : {
            context: { ...env.service.state.context, storeId: "other-store" },
          }),
    });
    await rejected;
    expect(env.service.planning.snapshot()!.phase).toBe("obsolete");
    expect(() =>
      env.service.planningResult(env.service.planning.snapshot()!.operationId),
    ).toThrow("planningStale");
    expect(env.service.state.note).toBe(
      change === "note" ? "Changed source" : env.before.state.note,
    );
  },
);
test("a catalogue error leaves that row unsearched, without an alias retry, and the list still commits", async () => {
  const env = await createFixtureService("k-ruoka", {}, "search-error");
  const note = "1 l maitoa";
  const reply = await env.service.planShopping(
    { prompt: note, consent: true },
    bind(ai(note)),
  );
  expect(reply.planning).toMatchObject({
    phase: "ready",
    coverage: [{ status: "bounded-out" }],
    provisional: { rows: [{ status: "unresolved", product: null }] },
  });
  expect(env.tools).toEqual(["search_products"]);
  const committed = await env.service.commitPlanning({
    operationId: reply.planning!.operationId,
  });
  expect(committed.state.extras.map((i) => i.name)).toEqual(["Maito"]);
  expect(committed.basket).toHaveLength(1);
  expect(committed.basket[0]).toMatchObject({
    product: null,
    matching: { reason: "bounded-out" },
  });
  expect(committed.state.assumptions).toMatch(/1 rivillä/);
  // No row answered, so the store failure is shown with the saved list.
  expect(committed.pricingError).toBe("storeUnavailable");
});
test("an account error from the catalogue still ends the request", async () => {
  const env = await setup();
  env.service.registry.get("k-ruoka").searchProducts = async () => {
    throw new Error("loginRequired");
  };
  await expect(
    env.service.planShopping(
      { prompt: "1 l maitoa", consent: true },
      bind(ai("1 l maitoa")),
    ),
  ).rejects.toThrow("loginRequired");
  expect(env.service.planning.snapshot()!.phase).toBe("failed");
  expectUnchanged(env);
});
test("one failed row keeps the products found for the other rows", async () => {
  const env = await setup({ "*": [milk] });
  const provider = env.service.registry.get("k-ruoka");
  const real = provider.searchProducts.bind(provider);
  provider.searchProducts = async (context, query, id) => {
    if (/kahvi/i.test(query)) throw new Error("storeUnavailable");
    return real(context, query, id);
  };
  const note = "1 l maitoa ja 500 g kahvia";
  const reply = await env.service.planShopping(
    { prompt: note, consent: true },
    bind(ai(note)),
  );
  const rows = reply.planning!.provisional.rows;
  expect(rows.find((r) => r.name === "Maito")).toMatchObject({
    status: "resolved",
    product: { id: "milk" },
  });
  expect(rows.find((r) => r.name === "Kahvi")).toMatchObject({
    status: "unresolved",
    product: null,
  });
  const committed = await env.service.commitPlanning({
    operationId: reply.planning!.operationId,
  });
  expect(committed.basket.map((l) => l.product?.id ?? null)).toEqual([
    "milk",
    null,
  ]);
  expect(committed.pricingError).toBeNull();
});
test("an unusable interpretation gets one repair, then the note itself is searched", async () => {
  const env = await setup();
  const provider = new ScriptedInferenceProvider("invalid", async () => ({
    text: "{}",
    completion: "complete",
  }));
  provider.models[0].capabilities.tasks = inferenceTasks;
  const reply = await env.service.planShopping(
    { prompt: "1 l maitoa", consent: true },
    bind(provider),
  );
  expect(provider.calls).toHaveLength(2);
  expect(reply.planning).toMatchObject({
    phase: "ready",
    provisional: {
      rows: [
        { name: "Maito", amount: 1000, unit: "ml", product: { id: "milk" } },
      ],
    },
  });
  expectUnchanged(env);
  const committed = await env.service.commitPlanning({
    operationId: reply.planning!.operationId,
  });
  expect(committed.state.assumptions).toMatch(/sellaisinaan tuotehakuina/);
  expect(committed.basket[0].product?.id).toBe("milk");
  const metrics = await env.service.operationMetrics();
  expect(metrics.find((m) => m.kind === "planning")).toMatchObject({
    outcome: "success",
    aiCalls: 2,
    unresolved: { "invalid-output": 1 },
  });
});
test("an account or usage error does not fall back to the note", async () => {
  const env = await setup();
  const provider = new ScriptedInferenceProvider("limited", async () => {
    throw new InferenceError("usageLimit");
  });
  provider.models[0].capabilities.tasks = inferenceTasks;
  await expect(
    env.service.planShopping(
      { prompt: "1 l maitoa", consent: true },
      bind(provider),
    ),
  ).rejects.toThrow("usageLimit");
  expect(env.tools).toEqual([]);
  expect(env.service.planning.snapshot()!.failure).toBe("limit");
  expectUnchanged(env);
});
test("the search deadline keeps the list, leaves unread rows unsearched and ignores late results", async () => {
  const env = await setup();
  const controller = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  const real = env.service.registry
    .get("k-ruoka")
    .searchProducts.bind(env.service.registry.get("k-ruoka"));
  let release: (() => void) | undefined;
  env.service.registry.get("k-ruoka").searchProducts = async (...args) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return real(...args);
  };
  try {
    const pending = env.service.planShopping(
      { prompt: "1 l maitoa", consent: true },
      bind(ai("1 l maitoa")),
    );
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(timeout).toHaveBeenCalledWith(coordinatorLimits.searchTimeoutMs);
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    const reply = await pending;
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.service.planning.snapshot()).toMatchObject({
      phase: "ready",
      coverage: [{ status: "bounded-out" }],
      provisional: { rows: [{ status: "unresolved", product: null }] },
    });
    expect(reply.planning!.phase).toBe("ready");
    // Nothing is saved before the composer commits.
    expectUnchanged(env);
  } finally {
    timeout.mockRestore();
  }
});

test("two workers release each actual alias read and leave budget omissions explicit", async () => {
  const env = await setup({});
  const clauses = Array.from(
    { length: 100 },
    (_, index) => `1 g jauheliha numero${index}`,
  );
  const note = clauses.join(" ja ");
  let offset = 0;
  const draft = {
    recipes: [],
    meals: [],
    notes: "",
    items: clauses.map((_, index) => ({
      id: `ingredient-${index}`,
      name: `Jauheliha numero${index}`,
      amount: 1,
      unit: "g",
    })),
    intents: clauses.map((quote, index) => {
      const start = offset;
      offset += quote.length + 4;
      return {
        id: `request-${index}`,
        kind: "grocery",
        label: quote,
        evidence: { start, end: start + quote.length, quote },
        provenance: "explicit-note",
        quantity: { amount: 1, unit: "g", provenance: "explicit-note" },
        mealIndex: null,
        itemIndex: index,
        unresolvedReason: null,
      };
    }),
  };
  const provider = new ScriptedInferenceProvider("budget", async () => ({
    text: JSON.stringify(draft),
    completion: "complete",
  }));
  provider.models[0].capabilities.tasks = inferenceTasks;
  const adapter = env.service.registry.get("k-ruoka");
  const real = adapter.searchProducts.bind(adapter);
  let active = 0,
    maximum = 0;
  adapter.searchProducts = async (...args) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return await real(...args);
    } finally {
      active--;
    }
  };
  const reply = await env.service.planShopping(
    { prompt: note, consent: true },
    bind(provider),
  );
  expect(reply.planning!.phase).toBe("ready");
  expect(reply.planning!.counters).toEqual({ aiCalls: 1, searches: 200 });
  expect(env.tools).toHaveLength(200);
  expect(maximum).toBe(2);
  expect(active).toBe(0);
  expect(reply.planning!.intents).toHaveLength(100);
  const retained = env.service.planningResult(reply.planning!.operationId);
  expect(retained.requirements).toHaveLength(100);
  expect(retained.intents).toEqual(reply.planning!.intents);
  expect(retained.coverage).toEqual(reply.planning!.coverage);
  expect(
    reply.planning!.intents.some((intent) => intent.reason === "bounded-out"),
  ).toBe(true);
  expect(
    reply.planning!.coverage.every((row) => row.status !== "pending"),
  ).toBe(true);
  expectUnchanged(env);
});

test("replacement run cannot be overwritten by a late previous interpretation", async () => {
  const env = await setup();
  let release: (() => void) | undefined;
  const slow = ai("1 l maitoa");
  slow.invoke = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      text: JSON.stringify(planningFixtureReply("1 l maitoa", 4)),
      completion: "complete",
    };
  };
  const first = env.service.planShopping(
    { prompt: "1 l maitoa", consent: true },
    bind(slow),
  );
  const rejected = expect(first).rejects.toThrow("draftStale");
  await vi.waitFor(() => expect(release).toBeDefined());
  const second = await env.service.planShopping(
    { prompt: "kahvia", consent: true },
    bind(ai("kahvia")),
  );
  await rejected;
  release!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(env.service.planning.snapshot()!.operationId).toBe(
    second.planning!.operationId,
  );
  expect(
    env.service.planningResult(second.planning!.operationId).draft.intents![0]
      .label,
  ).toBe("kahvia");
  expectUnchanged(env);
});
