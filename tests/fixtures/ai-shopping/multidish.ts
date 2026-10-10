import { shoppingCaseSchema, type ShoppingCase } from "./schema";
import type { Recipe, Unit } from "../../../src/domain/model";

// Independently authored note expectations. Canned interpretations below are separate inputs.
const notes = [
  [
    "Maitoa 1 litra ja kananmunia 6 kpl",
    "One litre of milk and six eggs",
    [
      ["Maito", "milk", 1000, "ml"],
      ["Kananmuna", "eggs", 6, "pcs"],
    ],
  ],
  [
    "Leipää 500 g ja kahvia 500 g",
    "500 g bread and 500 g coffee",
    [
      ["Leipä", "bread", 500, "g"],
      ["Kahvi", "coffee", 500, "g"],
    ],
  ],
  [
    "Riisiä 750 g ja sipuleita 300 g",
    "750 g rice and 300 g onions",
    [
      ["Riisi", "rice", 750, "g"],
      ["Sipuli", "onion", 300, "g"],
    ],
  ],
  [
    "Jauhelihaa 800 g ja perunoita 1 kg",
    "800 g mince and one kilogram of potatoes",
    [
      ["Jauheliha", "mince", 800, "g"],
      ["Peruna", null, 1000, "g"],
    ],
  ],
  [
    "Pakastepizza 350 g ja jogurttia 400 g",
    "A 350 g frozen pizza and 400 g yoghurt",
    [
      ["Pakastepizza", null, 350, "g"],
      ["Jogurtti", null, 400, "g"],
    ],
  ],
  [
    "Aamupalaksi leipää 500 g ja maitoa 1 l",
    "For breakfast 500 g bread and one litre milk",
    [
      ["Leipä", "bread", 500, "g"],
      ["Maito", "milk", 1000, "ml"],
    ],
  ],
  [
    "Välipalaksi jogurttia 400 g ja suklaata 100 g",
    "For a snack 400 g yoghurt and 100 g chocolate",
    [
      ["Jogurtti", null, 400, "g"],
      ["Suklaa", null, 100, "g"],
    ],
  ],
  [
    "Riisiruoka kahdelle: riisiä 200 g ja sipulia 100 g. Lisäksi jogurttia 400 g",
    "Rice meal for two: 200 g rice and 100 g onion. Also 400 g yoghurt",
    [
      ["Riisi", "rice", 200, "g"],
      ["Sipuli", "onion", 100, "g"],
      ["Jogurtti", null, 400, "g"],
    ],
  ],
  [
    "Riisiruoka kahdelle (riisiä 200 g, sipulia 100 g) ja perunakeitto kahdelle (perunaa 500 g, sipulia 100 g)",
    "Rice meal for two (200 g rice, 100 g onion) and potato soup for two (500 g potatoes, 100 g onion)",
    [
      ["Riisi", "rice", 200, "g"],
      ["Sipuli", "onion", 200, "g"],
      ["Peruna", null, 500, "g"],
    ],
  ],
  [
    "Riisiruoka kahdelle (riisiä 200 g, sipulia 100 g), pakastepizza 350 g, aamupalaksi leipää 500 g ja välipalaksi jogurttia 400 g",
    "Rice meal for two (200 g rice, 100 g onion), 350 g frozen pizza, breakfast bread 500 g and snack yoghurt 400 g",
    [
      ["Riisi", "rice", 200, "g"],
      ["Sipuli", "onion", 100, "g"],
      ["Pakastepizza", null, 350, "g"],
      ["Leipä", "bread", 500, "g"],
      ["Jogurtti", null, 400, "g"],
    ],
  ],
] as const;

