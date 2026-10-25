import { expect, test } from "vitest";
import {
  interpretPlanning,
  shoppingPlanningNativeOutput,
} from "../src/ai/output";
import { shoppingPlanTask } from "../src/ai/tasks";
import { InferenceSession, discoverInferenceModels } from "../src/ai/provider";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { initialState } from "../src/domain/model";
import { requirements } from "../src/domain/planner";
import { FixtureAI } from "../src/ai/fixtures";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { createFixtureService } from "./fixtures/ai-shopping/environment";

const note = "1 l maitoa ja kahvia";
// Independently expected: milk has an explicit litre; coffee has no quantity and cannot be priced.
const wire = {
  recipes: [],
  meals: [],
  items: [
    {
      id: "milk-model",
      name: "Maito",
      amount: 1000,
      unit: "ml",
      classification: null,
    },
  ],
  notes: "",
  intents: [
    {
      id: "milk-request",
      kind: "grocery",
      label: "1 l maitoa",
      evidence: { start: 0, end: 10, quote: "1 l maitoa" },
      provenance: "explicit-note",
      quantity: { amount: 1000, unit: "ml", provenance: "explicit-note" },
      mealIndex: null,
      itemIndex: 0,
      unresolvedReason: null,
    },
    {
      id: "coffee-request",
      kind: "grocery",
      label: "kahvia",
      evidence: { start: 14, end: 20, quote: "kahvia" },
      provenance: "explicit-note",
      quantity: { amount: null, unit: null, provenance: "unknown" },
      mealIndex: null,
      itemIndex: null,
      unresolvedReason: "unknown-quantity",
    },
  ],
};
function scripted(native: boolean, replies: unknown[]) {
  let calls = 0;
  const provider = new ScriptedInferenceProvider("intent-output", async () => ({
    text: JSON.stringify(replies[Math.min(calls++, replies.length - 1)]),
    completion: "complete",
  }));
  provider.models[0].capabilities.tasks.push(shoppingPlanTask);
  provider.models[0].capabilities.outputModes = native
    ? ["json-schema", "text"]
    : ["text"];
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 3, maxOutputCharacters: 100_000, timeoutMs: 1000 },
    new AbortController().signal,
  );
  return { session, provider };
}

test.each([false, true])(
  "reported seven-request note survives offset arithmetic slips (native=%s)",
  async (native) => {
    const source =
      "Perunamuusi, nakkikastike, jauhelihakeitto, lihamakaronilaatikko, kevytmaito, jogurttia ja leipää";
    const dishes = [
      "Perunamuusi",
      "nakkikastike",
      "jauhelihakeitto",
      "lihamakaronilaatikko",
    ];
    const groceries = ["kevytmaito", "jogurttia", "leipää"];
    const response = {
      recipes: dishes.map((name, i) => ({
        id: `dish-${i}`,
        name,
        servings: 5,
        kind: "meal",
        ingredients: [
          {
            id: "peruna",
            name: "Peruna",
            amount: 500,
            unit: "g",
            classification: native ? null : undefined,
          },
        ],
        instructions: "Kypsennä.",
      })),
      meals: dishes.map((_, i) => ({
        recipeId: `dish-${i}`,
        servings: 5,
        day: native ? null : 0,
        leftovers: false,
      })),
      items: groceries.map((name, i) => ({
        id: `item-${i}`,
        name,
        amount: 1000,
        unit: i === 0 ? "ml" : "g",
        classification: native ? null : undefined,
        merchandise: native ? null : undefined,
      })),
      notes: "",
      sides: [],
      intents: [...dishes, ...groceries].map((quote, i) => ({
        id: `intent-${i}`,
        kind: i < 4 ? "meal" : "grocery",
        label: quote,
        // The fourth span fails the same evidence-length refinement as the report.
        evidence: {
          start: source.indexOf(quote) + 1,
          end: source.indexOf(quote) + quote.length + 2,
          quote,
        },
        provenance: "explicit-note",
        quantity:
          i < 4
            ? null
            : {
                amount: 1000,
                unit: i === 4 ? "ml" : "g",
                provenance: "assumed",
              },
        mealIndex: i < 4 ? i : null,
        itemIndex: i < 4 ? null : i - 4,
        unresolvedReason: null,
      })),
    };
    const { session, provider } = scripted(native, [response]);
    const result = await interpretPlanning(session, source, initialState());
    expect(result.meals).toHaveLength(4);
    expect(result.items).toHaveLength(3);
    expect(result.intents!.map((intent) => intent.label)).toEqual([
      ...dishes,
      ...groceries,
    ]);
    for (const intent of result.intents!) {
      expect(source.slice(intent.evidence.start, intent.evidence.end)).toBe(
        intent.label,
      );
    }
    expect(provider.calls).toHaveLength(1);
  },
);

