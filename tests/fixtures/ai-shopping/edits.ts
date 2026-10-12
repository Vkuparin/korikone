import { editCaseSchema, type EditCase } from "./edit-schema";

/**
 * The shared `editPlan()` list (tests/helpers/edit-plan.ts) buys these rows. Carrot is marked at
 * home, so it is bought at 0. Expectations below come from the instruction and from this table, not
 * from interpreter output.
 *
 * | row | bought | fed by |
 * | pasta:g 400, tomato:g 800 | Tomaattipasta (m-pasta, 4) |
 * | potato:g 800, cream:ml 200, carrot:g at home | Peruna-porkkanakeitto (m-soup, 4) |
 * | oats:g 200, milk:ml 800 | Kaurapuuro (m-porridge, 4) |
 * | milk:ml +1000, ruisleipä:g 500, paahtoleipä:g 400 | manual extras |
 */
const baseline = [
  "pasta:g",
  "tomato:g",
  "potato:g",
  "carrot:g",
  "cream:ml",
  "oats:g",
  "milk:ml",
  "ruisleipä:g",
  "paahtoleipä:g",
];
const keep = (...changed: string[]) =>
  baseline.filter((key) => !changed.includes(key));

const draft: (Omit<EditCase, "undo"> & { undo?: boolean })[] = [
  {
    id: "edit-add-coffee-fi",
    language: "fi",
    kind: "add",
    instruction: "lisää 500 g kahvia",
    outcome: "applied",
    expectedOperations: [
      { op: "addItem", targetId: "row:kahvi:g", after: 500 },
    ],
    expectedAmounts: { "kahvi:g": 500 },
    preserved: keep(),
  },
  {
    id: "edit-add-milk-litres-en",
    language: "en",
    kind: "add",
    instruction: "add 2 l milk",
    outcome: "applied",
    expectedOperations: [
      { op: "addItem", targetId: "row:milk:ml", after: 3800 },
    ],
    expectedAmounts: { "milk:ml": 3800 },
    preserved: keep("milk:ml"),
  },
  {
    id: "edit-add-two-cartons-fi",
    language: "fi",
    kind: "add",
    instruction: "lisää 2 tölkkiä maitoa",
    outcome: "applied",
    expectedOperations: [
      { op: "addItem", targetId: "row:milk:ml", after: 3800 },
    ],
    expectedAmounts: { "milk:ml": 3800 },
    preserved: keep("milk:ml"),
  },
  {
    id: "edit-remove-rye-fi",
    language: "fi",
    kind: "remove",
    instruction: "poista ruisleipä",
    outcome: "applied",
    expectedOperations: [
      { op: "removeItem", targetId: "row:ruisleipä:g", after: 0 },
    ],
    expectedAmounts: { "ruisleipä:g": 0 },
    preserved: keep("ruisleipä:g"),
  },
  {
    id: "edit-remove-bread-ambiguous-fi",
    language: "fi",
    kind: "remove",
    instruction: "poista leipä",
    outcome: "clarification",
    expectedOperations: [],
    expectedCandidates: [["row:ruisleipä:g", "row:paahtoleipä:g"]],
    expectedAmounts: {},
    preserved: baseline,
  },
  {
    id: "edit-remove-focused-this-en",
    language: "en",
    kind: "remove",
    instruction: "remove this",
    focusTargetId: "row:paahtoleipä:g",
    outcome: "applied",
    expectedOperations: [
      { op: "removeItem", targetId: "row:paahtoleipä:g", after: 0 },
    ],
    expectedAmounts: { "paahtoleipä:g": 0 },
    preserved: keep("paahtoleipä:g"),
  },
  {
    id: "edit-replace-pasta-sausage-soup-fi",
    language: "fi",
    kind: "replace",
    instruction: "vaihda pasta nakkikeittoon",
    outcome: "applied",
    expectedOperations: [{ op: "replaceMeal", targetId: "meal:m-pasta" }],
    expectedMealRecipes: { "m-pasta": "Nakkikeitto" },
    expectedAmounts: { "pasta:g": 0 },
    // Sausage soup may share potato, carrot, cream or milk; unrelated rows stay as they were.
    preserved: ["oats:g", "ruisleipä:g", "paahtoleipä:g"],
  },
  {
    id: "edit-replace-pasta-sausage-soup-en",
    language: "en",
    kind: "replace",
    instruction: "replace the pasta with sausage soup",
    outcome: "applied",
    expectedOperations: [{ op: "replaceMeal", targetId: "meal:m-pasta" }],
    expectedMealRecipes: { "m-pasta": "Nakkikeitto" },
    expectedAmounts: { "pasta:g": 0 },
    preserved: ["oats:g", "ruisleipä:g", "paahtoleipä:g"],
  },
  {
    id: "edit-replace-pasta-saved-lasagne-fi",
    language: "fi",
    kind: "replace",
    instruction: "vaihda pasta lasagneen",
    outcome: "applied",
    expectedOperations: [{ op: "replaceMeal", targetId: "meal:m-pasta" }],
    expectedMealRecipes: { "m-pasta": "Lasagne" },
    // Lasagne for the same four servings: 250 g sheets, 400 g tomato, 500 ml milk on top of 1,800.
    expectedAmounts: {
      "pasta:g": 0,
      "lasagne-sheets:g": 250,
      "tomato:g": 400,
      "milk:ml": 2300,
    },
    preserved: keep("pasta:g", "tomato:g", "milk:ml"),
  },
  {
    id: "edit-double-soup-fi",
    language: "fi",
    kind: "servings",
    instruction: "tuplaa keitto",
    outcome: "applied",
    expectedOperations: [
      { op: "changeServings", targetId: "meal:m-soup", after: 8 },
    ],
    expectedAmounts: { "potato:g": 1600, "cream:ml": 400 },
    preserved: keep("potato:g", "cream:ml"),
  },
  {
    id: "edit-soup-six-people-en",
    language: "en",
    kind: "servings",
    instruction: "soup for 6 people",
    outcome: "applied",
    expectedOperations: [
      { op: "changeServings", targetId: "meal:m-soup", after: 6 },
    ],
    expectedAmounts: { "potato:g": 1200, "cream:ml": 300 },
    preserved: keep("potato:g", "cream:ml"),
  },
  {
    id: "edit-pasta-eight-fi",
    language: "fi",
    kind: "servings",
    instruction: "pasta 8 hengelle",
    outcome: "applied",
    expectedOperations: [
      { op: "changeServings", targetId: "meal:m-pasta", after: 8 },
    ],
    expectedAmounts: { "pasta:g": 800, "tomato:g": 1600 },
    preserved: keep("pasta:g", "tomato:g"),
  },
  {
    id: "edit-potatoes-two-kilos-fi",
    language: "fi",
    kind: "quantity",
    instruction: "2 kg perunaa",
    outcome: "applied",
    expectedOperations: [
      { op: "changeQuantity", targetId: "row:potato:g", after: 2000 },
    ],
    expectedAmounts: { "potato:g": 2000 },
    preserved: keep("potato:g"),
  },
  {
    id: "edit-milk-two-cartons-fi",
    language: "fi",
    kind: "quantity",
    instruction: "kaksi maitotölkkiä",
    outcome: "applied",
    expectedOperations: [
      { op: "changeQuantity", targetId: "row:milk:ml", after: 2000 },
    ],
    expectedAmounts: { "milk:ml": 2000 },
    preserved: keep("milk:ml"),
  },
  {
    id: "edit-potato-at-home-fi",
    language: "fi",
    kind: "at-home",
    instruction: "peruna löytyy kotoa",
    outcome: "applied",
    expectedOperations: [
      { op: "markAtHome", targetId: "row:potato:g", after: 0 },
    ],
    expectedAmounts: { "potato:g": 0 },
    preserved: keep("potato:g"),
  },
  {
    id: "edit-milk-already-have-en",
    language: "en",
    kind: "at-home",
    instruction: "we already have milk",
    outcome: "applied",
    expectedOperations: [
      { op: "markAtHome", targetId: "row:milk:ml", after: 0 },
    ],
    expectedAmounts: { "milk:ml": 0 },
    preserved: keep("milk:ml"),
  },
  {
    id: "edit-carrot-not-at-home-fi",
    language: "fi",
    kind: "at-home",
    instruction: "porkkanaa ei löydy kotoa",
    outcome: "applied",
    expectedOperations: [
      { op: "markAtHome", targetId: "row:carrot:g", after: 400 },
    ],
    expectedAmounts: { "carrot:g": 400 },
    preserved: keep("carrot:g"),
  },
  {
    id: "edit-conflicting-same-row-fi",
    language: "fi",
    kind: "conflict",
    instruction: "poista ruisleipä ja lisää 200 g ruisleipää",
    // Two operations on one row cannot both apply; nothing, including the clear part, changes.
    outcome: "unchanged",
    expectedOperations: [],
    expectedAmounts: {},
    preserved: baseline,
  },
  {
    id: "edit-multi-soup-milk-rye-fi",
    language: "fi",
    kind: "multi",
    instruction: "tuplaa keitto, lisää 2 tölkkiä maitoa ja poista tämä",
    focusTargetId: "row:ruisleipä:g",
    outcome: "applied",
    expectedOperations: [
      { op: "changeServings", targetId: "meal:m-soup", after: 8 },
      { op: "addItem", targetId: "row:milk:ml", after: 3800 },
      { op: "removeItem", targetId: "row:ruisleipä:g", after: 0 },
    ],
    expectedAmounts: {
      "potato:g": 1600,
      "cream:ml": 400,
      "milk:ml": 3800,
      "ruisleipä:g": 0,
    },
    preserved: keep("potato:g", "cream:ml", "milk:ml", "ruisleipä:g"),
  },
  {
    id: "edit-remove-toast-then-undo-fi",
    language: "fi",
    kind: "undo",
    instruction: "poista paahtoleipä",
    outcome: "applied",
    expectedOperations: [
      { op: "removeItem", targetId: "row:paahtoleipä:g", after: 0 },
    ],
    expectedAmounts: { "paahtoleipä:g": 0 },
    preserved: keep("paahtoleipä:g"),
    undo: true,
  },
];

export const editCases: EditCase[] = draft.map((c) =>
  editCaseSchema.parse({ undo: false, ...c }),
);
