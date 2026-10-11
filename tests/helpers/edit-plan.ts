import { initialState, type AppState } from "../../src/domain/model";

export const editNow = new Date("2026-10-12T08:00:00Z");
/** Pasta and soup for four, porridge sharing milk with a manual carton, and two breads. */
export function editPlan(): AppState {
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