test.each([false, true])(
  "offset alignment does not repair ambiguous, invented, overlapping or mismatched evidence; salvage leaves that request out (native=%s)",
  async (native) => {
    for (const change of [
      (r: typeof wire) => {
        r.intents[1].evidence.quote = "teetä";
        r.intents[1].label = "teetä";
      },
      (r: typeof wire) => {
        r.intents[1].label = "teetä";
      },
      (r: typeof wire) => {
        r.intents[1].evidence = { start: 1, end: 3, quote: "a" };
        r.intents[1].label = "a";
      },
      (r: typeof wire) => {
        r.intents[1].evidence = { ...r.intents[0].evidence };
        r.intents[1].label = r.intents[0].label;
      },
    ]) {
      const response = structuredClone(wire);
      change(response);
      const payload = native
        ? response
        : {
            ...response,
            items: response.items.map(
              ({ classification: _classification, ...item }) => item,
            ),
          };
      const { session, provider } = scripted(native, [payload]);
      // B4.1: the milk request is kept without a second request; the bad entry is never trusted.
      const kept = await interpretPlanning(session, note, initialState());
      expect(kept.items.map((i) => i.name)).toEqual(["Maito"]);
      expect(kept.intents!.map((i) => i.label)).toEqual(["1 l maitoa"]);
      expect(provider.calls).toHaveLength(1);
    }
  },
);
test("native/text required ledgers preserve meaningful nulls and the same validated request semantics", async () => {
  const state = initialState();
  state.recipes = [];
  const textWire = {
    ...wire,
    items: wire.items.map(
      ({ classification: _classification, ...item }) => item,
    ),
  };
  const native = scripted(true, [wire]),
    text = scripted(false, [textWire]);
  const a = await interpretPlanning(native.session, note, state),
    b = await interpretPlanning(text.session, note, state);
  expect(a).toEqual(b);
  expect(
    a.intents!.map((i) => ({
      label: i.label,
      amount: i.quantity?.amount,
      reason: i.unresolvedReason,
    })),
  ).toEqual([
    { label: "1 l maitoa", amount: 1000, reason: null },
    { label: "kahvia", amount: null, reason: "unknown-quantity" },
  ]);
  expect(a.items).toHaveLength(1);
  expect(a.items[0].amount).toBe(1000);
  expect(native.provider.calls[0].output).toEqual(shoppingPlanningNativeOutput);
  expect(text.provider.calls[0].output.mode).toBe("text");
  expect(state.extras).toEqual([]);
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const schema = value as Record<string, unknown>;
    if (schema.type === "object") {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
    for (const child of Object.values(schema))
      Array.isArray(child) ? child.forEach(inspect) : inspect(child);
  };
  inspect(shoppingPlanningNativeOutput.schema);
});
test.each([false, true])(
  "an unusable ledger is salvaged without a repair and an invented quantity is never kept (native=%s)",
  async (native) => {
    const valid = native
      ? wire
      : {
          ...wire,
          items: wire.items.map(
            ({ classification: _classification, ...item }) => item,
          ),
        };
    const { intents: _intents, ...missing } = valid;
    const salvaged = scripted(native, [missing, valid]);
    const withoutLedger = await interpretPlanning(
      salvaged.session,
      note,
      initialState(),
    );
    expect(withoutLedger.intents).toBeUndefined();
    expect(withoutLedger.items.map((i) => i.name)).toEqual(["Maito"]);
    expect(salvaged.provider.calls).toHaveLength(1);
    // A reply with nothing usable still gets the single repair in the same format.
    const repaired = scripted(native, ["not json", valid]);
    expect(
      (await interpretPlanning(repaired.session, note, initialState())).intents,
    ).toHaveLength(2);
    expect(repaired.provider.calls).toHaveLength(2);
    expect(repaired.provider.calls[1].output).toEqual(
      repaired.provider.calls[0].output,
    );
    const fabricated = structuredClone(valid);
    fabricated.intents[1].quantity = {
      amount: 500,
      unit: "g",
      provenance: "explicit-note",
    };
    const failed = scripted(native, [fabricated]);
    const kept = await interpretPlanning(failed.session, note, initialState());
    expect(kept.intents!.map((i) => i.label)).toEqual(["1 l maitoa"]);
    expect(failed.provider.calls).toHaveLength(1);
    const empty = scripted(native, ["not json"]);
    await expect(
      interpretPlanning(empty.session, note, initialState()),
    ).rejects.toThrow("invalidDraft");
    expect(empty.provider.calls).toHaveLength(2);
  },
);

