import type { Recipe } from "../domain/model";

/** Scripted examples for the original multi-dish acceptance note. */
export const mealFixtures: { pattern: RegExp; recipe: Recipe }[] = [
  {
    // The live acceptance note of 9 October 2026, with the casing slip the model made.
    pattern: /makaronilaatikko|macaroni casserole/,
    recipe: {
      id: "fixture-macaroni-casserole",
      name: "Makaronilaatikko",
      servings: 4,
      kind: "meal",
      ingredients: [
        { id: "macaroni", name: "MakaronI", amount: 400, unit: "g" },
        { id: "mince", name: "Jauheliha", amount: 400, unit: "g" },
        { id: "onion", name: "Sipuli", amount: 100, unit: "g" },
        { id: "milk", name: "Maito", amount: 800, unit: "ml" },
        { id: "egg", name: "Kananmuna", amount: 2, unit: "pcs" },
        { id: "salt", name: "Suola", amount: 5, unit: "g" },
        { id: "pepper", name: "Mustapippuri", amount: 1, unit: "g" },
      ],
      instructions:
        "Keitä makaronit ja ruskista jauheliha sipulin kanssa. Kaada päälle munamaito ja paista uunissa.",
    },
  },
  {
    pattern: /nakkikeitto|sausage soup/,
    recipe: {
      id: "fixture-sausage-soup",
      name: "Nakkikeitto",
      servings: 4,
      kind: "meal",
      ingredients: [
        { id: "potato", name: "Peruna", amount: 800, unit: "g" },
        { id: "carrot", name: "Porkkana", amount: 400, unit: "g" },
        { id: "sausage", name: "Nakki", amount: 400, unit: "g" },
      ],
      instructions: "Keitä pilkotut kasvikset. Lisää nakit ja kuumenna.",
    },
  },
  {
    pattern: /kanapasta|chicken pasta/,
    recipe: {
      id: "fixture-chicken-pasta",
      name: "Kanapasta",
      servings: 4,
      kind: "meal",
      ingredients: [
        { id: "pasta", name: "Pasta", amount: 400, unit: "g" },
        {
          id: "chicken",
          name: "Broilerin fileesuikale",
          amount: 400,
          unit: "g",
        },
        { id: "cream", name: "Ruokakerma", amount: 200, unit: "ml" },
      ],
      instructions: "Keitä pasta. Kypsennä broileri ja lisää kerma. Yhdistä.",
    },
  },
  {
    pattern: /aamu|breakfast|jogurtti|yoghurt|banaan|banana/,
    recipe: {
      id: "fixture-breakfast",
      name: "Jogurtti ja banaanit",
      servings: 4,
      kind: "breakfast",
      ingredients: [
        { id: "yoghurt", name: "Jogurtti", amount: 800, unit: "g" },
        { id: "banana", name: "Banaani", amount: 4, unit: "pcs" },
      ],
      instructions: "Tarjoile jogurtti ja banaanit.",
    },
  },
  {
    pattern: /herk|treat|suklaa|chocolate/,
    recipe: {
      id: "fixture-treats",
      name: "Viikonlopun herkut",
      servings: 4,
      kind: "snack",
      ingredients: [
        { id: "chocolate", name: "Suklaa", amount: 200, unit: "g" },
      ],
      instructions: "Jaa suklaa annoksiin.",
    },
  },
];
