import type { Recipe } from "../domain/model";

type Side = {
  name: string;
  /** The note asks for this side itself, so it is not added again. */
  pattern: RegExp;
  ingredients: Recipe["ingredients"];
};
const mash: Side = {
  name: "Perunamuusi",
  pattern: /perunamuus|mashed potato/,
  ingredients: [
    { id: "potato", name: "Peruna", amount: 800, unit: "g" },
    { id: "milk", name: "Maito", amount: 200, unit: "ml" },
    { id: "butter", name: "Voi", amount: 50, unit: "g" },
  ],
};
/**
 * Scripted examples: the original multi-dish acceptance note, and the 12 October playtest dishes.
 * `side` is what the planning fixture adds to a dish named alone.
 */
export const mealFixtures: { pattern: RegExp; recipe: Recipe; side?: Side }[] =
  [
    {
      pattern: /munakas|omelette/,
      recipe: {
        id: "fixture-omelette",
        name: "Munakas",
        kind: "breakfast",
        servings: 4,
        ingredients: [
          { id: "egg", name: "Kananmuna", amount: 4, unit: "pcs" },
          { id: "milk", name: "Maito", amount: 100, unit: "ml" },
        ],
        instructions: "Valmista ja jaa annoksiin.",
      },
    },
    {
      pattern: /marjajogurtti|berry yoghurt/,
      recipe: {
        id: "fixture-berry-yoghurt",
        name: "Marjajogurtti",
        kind: "breakfast",
        servings: 4,
        ingredients: [
          { id: "yoghurt", name: "Jogurtti", amount: 800, unit: "g" },
        ],
        instructions: "Valmista ja jaa annoksiin.",
      },
    },
    {
      pattern: /juustoleiv|cheese sandwiches/,
      recipe: {
        id: "fixture-sandwiches",
        name: "Juustoleivät",
        kind: "breakfast",
        servings: 4,
        ingredients: [
          { id: "bread", name: "Leipä", amount: 500, unit: "g" },
          { id: "cheese", name: "Juusto", amount: 200, unit: "g" },
        ],
        instructions: "Valmista ja jaa annoksiin.",
      },
    },
    {
      pattern: /uunimakkara|oven sausage/,
      recipe: {
        id: "fixture-oven-sausage",
        name: "Uunimakkara",
        servings: 4,
        kind: "meal",
        ingredients: [
          { id: "uunimakkara", name: "Uunimakkara", amount: 600, unit: "g" },
          { id: "cheese", name: "Juustoraaste", amount: 150, unit: "g" },
        ],
        instructions: "Viillä makkarat, täytä juustolla ja paista uunissa.",
      },
      side: mash,
    },
    {
      pattern: /poronkäristy|sauteed reindeer/,
      recipe: {
        id: "fixture-reindeer",
        name: "Poronkäristys",
        servings: 4,
        kind: "meal",
        ingredients: [
          { id: "reindeer", name: "Poronkäristys", amount: 500, unit: "g" },
          { id: "butter", name: "Voi", amount: 50, unit: "g" },
          { id: "lingonberry", name: "Puolukkasurvos", amount: 200, unit: "g" },
        ],
        instructions: "Ruskista käristysliha voissa ja hauduta kypsäksi.",
      },
      side: mash,
    },
    {
      pattern: /perunamuus|mashed potato/,
      recipe: {
        id: "fixture-mash",
        name: "Perunamuusi",
        servings: 4,
        kind: "meal",
        ingredients: structuredClone(mash.ingredients),
        instructions: "Keitä perunat, survo ja vatkaa joukkoon maito ja voi.",
      },
    },
    {
      // Before the plain soup pattern, so a named soup is not answered with another soup.
      pattern: /siskonmakkarakeitto/,
      recipe: {
        id: "fixture-siskonmakkara-soup",
        name: "Siskonmakkarakeitto",
        servings: 4,
        kind: "meal",
        ingredients: [
          {
            id: "siskonmakkara",
            name: "Siskonmakkara",
            amount: 400,
            unit: "g",
          },
          { id: "potato", name: "Peruna", amount: 600, unit: "g" },
          { id: "carrot", name: "Porkkana", amount: 200, unit: "g" },
          { id: "onion", name: "Sipuli", amount: 100, unit: "g" },
        ],
        instructions:
          "Keitä kasvikset pehmeiksi. Purista makkarasta pyöryköitä liemeen ja keitä kypsiksi.",
      },
    },
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