for (const alternative of [false, true])
  test.each(["k-ruoka", "s-kaupat"] as const)(
    `${alternative ? "alternative" : "ChatGPT fixture"}: %s preserves mixed request coverage through real Service pricing`,
    async (chain) => {
      const source = "Puuroa ja 1,5 l maitoa ja kahvia";
      // Expected from the note: one meal, 1500 ml direct milk, and unresolved coffee.
      const { service, tools } = await createFixtureService(chain, {
        "*": [
          { id: "milk-real", name: "Kevytmaito 1 l", price: 1 },
          { id: "oats-real", name: "Kaurahiutale 1 kg", price: 2 },
        ],
      });
      const before = structuredClone(service.state);
      const fixture = new FixtureAI();
      await fixture.signIn();
      const provider = alternative
        ? new FakeInferenceProvider(fixture, true)
        : new ChatGPTInferenceProvider(fixture);
      const run = service.planning.start(source);
      const models = await discoverInferenceModels(provider, run.signal);
      const session = run.bindInference(
        provider,
        models.find((model) => model.modelId === "fixture-large")!,
      );
      const interpreted = await interpretPlanning(
        session,
        source,
        run.sourceState(),
      );
      run.publishDraft(interpreted);
      const draft = run.validatedDraft();
      expect(draft.intents!.map((i) => i.label)).toEqual([
        "Puuroa",
        "1,5 l maitoa",
        "kahvia",
      ]);
      expect(draft.items[0].amount).toBe(1500);
      expect(draft.items).toHaveLength(1);
      const local = {
        ...service.state,
        recipes: [...service.state.recipes, ...draft.recipes],
        meals: draft.meals.map((meal, i) => ({ ...meal, id: `meal-${i}` })),
        extras: draft.items,
      };
      const wanted = requirements(local);
      run.setRequirements(wanted);
      const lines = await service.price(local.context, local);
      lines.forEach((line) => run.publishRow(line));
      run.ready();
      const results = service.snapshot().planning!.intents;
      expect(results).toHaveLength(3);
      expect(results[1]).toMatchObject({
        status: "resolved",
        intent: { quantity: { amount: 1500, unit: "ml" } },
      });
      expect(results[2]).toMatchObject({
        status: "unresolved",
        reason: "unknown-quantity",
        requirementKeys: [],
        intent: { quantity: { amount: null, unit: null } },
      });
      expect(service.state).toEqual(before);
      expect(service.basket).toEqual([]);
      expect(fixture.requestCount).toBe(1);
      expect(fixture.catalogueRequests).toBe(1);
      expect(fixture.lastModel).toBe("fixture-large");
      expect(session.model.providerId).toBe(provider.id);
      expect(tools.some((name) => /add|update|write/.test(name))).toBe(false);
    },
  );
test("development planning fixtures preserve count uncertainty and produce no unrelated fallback meal", async () => {
  const fixture = new FixtureAI();
  await fixture.signIn();
  const provider = new FakeInferenceProvider(fixture, true);
  const signal = new AbortController().signal;
  const models = await discoverInferenceModels(provider, signal);
  const session = new InferenceSession(
    provider,
    models[0],
    { maxCalls: 3, maxOutputCharacters: 100_000, timeoutMs: 1000 },
    signal,
  );
  const unknown = await interpretPlanning(
    session,
    "3 pakastepizzaa",
    initialState(),
  );
  expect(unknown.items).toEqual([]);
  expect(unknown.meals).toEqual([]);
  expect(unknown.intents![0]).toMatchObject({
    quantity: { amount: 3, unit: null },
    unresolvedReason: "unknown-unit",
  });
  expect(fixture.requestCount).toBe(1);
  const fractional = await interpretPlanning(
    session,
    "1.5 g kahvia",
    initialState(),
  );
  expect(fractional.items).toEqual([]);
  expect(fractional.intents![0]).toMatchObject({
    quantity: { amount: 1.5, unit: "g", provenance: "explicit-note" },
    unresolvedReason: "unsupported-quantity",
  });
});
