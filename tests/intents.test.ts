import { expect, test } from "vitest";
import { validatePlanningDraft, validateDraft } from "../src/ai/draft";
import {
  noteQuantity,
  projectIntentMappings,
  mapIntentResults,
  type RequestIntent,
  requestIntentSchema,
} from "../src/domain/intents";
import {
  initialState,
  type Recipe,
  type Requirement,
} from "../src/domain/model";
import { requirements } from "../src/domain/planner";
import { matchRequirement } from "../src/domain/matching";
import { PlanningLifecycle } from "../src/application/planning";
import { ScriptedInferenceProvider } from "./helpers/inference";

// Expectations are authored from this note before the independently scripted response below.
const note = "Keitto ja Puuro ja 1 l maitoa ja kahvia ja harvinainen annos";
const expected = [
  { label: "Keitto", kind: "meal" },
  { label: "Puuro", kind: "meal" },
  { label: "1 l maitoa", kind: "grocery" },
  { label: "kahvia", kind: "grocery" },
  { label: "harvinainen annos", kind: "meal" },
];
function intent(
  label: string,
  kind: RequestIntent["kind"],
  patch: Partial<RequestIntent> = {},
): RequestIntent {
  const start = note.indexOf(label);
  return {
    id: `model-${start}`,
    kind,
    label,
    evidence: { start, end: start + label.length, quote: label },
    provenance: "explicit-note",
    quantity:
      kind === "meal"
        ? null
        : { amount: null, unit: null, provenance: "unknown" },
    mealIndex: null,
    itemIndex: null,
    unresolvedReason: "unsupported-request",
    ...patch,
  };
}
const recipes: Recipe[] = [
  {
    id: "soup",
    name: "Keitto",
    servings: 2,
    ingredients: [
      { id: "model-milk-a", name: "Maito", amount: 200, unit: "ml" },
      { id: "potato", name: "Peruna", amount: 300, unit: "g" },
    ],
    instructions: "Keitä.",
  },
  {
    id: "new-porridge",
    name: "Puuro",
    servings: 2,
    ingredients: [
      { id: "model-milk-b", name: "Maito", amount: 300, unit: "ml" },
      { id: "oats", name: "Kaurahiutale", amount: 100, unit: "g" },
    ],
    instructions: "Keitä.",
  },
];
const reply = {
  recipes,
  meals: [
    { recipeId: "soup", servings: 2 },
    { recipeId: "new-porridge", servings: 2 },
  ],
  items: [{ id: "model-direct-milk", name: "Maito", amount: 1000, unit: "ml" }],
  notes: "",
  intents: [
    intent("Keitto", "meal", { mealIndex: 0, unresolvedReason: null }),
    intent("Puuro", "meal", { mealIndex: 1, unresolvedReason: null }),
    intent("1 l maitoa", "grocery", {
      itemIndex: 0,
      quantity: { amount: 1000, unit: "ml", provenance: "explicit-note" },
      unresolvedReason: null,
    }),
    intent("kahvia", "grocery", { unresolvedReason: "unknown-quantity" }),
    intent("harvinainen annos", "meal"),
  ],
};
function parsed() {
  const state = initialState();
  state.staples = [];
  const draft = validatePlanningDraft(JSON.stringify(reply), state, note);
  const next = {
    ...state,
    recipes: [...state.recipes, ...draft.recipes],
    meals: draft.meals.map((meal, index) => ({ ...meal, id: `meal-${index}` })),
    extras: draft.items,
  };
  return {
    state,
    draft,
    wanted: requirements(next),
    mappings: projectIntentMappings(draft.intents, draft, state.recipes),
  };
}

