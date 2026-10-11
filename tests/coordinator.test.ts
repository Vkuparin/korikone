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
function ai(
  note: string,
  resolution: "valid" | "error" | "invalid" | "pending" = "valid",
  repair = false,
) {
  let interpretations = 0;
  const provider = new ScriptedInferenceProvider(
    "coordinator-fixture",
    async (request) => {
      if (request.task.id === "candidate-resolution") {
        if (resolution === "error") throw new InferenceError("usageLimit");
        if (resolution === "pending") return new Promise(() => {});
        return {
          completion: "complete",
          text: JSON.stringify({
            version: 1,
            choices: [
              {
                rowId: "row-0",
                candidateId:
                  resolution === "invalid" ? "invented" : "candidate-0",
                status: "approval-required",
                reason: "type-alternative",
              },
            ],
          }),
        };
      }
      return {
        completion: "complete",
        text:
          repair && interpretations++ === 0
            ? "{}"
            : JSON.stringify(planningFixtureReply(note, 4)),
      };
    },
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
test.each([false, true])(
  "resolver enabled=%s: one batch stays an approval proposal and request counters are exact",
  async (enabled) => {
    const env = await setup({ "*": creams });
    await env.service.save({ ...env.service.state, resolverEnabled: enabled });
    env.before = structuredClone(env.service.snapshot());
    const note = "200 ml kermaa";
    const provider = ai(note, "valid", true);
    const reply = await env.service.planShopping(
      { prompt: note, consent: true },
      bind(provider),
    );
    const result = env.service.planningResult(reply.planning!.operationId);
    expect(result.lines[0].product).toBeNull();
    expect(reply.planning!.intents[0].status).toBe("approval-required");
    expect(provider.calls.map((call) => call.task.id)).toEqual(
      enabled
        ? ["shopping-plan", "shopping-plan", "candidate-resolution"]
        : ["shopping-plan", "shopping-plan"],
    );
    expect(result.resolver.status).toBe(enabled ? "completed" : "skipped");
    expect(result.resolver.suggestions).toHaveLength(enabled ? 1 : 0);
    const metric = (await env.service.operationMetrics()).at(-1)!;
    expect(metric.aiCalls).toBe(enabled ? 3 : 2);
    expect(metric.repairCalls).toBe(1);
    expect(metric.resolverCalls).toBe(enabled ? 1 : 0);
    expect(metric.searches).toBe(reply.planning!.counters.searches);
    expectUnchanged(env);
  },
);
test.each(["error", "invalid"] as const)(
  "optional resolver %s preserves safe rows with no retries",
  async (mode) => {
    const env = await setup({ "*": [milk, ...creams] });
    const note = "1 l maitoa ja 200 ml kermaa";
    const provider = ai(note, mode);
    const reply = await env.service.planShopping(
      { prompt: note, consent: true },
      bind(provider),
    );
    expect(reply.planning!.phase).toBe("ready");
    const result = env.service.planningResult(reply.planning!.operationId);
    expect(result.resolver).toMatchObject({
      status: "unavailable",
      suggestions: [],
    });
    expect(result.lines[0].product?.id).toBe("milk");
    expect(result.lines[1].product).toBeNull();
    expect(provider.calls).toHaveLength(2);
    expectUnchanged(env);
  },
);
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
test.each(["discovery", "interpretation", "search", "resolver"] as const)(
  "cancel during %s discards late output and keeps the saved plan",
  async (phase) => {
    const env = await setup({ "*": creams });
    const note = "200 ml kermaa";
    const provider = ai(note, phase === "resolver" ? "pending" : "valid");
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
            : phase === "search"
              ? "searching"
              : "resolving",
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
test("catalogue error is terminal and does not become an empty result or alias retry", async () => {
  const env = await createFixtureService("k-ruoka", {}, "search-error");
  const note = "1 l maitoa";
  await expect(
    env.service.planShopping({ prompt: note, consent: true }, bind(ai(note))),
  ).rejects.toThrow("storeUnavailable");
  expect(env.service.planning.snapshot()).toMatchObject({
    phase: "failed",
    failure: "search",
    intents: [],
  });
  expect(env.tools).toEqual(["search_products"]);
});
test("interpretation failure uses only one repair and performs no searches", async () => {
  const env = await setup();
  const provider = new ScriptedInferenceProvider("invalid", async () => ({
    text: "{}",
    completion: "complete",
  }));
  provider.models[0].capabilities.tasks = inferenceTasks;
  await expect(
    env.service.planShopping(
      { prompt: "1 l maitoa", consent: true },
      bind(provider),
    ),
  ).rejects.toThrow("invalidDraft");
  expect(provider.calls).toHaveLength(2);
  expect(env.tools).toEqual([]);
  expect(env.service.planning.snapshot()!.failure).toBe("invalid-output");
  expectUnchanged(env);
});
test("search deadline fails honestly and cannot publish late catalogue results", async () => {
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
    const rejected = expect(pending).rejects.toThrow("timeout");
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(timeout).toHaveBeenCalledWith(coordinatorLimits.searchTimeoutMs);
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await rejected;
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.service.planning.snapshot()).toMatchObject({
      phase: "failed",
      failure: "timeout",
      intents: [],
    });
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
