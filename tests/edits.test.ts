import { test, expect } from "vitest";
import {
  EditError,
  applyEditIntent,
  applyEdits,
  editBatchSchema,
  editTargets,
  mealTargetId,
  rowTargetId,
  type EditOperation,
} from "../src/domain/edits";
import { initialState, type AppState } from "../src/domain/model";
import { requirements } from "../src/domain/planner";

const now = new Date("2026-10-12T08:00:00Z");
/** Pasta and soup for four, porridge sharing milk with a manual carton, and two breads. */
function plan(): AppState {
  const state = initialState();
  state.staples = [];
  state.revision = 7;
  state.recipes.push({
    id: "lasagne",
    name: "Lasagne",
    servings: 4,
    ingredients: [
      { id: "lasagne-sheets", name: "Lasagnelevy", amount: 250, unit: "g" },
      { id: "tomato", name: "Tomaattimurska", amount: 400, unit: "g" },
      { id: "milk", name: "Maito", amount: 500, unit: "ml" },
    ],
    instructions: "",
  });
  state.meals = [
    { id: "m-pasta", recipeId: "pasta", day: 0, servings: 4, leftovers: false },
    { id: "m-soup", recipeId: "soup", day: 1, servings: 4, leftovers: false },
    {
      id: "m-porridge",
      recipeId: "porridge",
      day: 2,
      servings: 4,
      leftovers: false,
    },
  ];
  state.extras = [
    { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
    { id: "ruisleipä", name: "Ruisleipä", amount: 500, unit: "g" },
    { id: "paahtoleipä", name: "Paahtoleipä", amount: 400, unit: "g" },
  ];
  state.skipped = ["carrot:g"];
  state.accepted = { "demo-k:demo-helsinki:potato": ["potato-1"] };
  return state;
}
const batch = (operations: EditOperation[], revision = 7) => ({
  version: 1,
  revision,
  operations,
});
const amounts = (state: AppState, home = false) =>
  Object.fromEntries(
    requirements(state, now, home).map((r) => [`${r.id}:${r.unit}`, r.amount]),
  );
function rejected(
  state: AppState,
  input: unknown,
  code: string,
  operation: number | null = null,
) {
  const before = JSON.stringify(state);
  let error: unknown;
  try {
    applyEdits(state, input, { now });
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(EditError);
  expect((error as EditError).code).toBe(code);
  expect((error as EditError).operation).toBe(operation);
  expect(JSON.stringify(state)).toBe(before);
}

test("targets are exact row keys and meal IDs, including rows marked at home", () => {
  const targets = editTargets(plan(), now);
  expect(targets.meals.map((m) => [m.targetId, m.name, m.servings])).toEqual([
    ["meal:m-pasta", "Tomaattipasta", 4],
    ["meal:m-soup", "Peruna-porkkanakeitto", 4],
    ["meal:m-porridge", "Kaurapuuro", 4],
  ]);
  const carrot = targets.rows.find((r) => r.key === "carrot:g")!;
  expect(carrot).toMatchObject({ targetId: "row:carrot:g", atHome: true });
  expect(targets.rows.find((r) => r.key === "milk:ml")).toMatchObject({
    amount: 1800,
    sources: ["Kaurapuuro", "extra"],
    atHome: false,
  });
  expect(rowTargetId("milk:ml")).toBe("row:milk:ml");
  expect(mealTargetId("m-soup")).toBe("meal:m-soup");
});

test("unknown, duplicate, stale and malformed edits reject without mutation", () => {
  const state = plan();
  rejected(
    state,
    batch([{ op: "removeItem", rowKey: "saffron:g" }]),
    "unknownTarget",
    0,
  );
  rejected(
    state,
    batch([
      { op: "markAtHome", rowKey: "pasta:g", atHome: true },
      { op: "changeServings", mealId: "m-missing", servings: 2 },
    ]),
    "unknownTarget",
    1,
  );
  rejected(
    state,
    batch([
      {
        op: "replaceMeal",
        mealId: "m-pasta",
        replacement: { kind: "saved", recipeId: "curry" },
      },
    ]),
    "unknownTarget",
    0,
  );
  rejected(
    state,
    batch([
      { op: "removeItem", rowKey: "pasta:g" },
      {
        op: "changeQuantity",
        rowKey: "pasta:g",
        quantity: { kind: "amount", amount: 500, unit: "g" },
      },
    ]),
    "duplicateTarget",
    1,
  );
  rejected(
    state,
    batch([
      { op: "changeServings", mealId: "m-soup", servings: 8 },
      {
        op: "replaceMeal",
        mealId: "m-soup",
        replacement: { kind: "saved", recipeId: "lasagne" },
      },
    ]),
    "duplicateTarget",
    1,
  );
  // An added name that resolves to a row already targeted is the same target.
  rejected(
    state,
    batch([
      { op: "removeItem", rowKey: "milk:ml" },
      {
        op: "addItem",
        name: "maito",
        quantity: { kind: "amount", amount: 1000, unit: "ml" },
      },
    ]),
    "duplicateTarget",
    1,
  );
  rejected(
    state,
    batch([{ op: "removeItem", rowKey: "pasta:g" }], 6),
    "staleEdit",
  );
  for (const invalid of [
    batch([{ op: "removeMeal", mealId: "m-soup" } as never]),
    batch([{ op: "removeItem", rowKey: "pasta:g", fuzzy: true } as never]),
    batch([{ op: "addItem", quantity: { kind: "packs", count: 1 } } as never]),
    batch([
      {
        op: "addItem",
        name: "Maito",
        rowKey: "milk:ml",
        quantity: { kind: "packs", count: 1 },
      },
    ]),
    batch([
      {
        op: "changeQuantity",
        rowKey: "pasta:g",
        quantity: { kind: "amount", amount: 1.5, unit: "g" },
      },
    ]),
    batch([
      {
        op: "changeQuantity",
        rowKey: "pasta:g",
        quantity: { kind: "amount", amount: 1, unit: "kg" } as never,
      },
    ]),
    batch([]),
    { ...batch([{ op: "removeItem", rowKey: "pasta:g" }]), version: 2 },
  ])
    rejected(state, invalid, "unsupportedEdit");
  expect(editBatchSchema.safeParse(batch([])).success).toBe(false);
});

test("a quantity in another unit is rejected instead of converted", () => {
  const state = plan();
  rejected(
    state,
    batch([
      { op: "markAtHome", rowKey: "potato:g", atHome: true },
      {
        op: "changeQuantity",
        rowKey: "milk:ml",
        quantity: { kind: "amount", amount: 2, unit: "pcs" },
      },
    ]),
    "invalidUnit",
    1,
  );
});

test("replacing pasta keeps the meal slot, shared rows and unrelated choices", () => {
  const state = plan();
  state.quantities["tomato:g"] = 1000;
  state.requestIntents = [];
  const {
    state: next,
    applied,
    changedKeys,
  } = applyEdits(
    state,
    batch([
      {
        op: "replaceMeal",
        mealId: "m-pasta",
        replacement: { kind: "saved", recipeId: "lasagne" },
      },
    ]),
    { now },
  );
  expect(next.meals[0]).toEqual({
    id: "m-pasta",
    recipeId: "lasagne",
    day: 0,
    servings: 4,
    leftovers: false,
  });
  expect(next.revision).toBe(7);
  const rows = amounts(next);
  // Pasta's only source is gone; tomato keeps the explicit quantity less pasta's extra 400 g.
  expect(rows["pasta:g"]).toBeUndefined();
  expect(rows["tomato:g"]).toBe(600);
  expect(rows["lasagne-sheets:g"]).toBe(250);
  // Milk is shared by porridge, the manual carton and now lasagne.
  expect(rows["milk:ml"]).toBe(2300);
  expect(next.skipped).toEqual(["carrot:g"]);
  expect(next.accepted).toEqual(state.accepted);
  expect(next.extras).toEqual(state.extras);
  expect(applied).toEqual([
    {
      op: "replaceMeal",
      targetId: "meal:m-pasta",
      name: "Tomaattipasta",
      to: "Lasagne",
      before: 4,
      after: 4,
    },
  ]);
  expect(changedKeys.sort()).toEqual(
    ["lasagne-sheets:g", "milk:ml", "pasta:g", "tomato:g"].sort(),
  );
  expect(state.meals[0].recipeId).toBe("pasta");
});

test("a new replacement recipe is saved, and a colliding recipe ID rejects", () => {
  const state = plan();
  const recipe = {
    id: "curry",
    name: "Kanacurry",
    servings: 2,
    ingredients: [
      { id: "chicken", name: "Broilerin fileesuikale", amount: 300, unit: "g" },
    ],
    instructions: "",
  } as const;
  const { state: next } = applyEdits(
    state,
    batch([
      {
        op: "replaceMeal",
        mealId: "m-soup",
        replacement: { kind: "new", recipe: structuredClone(recipe) as never },
        servings: 4,
      },
    ]),
    { now },
  );
  expect(next.recipes.at(-1)).toMatchObject({ id: "curry" });
  expect(amounts(next)["chicken:g"]).toBe(600);
  // The soup's carrot row is gone, so its at-home flag cannot attach to a later carrot row.
  expect(next.skipped).toEqual([]);
  rejected(
    state,
    batch([
      {
        op: "replaceMeal",
        mealId: "m-soup",
        replacement: {
          kind: "new",
          recipe: { ...structuredClone(recipe), id: "pasta" } as never,
        },
      },
    ]),
    "invalidEdit",
    0,
  );
});

test("two milk cartons use the quoted pack, and no pack is guessed", () => {
  const state = plan();
  const cartons: EditOperation = {
    op: "changeQuantity",
    rowKey: "milk:ml",
    quantity: { kind: "packs", count: 2 },
  };
  const { state: next, applied } = applyEdits(state, batch([cartons]), {
    now,
    packSizes: { "milk:ml": { amount: 1000, unit: "ml" } },
  });
  expect(next.quantities["milk:ml"]).toBe(2000);
  expect(amounts(next)["milk:ml"]).toBe(2000);
  expect(applied[0]).toMatchObject({ before: 1800, after: 2000, unit: "ml" });
  // Adding cartons to the same row counts packs of the quoted product too.
  const added = applyEdits(
    state,
    batch([
      {
        op: "addItem",
        name: "Maito",
        quantity: { kind: "packs", count: 2 },
      },
    ]),
    { now, packSizes: { "milk:ml": { amount: 1000, unit: "ml" } } },
  );
  expect(amounts(added.state)["milk:ml"]).toBe(3800);
  expect(added.state.extras.find((i) => i.id === "milk")?.amount).toBe(3000);
  rejected(state, batch([cartons]), "packSizeUnknown", 0);
  let error: unknown;
  try {
    applyEdits(state, batch([cartons]), {
      now,
      packSizes: { "milk:ml": { amount: 1, unit: "pcs" } },
    });
  } catch (e) {
    error = e;
  }
  expect((error as EditError).code).toBe("packSizeUnknown");
  // A grocery that is not on the list has no quoted pack to count.
  rejected(
    state,
    batch([
      { op: "addItem", name: "Kahvi", quantity: { kind: "packs", count: 2 } },
    ]),
    "packSizeUnknown",
    0,
  );
});

test("doubling soup scales its ingredients and leaves other meals alone", () => {
  const state = plan();
  state.skipped = [];
  const {
    state: next,
    applied,
    changedKeys,
  } = applyEdits(
    state,
    batch([{ op: "changeServings", mealId: "m-soup", servings: 8 }]),
    { now },
  );
  const rows = amounts(next);
  expect([rows["potato:g"], rows["carrot:g"], rows["cream:ml"]]).toEqual([
    1600, 800, 400,
  ]);
  expect(rows["pasta:g"]).toBe(400);
  expect(rows["milk:ml"]).toBe(1800);
  expect(applied).toEqual([
    {
      op: "changeServings",
      targetId: "meal:m-soup",
      name: "Peruna-porkkanakeitto",
      before: 4,
      after: 8,
    },
  ]);
  expect(changedKeys.sort()).toEqual(["carrot:g", "cream:ml", "potato:g"]);
});

test("items add to shared rows, restore removed rows and keep the at-home marker", () => {
  const state = plan();
  state.removed = ["tomato:g"];
  state.quantities["potato:g"] = 2000;
  state.staples = initialState().staples.map((s) => ({ ...s, enabled: false }));
  const { state: next } = applyEdits(
    state,
    batch([
      {
        op: "addItem",
        name: " TOMAATTIMURSKA ",
        quantity: { kind: "amount", amount: 400, unit: "g" },
      },
      {
        op: "addItem",
        rowKey: "potato:g",
        quantity: { kind: "amount", amount: 500, unit: "g" },
      },
      {
        op: "addItem",
        rowKey: "carrot:g",
        quantity: { kind: "amount", amount: 100, unit: "g" },
      },
      {
        op: "addItem",
        name: "Vispikerma",
        quantity: { kind: "amount", amount: 200, unit: "ml" },
      },
      {
        op: "addItem",
        name: "Kahvi",
        quantity: { kind: "amount", amount: 500, unit: "g" },
      },
    ]),
    { now },
  );
  expect(next.removed).toEqual([]);
  expect(amounts(next)["tomato:g"]).toBe(1200);
  expect(next.quantities["potato:g"]).toBe(2500);
  expect(next.skipped).toEqual(["carrot:g"]);
  expect(amounts(next, true)["carrot:g"]).toBe(500);
  // Coffee reuses the saved recurring item's identity rather than creating a second row.
  expect(next.extras.at(-1)).toMatchObject({ id: "coffee", name: "Kahvi" });
  expect(next.extras.at(-1)?.classification).toBeUndefined();
  // A new grocery has only name-inferred, never explicit, category metadata.
  expect(next.extras.at(-2)).toMatchObject({
    id: "vispikerma",
    classification: {
      category: "cream",
      provenance: "model-assumed",
      qualifiers: [
        { kind: "cream", value: "whipping", provenance: "model-assumed" },
      ],
    },
  });
});

test("at-home, removal and quantity edits change only their own rows", () => {
  const state = plan();
  const { state: next, changedKeys } = applyEdits(
    state,
    batch([
      { op: "markAtHome", rowKey: "carrot:g", atHome: false },
      { op: "markAtHome", rowKey: "potato:g", atHome: true },
      { op: "removeItem", rowKey: "paahtoleipä:g" },
      {
        op: "changeQuantity",
        rowKey: "pasta:g",
        quantity: { kind: "amount", amount: 1000, unit: "g" },
      },
    ]),
    { now },
  );
  expect(next.skipped).toEqual(["potato:g"]);
  expect(next.removed).toEqual(["paahtoleipä:g"]);
  expect(next.quantities).toEqual({ "pasta:g": 1000 });
  expect(changedKeys.sort()).toEqual([
    "carrot:g",
    "paahtoleipä:g",
    "pasta:g",
    "potato:g",
  ]);
  expect(amounts(next)["ruisleipä:g"]).toBe(500);
  expect(next.meals).toEqual(state.meals);
});

test("one invalid operation rejects the whole batch", () => {
  const state = plan();
  rejected(
    state,
    batch([
      { op: "changeServings", mealId: "m-soup", servings: 8 },
      {
        op: "addItem",
        name: "Kahvi",
        quantity: { kind: "amount", amount: 500, unit: "g" },
      },
      { op: "removeItem", rowKey: "not-on-list:g" },
    ]),
    "unknownTarget",
    2,
  );
  // The replaced meal removes the row a later operation names.
  rejected(
    state,
    batch([
      {
        op: "replaceMeal",
        mealId: "m-pasta",
        replacement: { kind: "saved", recipeId: "soup" },
      },
      { op: "markAtHome", rowKey: "pasta:g", atHome: true },
    ]),
    "unknownTarget",
    1,
  );
  rejected(
    state,
    batch([{ op: "markAtHome", rowKey: "carrot:g", atHome: true }]),
    "noChange",
  );
});

test("ambiguous bread removal asks instead of choosing a row", () => {
  const state = plan();
  const before = JSON.stringify(state);
  const outcome = applyEditIntent(
    state,
    {
      version: 1,
      operations: [{ op: "changeServings", mealId: "m-soup", servings: 8 }],
      ambiguities: [
        {
          phrase: "poista leipä",
          candidates: ["row:ruisleipä:g", "row:paahtoleipä:g"],
        },
      ],
      unsupported: [],
    },
    { now },
  );
  expect(outcome).toEqual({
    status: "clarification",
    ambiguities: [
      {
        phrase: "poista leipä",
        candidates: ["row:ruisleipä:g", "row:paahtoleipä:g"],
      },
    ],
    unsupported: [],
  });
  expect(JSON.stringify(state)).toBe(before);
  // Candidates must be real targets, and a single candidate is not an ambiguity.
  for (const candidates of [
    ["row:ruisleipä:g", "row:sämpylä:g"],
    ["row:ruisleipä:g"],
    ["row:ruisleipä:g", "row:ruisleipä:g"],
  ])
    expect(() =>
      applyEditIntent(
        state,
        {
          version: 1,
          operations: [],
          ambiguities: [{ phrase: "leipä", candidates }],
          unsupported: [],
        },
        { now },
      ),
    ).toThrow(EditError);
  expect(
    applyEditIntent(
      state,
      {
        version: 1,
        operations: [],
        ambiguities: [],
        unsupported: [{ phrase: "tilaa kotiinkuljetus" }],
      },
      { now },
    ),
  ).toMatchObject({
    status: "clarification",
    unsupported: ["tilaa kotiinkuljetus"],
  });
  const applied = applyEditIntent(
    state,
    {
      version: 1,
      operations: [{ op: "removeItem", rowKey: "ruisleipä:g" }],
      ambiguities: [],
      unsupported: [],
    },
    { now },
  );
  expect(applied.status).toBe("applied");
  expect(() =>
    applyEditIntent(
      state,
      { version: 1, operations: [], ambiguities: [], unsupported: [] },
      { now },
    ),
  ).toThrow("unsupportedEdit");
});

test("a replaced dish keeps its request mapped to the replacement", () => {
  const state = plan();
  state.note = "tomaattipasta ja keitto";
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
    batch([
      {
        op: "replaceMeal",
        mealId: "m-pasta",
        replacement: { kind: "saved", recipeId: "lasagne" },
      },
    ]),
    { now },
  );
  expect(next.requestIntents[0]).toMatchObject({
    recipeId: "lasagne",
    requirementKeys: ["lasagne-sheets:g", "tomato:g", "milk:ml"],
  });
  expect(next.requestIntents[0].intent).toEqual(state.requestIntents[0].intent);
});