test("all independently identified mixed requests retain stable spans, target indexes and explicit unresolved reasons", () => {
  const { state, draft, mappings } = parsed();
  expect(draft.intents.map(({ label, kind }) => ({ label, kind }))).toEqual(
    expected,
  );
  expect(draft.intents.map((i) => i.id)).toEqual(
    expected.map(
      ({ label }) =>
        `intent-${note.indexOf(label)}-${note.indexOf(label) + label.length}`,
    ),
  );
  expect(draft.recipes[0].id).not.toBe("soup");
  expect(draft.meals[0].recipeId).toBe(draft.recipes[0].id);
  expect(mappings[0].recipeId).toBe(draft.recipes[0].id);
  expect(mappings[0].requirementKeys[0]).toBe(mappings[1].requirementKeys[0]);
  expect(mappings[2].requirementKeys).toEqual([`${draft.items[0].id}:ml`]);
  expect(draft.intents[3]).toMatchObject({
    quantity: { amount: null, unit: null, provenance: "unknown" },
    unresolvedReason: "unknown-quantity",
  });
  expect(draft.intents[4]).toMatchObject({
    quantity: null,
    mealIndex: null,
    unresolvedReason: "unsupported-request",
  });
  expect(state.extras).toEqual([]);
  expect(parsed().draft.intents.map((i) => i.id)).toEqual(
    draft.intents.map((i) => i.id),
  );
});
test("unresolved-only drafts are representable; a fabricated grocery quantity cannot accompany an unknown intent", () => {
  const state = initialState();
  const unknown = {
    intents: [
      intent("kahvia", "grocery", { unresolvedReason: "unknown-quantity" }),
    ],
  };
  const draft = validatePlanningDraft(JSON.stringify(unknown), state, note);
  expect(draft.items).toEqual([]);
  expect(draft.meals).toEqual([]);
  expect(() =>
    validatePlanningDraft(
      JSON.stringify({
        ...unknown,
        items: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
      }),
      state,
      note,
    ),
  ).toThrow("invalidDraft");
  expect(() =>
    validatePlanningDraft(
      JSON.stringify({
        items: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
      }),
      state,
      note,
    ),
  ).toThrow("invalidDraft");
  expect(
    validateDraft(
      JSON.stringify({
        items: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
      }),
      state,
      note,
    ).intents,
  ).toBeUndefined();
});
test("invalid targets, duplicate ownership, overlapping/forged evidence and inferred quantity claims reject", () => {
  const mutations = [
    (copy: typeof reply) => {
      copy.intents[0].mealIndex = 99;
    },
    (copy: typeof reply) => {
      copy.intents[1].mealIndex = 0;
    },
    (copy: typeof reply) => {
      copy.intents[1].evidence = copy.intents[0].evidence;
      copy.intents[1].label = copy.intents[0].label;
    },
    (copy: typeof reply) => {
      copy.intents[2].quantity!.amount = 2000;
      copy.items[0].amount = 2000;
    },
    (copy: typeof reply) => {
      copy.intents[3].itemIndex = 0;
      copy.intents[3].unresolvedReason = null;
    },
    (copy: typeof reply) => {
      copy.intents[0].evidence.quote = "Other text";
    },
    (copy: typeof reply) => {
      copy.intents[2].label = "Other label";
    },
    (copy: typeof reply) => {
      copy.intents.pop();
      copy.intents[0].id = copy.intents[1].id;
    },
    (copy: typeof reply) => {
      copy.items.push({ ...copy.items[0], id: "unowned-extra" });
    },
    (copy: typeof reply) => {
      copy.recipes.push({ ...copy.recipes[1], id: "unreferenced-recipe" });
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(reply);
    mutate(copy);
    expect(() =>
      validatePlanningDraft(JSON.stringify(copy), initialState(), note),
    ).toThrow("invalidDraft");
  }
  expect(() =>
    validatePlanningDraft(
      JSON.stringify({
        ...reply,
        intents: reply.intents.map((i) => ({ ...i, provenance: "remembered" })),
      }),
      initialState(),
      note,
    ),
  ).toThrow("invalidDraft");
});
test("literal quantity conversions have independent expectations and do not infer package weight", () => {
  expect(noteQuantity("1,5 l maitoa")).toEqual({ amount: 1500, unit: "ml" });
  expect(noteQuantity("2 kg riisiä")).toEqual({ amount: 2000, unit: "g" });
  expect(noteQuantity("6 kpl kananmunia")).toEqual({ amount: 6, unit: "pcs" });
  expect(noteQuantity("3 pakastepizzaa")).toBeNull();
  expect(noteQuantity("maitoa")).toBeNull();
  expect(noteQuantity("1 l tai 2 l maitoa")).toBeNull();
  const quote = "3 pakastepizzaa";
  const unresolved: RequestIntent = {
    id: "pizzas",
    kind: "grocery",
    label: quote,
    evidence: { start: 0, end: quote.length, quote },
    provenance: "explicit-note",
    quantity: { amount: 3, unit: null, provenance: "explicit-note" },
    mealIndex: null,
    itemIndex: null,
    unresolvedReason: "unknown-unit",
  };
  expect(
    validatePlanningDraft(
      JSON.stringify({ intents: [unresolved] }),
      initialState(),
      quote,
    ).intents[0].quantity,
  ).toEqual({ amount: 3, unit: null, provenance: "explicit-note" });
  expect(() =>
    validatePlanningDraft(
      JSON.stringify({
        items: [{ id: "pizza", name: "Pakastepizza", amount: 1050, unit: "g" }],
        intents: [
          {
            ...unresolved,
            itemIndex: 0,
            unresolvedReason: null,
            quantity: { amount: 1050, unit: "g", provenance: "explicit-note" },
          },
        ],
      }),
      initialState(),
      quote,
    ),
  ).toThrow("invalidDraft");
});
test("UTF-16 evidence cannot split an emoji and null grocery quantity produces a validation result", () => {
  const source = "🥣 1 l maitoa";
  const exact: RequestIntent = {
    id: "milk",
    kind: "grocery",
    label: "1 l maitoa",
    evidence: { start: 3, end: 13, quote: "1 l maitoa" },
    provenance: "explicit-note",
    quantity: { amount: 1000, unit: "ml", provenance: "explicit-note" },
    mealIndex: null,
    itemIndex: 0,
    unresolvedReason: null,
  };
  const draft = {
    items: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    intents: [exact],
  };
  expect(
    validatePlanningDraft(JSON.stringify(draft), initialState(), source)
      .intents[0].id,
  ).toBe("intent-3-13");
  expect(() =>
    validatePlanningDraft(
      JSON.stringify({
        ...draft,
        intents: [
          { ...exact, evidence: { ...exact.evidence, start: 2, end: 12 } },
        ],
      }),
      initialState(),
      source,
    ),
  ).toThrow("invalidDraft");
  expect(
    requestIntentSchema.safeParse({ ...exact, quantity: null }).success,
  ).toBe(false);
  expect(() =>
    validatePlanningDraft(
      JSON.stringify({
        ...draft,
        intents: [
          {
            ...exact,
            quantity: { amount: null, unit: null, provenance: "unknown" },
            itemIndex: null,
            unresolvedReason: "unknown-quantity",
          },
        ],
      }),
      initialState(),
      source,
    ),
  ).toThrow("invalidDraft");
});
test("shared ingredient rows may map to several meals without duplicating required quantity", () => {
  const { draft, wanted, mappings } = parsed();
  const milkKey = mappings[0].requirementKeys[0];
  expect(wanted.find((r) => `${r.id}:${r.unit}` === milkKey)!.amount).toBe(500);
  expect(draft.items[0].amount).toBe(1000);
  const lines = wanted.map((r) => matchRequirement(r, []));
  const results = mapIntentResults(mappings, wanted, lines, { complete: true });
  expect(results).toHaveLength(5);
  expect(
    results
      .slice(0, 3)
      .every(
        (result) =>
          result.status === "unresolved" && result.reason === "empty-search",
      ),
  ).toBe(true);
  expect(results[3].reason).toBe("unknown-quantity");
  expect(results[4].reason).toBe("unsupported-request");
});
test("missing, bounded or duplicated downstream results cannot silently drop identified requests", () => {
  const { wanted, mappings } = parsed();
  expect(
    mapIntentResults(mappings, wanted, [], { complete: true })[0].reason,
  ).toBe("missing-result");
  expect(mapIntentResults(mappings, [], [], { complete: true })[0].reason).toBe(
    "missing-requirement",
  );
  expect(
    mapIntentResults(mappings, wanted, [], {
      boundedOut: [mappings[0].requirementKeys[0]],
    })[0].reason,
  ).toBe("bounded-out");
  const line = matchRequirement(wanted[0], []);
  expect(() => mapIntentResults(mappings, wanted, [line, line])).toThrow(
    "invalidIntentMapping",
  );
  expect(() =>
    mapIntentResults([mappings[0], mappings[0]], wanted, []),
  ).toThrow("invalidIntentMapping");
  expect(() =>
    mapIntentResults(mappings, wanted, [
      { ...line, requirement: { ...line.requirement, amount: 1 } },
    ]),
  ).toThrow("invalidIntentMapping");
});
test("ledger validation cannot certify arbitrary-note interpretation; independent note expectations still catch an omitted request", () => {
  const omitted = structuredClone(reply);
  omitted.intents = omitted.intents.filter((i) => i.label !== "kahvia");
  const draft = validatePlanningDraft(
    JSON.stringify(omitted),
    initialState(),
    note,
  );
  const labels = new Set(draft.intents.map((i) => i.label));
  const missing = expected.filter((request) => !labels.has(request.label));
  expect(missing).toEqual([{ label: "kahvia", kind: "grocery" }]);
});
test("planning previews preserve each request through normalization, missing search and ready", () => {
  const { state, draft } = parsed();
  const lifecycle = new PlanningLifecycle(() => state);
  const run = lifecycle.start(note);
  const provider = new ScriptedInferenceProvider("intent-preview", async () => {
    throw new Error("no dispatch");
  });
  run.bindInference(provider, provider.models[0]);
  run.publishDraft(draft);
  const ownedDraft = run.validatedDraft()!;
  const wanted = requirements({
    ...state,
    recipes: [...state.recipes, ...ownedDraft.recipes],
    meals: ownedDraft.meals.map((meal, index) => ({
      ...meal,
      id: `preview-meal-${index}`,
    })),
    extras: ownedDraft.items,
  });
  expect(
    lifecycle.snapshot()!.intents.map((result) => result.intent.label),
  ).toEqual(expected.map((request) => request.label));
  expect(lifecycle.snapshot()!.intents[3].status).toBe("unresolved");
  run.setRequirements(wanted);
  for (const r of wanted) run.publishRow(matchRequirement(r, []));
  run.ready();
  const preview = lifecycle.snapshot()!;
  expect(preview.intents).toHaveLength(5);
  expect(
    preview.intents.every((result) => result.status === "unresolved"),
  ).toBe(true);
  expect(preview.intents.slice(0, 3).map((result) => result.reason)).toEqual([
    "empty-search",
    "empty-search",
    "empty-search",
  ]);
  expect(preview.intents[3].intent.quantity!.amount).toBeNull();
  expect(preview.transferEligible).toBe(false);
  expect(state.extras).toEqual([]);
  expect(provider.calls).toHaveLength(0);
});
