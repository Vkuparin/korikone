import { expect, test } from "vitest";
import { salvageDraft, salvageNote } from "../src/ai/salvage";
import { fallbackDraft, notePhrases, searchName } from "../src/ai/fallback";
import { applyEditIntent, EDIT_VERSION } from "../src/domain/edits";
import { initialState } from "../src/domain/model";
import { Service } from "../src/application/service";
import { editPlan } from "./helpers/edit-plan";

// B4.1–B4.4 (v0.11.2). Expectations are authored here, not produced by the app.
const state = { recipes: [], note: "" };

test("salvage downgrades an invented explicit claim and converts written units", () => {
  const note = "lohikeitto ja maitoa";
  const result = salvageDraft(
    JSON.stringify({
      recipes: [
        {
          id: "soup",
          name: "Lohikeitto",
          servings: 4,
          ingredients: [
            { id: "salmon", name: "Lohi", amount: 0.4, unit: "kg" },
            { id: "cream", name: "Kerma", amount: 2, unit: "dl" },
          ],
          instructions: "Keitä.",
        },
      ],
      meals: [{ recipeId: "soup", servings: 4 }],
      items: [
        {
          id: "milk",
          name: "Maito",
          amount: 1,
          unit: "l",
          // The note never says lactose-free: this claim cannot stay explicit.
          classification: {
            category: "milk",
            provenance: "explicit-note",
            evidence: { start: 0, end: 4, quote: "lakt" },
            qualifiers: [],
          },
        },
      ],
      notes: "",
    }),
    state,
    note,
  );
  expect(result).not.toBeNull();
  const recipe = result!.draft.recipes[0];
  expect(recipe.ingredients.map((i) => [i.name, i.amount, i.unit])).toEqual([
    ["Lohi", 400, "g"],
    ["Kerma", 200, "ml"],
  ]);
  expect(result!.draft.items[0]).toMatchObject({ amount: 1000, unit: "ml" });
  expect(result!.draft.items[0].classification?.provenance).not.toBe(
    "explicit-note",
  );
  expect(result!.omitted).toEqual([]);
});

test("salvage leaves out a meal with an unknown recipe, names it, and keeps the rest", () => {
  const result = salvageDraft(
    JSON.stringify({
      recipes: [
        {
          id: "tacos",
          name: "Tacot",
          servings: 4,
          ingredients: [
            { id: "mince", name: "Jauheliha", amount: 400, unit: "g" },
          ],
          instructions: "",
        },
        // No usable ingredient: the dish cannot be planned and is named back.
        {
          id: "curry",
          name: "Kanacurry",
          servings: 4,
          ingredients: [{ name: "Kana", amount: "paljon", unit: "g" }],
        },
      ],
      meals: [
        { recipeId: "tacos", servings: 4 },
        { recipeId: "missing", servings: 4 },
      ],
      items: [{ id: "eggs", name: "Kananmuna", amount: 10, unit: "kpl" }],
    }),
    state,
    "tacot, kanacurry ja kananmunia",
  );
  expect(result!.draft.meals.map((m) => m.recipeId)).toEqual(["tacos"]);
  expect(result!.draft.items).toMatchObject([
    { name: "Kananmuna", amount: 10, unit: "pcs" },
  ]);
  expect(result!.omitted).toEqual(["Kanacurry"]);
});

test("salvage keeps a recipe the reply forgot to put on the list and drops a bad side", () => {
  const note = "nakkikeitto ilman lisuketta";
  const result = salvageDraft(
    "Here is the plan: " +
      JSON.stringify({
        recipes: [
          {
            id: "soup",
            name: "Nakkikeitto",
            servings: 4,
            ingredients: [{ id: "n", name: "Nakki", amount: 400, unit: "g" }],
            instructions: "",
          },
        ],
        meals: [],
        items: [],
        sides: [{ mealIndex: 0, name: "Perunamuusi" }],
      }),
    state,
    note,
  );
  expect(result!.draft.meals).toMatchObject([{ recipeId: "soup" }]);
  expect(result!.draft.recipes[0].assumedSide).toBeUndefined();
});

test("salvage refuses a reply with nothing usable", () => {
  for (const raw of ["", "{", "[]", "{}", '{"recipes":[],"items":[]}'])
    expect(salvageDraft(raw, state, "maitoa")).toBeNull();
  expect(
    salvageNote("fi", {
      draft: initialState() as never,
      omitted: ["Kanacurry"],
      ledgerDropped: false,
    }),
  ).toMatch(/Kanacurry/);
});

test("the note fallback searches each request phrase by its base name", () => {
  expect(
    notePhrases("- 2 l maitoa\n1. kahvia, lasagne ja tacot; tacot"),
  ).toEqual(["2 l maitoa", "kahvia", "lasagne", "tacot"]);
  expect(
    [
      "2 l maitoa",
      "kahvia",
      "Kananmunia 10 kpl",
      "kilo perunaa",
      "Milk 2 litres",
      "Kevytmaitoa",
      "lasagne",
    ].map(searchName),
  ).toEqual([
    "Maito",
    "Kahvi",
    "Kananmuna",
    "Peruna",
    "Maito",
    "Kevytmaito",
    "Lasagne",
  ]);
  const draft = fallbackDraft("2 l maitoa, lasagne, appelsiinimehu", {
    ...state,
    language: "fi",
  })!;
  expect(draft.recipes).toEqual([]);
  expect(draft.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
    ["Maito", 2000, "ml"],
    ["Lasagne", 400, "g"],
    ["Appelsiinimehu", 1000, "ml"],
  ]);
  expect(draft.notes).toMatch(/sellaisinaan tuotehakuina/);
  expect(
    draft.items.every((i) => i.classification?.provenance !== "explicit-note"),
  ).toBe(true);
  expect(fallbackDraft(" , ; 12 ", { ...state, language: "en" })).toBeNull();
});

test("an edit applies its clear parts and reports the rest, unless the rest is about the same row", () => {
  const plan = editPlan();
  const partial = applyEditIntent(plan, {
    version: EDIT_VERSION,
    operations: [{ op: "removeItem", rowKey: "paahtoleipä:g" }],
    ambiguities: [],
    unsupported: [{ phrase: "tilaa kotiinkuljetus" }],
  });
  expect(partial).toMatchObject({
    status: "applied",
    unsupported: ["tilaa kotiinkuljetus"],
  });
  const conflict = applyEditIntent(plan, {
    version: EDIT_VERSION,
    operations: [{ op: "removeItem", rowKey: "ruisleipä:g" }],
    ambiguities: [],
    unsupported: [{ phrase: "lisää 200 g ruisleipää" }],
  });
  expect(conflict.status).toBe("clarification");
});

test("pricing keeps the rows it could read when one row's read fails", async () => {
  const entries = new Map<string, unknown>();
  const service = new Service({
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  });
  await service.init();
  await service.save({
    ...service.state,
    extras: [
      { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
      { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
    ],
  });
  const provider = service.registry.get(service.state.context.providerId);
  const real = provider.searchProducts.bind(provider);
  let failed = 0;
  provider.searchProducts = async (context, query, id) => {
    if (failed === 0) {
      failed++;
      throw new Error("storeUnavailable");
    }
    return real(context, query, id);
  };
  const priced = await service.buildBasket();
  expect(priced.basket.length).toBeGreaterThan(1);
  expect(
    priced.basket.filter((l) => l.matching?.reason === "bounded-out"),
  ).toHaveLength(1);
  expect(priced.basket.some((l) => l.product)).toBe(true);
  expect(priced.pricingError).toBeNull();
});