// Synthetic catalogue labels state the positive default facts; note and quantity expectations stay independent.
const foods = {
  Maito: ["milk", "Maito 1 l", 1.2],
  Kananmuna: ["eggs", "Kananmuna 6 kpl", 2.5],
  Leipä: ["bread", "Leipä 500 g", 2],
  Kahvi: ["coffee", "Kahvi suodatinjauhatus 500 g", 4],
  Riisi: ["rice", "Pitk�jyv�inen kuiva riisi 1 kg", 2],
  Sipuli: ["onion", "Keltasipuli 500 g", 1],
  Jauheliha: ["mince", "Naudan jauheliha 400 g", 3],
  Peruna: ["potato", "Peruna 1 kg", 1.5],
  Pakastepizza: ["pizza", "Pakastepizza 350 g", 3],
  Jogurtti: ["yoghurt", "Jogurtti 400 g", 1.5],
  Suklaa: ["chocolate", "Suklaa 100 g", 1],
} as const;
type Food = keyof typeof foods;
const item = (name: Food, amount: number, unit: Unit) => ({
  id: foods[name][0],
  name,
  amount,
  unit,
});
const recipe = (
  id: string,
  name: string,
  kind: Recipe["kind"],
  ingredients: Recipe["ingredients"],
): Recipe => ({
  id,
  name,
  kind,
  servings: 2,
  ingredients,
  instructions: "Local synthetic fixture.",
});

// Canned task outputs are explicit, rather than reconstructed from the expected rows.
const outputs = [
  { items: [item("Maito", 1000, "ml"), item("Kananmuna", 6, "pcs")] },
  { items: [item("Leipä", 500, "g"), item("Kahvi", 500, "g")] },
  { items: [item("Riisi", 750, "g"), item("Sipuli", 300, "g")] },
  { items: [item("Jauheliha", 800, "g"), item("Peruna", 1000, "g")] },
  { items: [item("Pakastepizza", 350, "g"), item("Jogurtti", 400, "g")] },
  {
    recipes: [
      recipe("breakfast", "Breakfast", "breakfast", [
        item("Leipä", 500, "g"),
        item("Maito", 1000, "ml"),
      ]),
    ],
  },
  {
    recipes: [
      recipe("snack", "Snack", "snack", [
        item("Jogurtti", 400, "g"),
        item("Suklaa", 100, "g"),
      ]),
    ],
  },
  {
    recipes: [
      recipe("rice-meal", "Rice meal", "meal", [
        item("Riisi", 200, "g"),
        item("Sipuli", 100, "g"),
      ]),
    ],
    items: [item("Jogurtti", 400, "g")],
  },
  {
    recipes: [
      recipe("rice-meal", "Rice meal", "meal", [
        item("Riisi", 200, "g"),
        item("Sipuli", 100, "g"),
      ]),
      recipe("potato-soup", "Potato soup", "meal", [
        item("Peruna", 500, "g"),
        { ...item("Sipuli", 100, "g"), id: "different-onion-id" },
      ]),
    ],
  },
  {
    recipes: [
      recipe("rice-meal", "Rice meal", "meal", [
        item("Riisi", 200, "g"),
        item("Sipuli", 100, "g"),
      ]),
      recipe("ready-pizza", "Frozen pizza", "ready", [
        item("Pakastepizza", 350, "g"),
      ]),
      recipe("breakfast", "Breakfast", "breakfast", [item("Leipä", 500, "g")]),
      recipe("snack", "Snack", "snack", [item("Jogurtti", 400, "g")]),
    ],
  },
];
const dishes: Record<number, string[]> = {
  5: ["Breakfast"],
  6: ["Snack"],
  7: ["Rice meal"],
  8: ["Rice meal", "Potato soup"],
  9: ["Rice meal", "Frozen pizza", "Breakfast", "Snack"],
};

export const multiDishCases: ShoppingCase[] = notes.flatMap(
  ([fi, en, expected], index) =>
    [fi, en].map((note, language) => {
      const output = outputs[index];
      const recipes = "recipes" in output ? (output.recipes ?? []) : [];
      return shoppingCaseSchema.parse({
        id: `multidish-${index + 1}-${language === 0 ? "fi" : "en"}`,
        note,
        expected: [
          ...expected.map(([name, category, amount, unit]) => ({
            id: `requested-${foods[name][0]}`,
            kind: "grocery",
            names: [name],
            category,
            amount,
            unit,
            admissible: [foods[name][0]],
          })),
          ...(dishes[index] ?? []).map((name, dish) => ({
            id: `requested-dish-${dish}`,
            kind: "dish",
            names: [name],
          })),
        ],
        replies: [
          JSON.stringify({
            ...output,
            meals: recipes.map((r) => ({ recipeId: r.id, servings: 2 })),
          }),
        ],
        catalogue: Object.fromEntries(
          Object.entries(foods).map(([name, [id, productName, price]]) => [
            name,
            [{ id, name: productName, price }],
          ]),
        ),
      });
    }),
);
