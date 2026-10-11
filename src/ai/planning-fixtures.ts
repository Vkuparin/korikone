import { initialState, type Recipe } from "../domain/model";
import {
  noteQuantity,
  noteUnspecifiedCount,
  type RequestIntent,
} from "../domain/intents";
import { mealFixtures } from "./meal-fixtures";
import type { MealDraft } from "./draft";

/** Finite synthetic planning responses. No fuzzy fallback meal and no default grocery quantities. */
export function planningFixtureReply(
  note: string,
  servings: number,
): MealDraft & { intents: RequestIntent[] } {
  const draft: MealDraft & { intents: RequestIntent[] } = {
    recipes: [],
    meals: [],
    items: [],
    notes: "Development mode: local planning fixture.",
    intents: [],
  };
  const ranges: { start: number; end: number }[] = [];
  let position = 0;
  for (const separator of note.matchAll(
    /(?<!\d),(?!\d)\s*|\s+(?:ja|and)\s+|\s*\+\s*|[;\n]+/gi,
  )) {
    ranges.push({ start: position, end: separator.index });
    position = separator.index + separator[0].length;
  }
  ranges.push({ start: position, end: note.length });
  const defaults = initialState().recipes;
  const recipes: { pattern: RegExp; recipe: Recipe }[] = [
    ...mealFixtures,
    {
      pattern: /pasta/i,
      recipe: defaults.find((recipe) => recipe.id === "pasta")!,
    },
    {
      pattern: /keitto|soup/i,
      recipe: defaults.find((recipe) => recipe.id === "soup")!,
    },
    {
      pattern: /puuro|porridge/i,
      recipe: defaults.find((recipe) => recipe.id === "porridge")!,
    },
  ];
  const groceries: [RegExp, string][] = [
    [/maito|milk/i, "Maito"],
    [/kahvi|coffee/i, "Kahvi"],
    [/kananmuna|eggs?/i, "Kananmuna"],
    [/jauheliha|mince/i, "Jauheliha"],
    [/sipuli|onions?/i, "Sipuli"],
    [/riisi|rice/i, "Riisi"],
    [/kerma|cream/i, "Kerma"],
    [/omena|apples?/i, "Omena"],
    [/banaan|bananas?/i, "Banaani"],
    [/leip|bread/i, "Leipä"],
    [/pakastepizza|frozen pizza/i, "Pakastepizza"],
  ];
  for (const range of ranges) {
    const raw = note.slice(range.start, range.end);
    const quote = raw.trim();
    if (!quote) continue;
    const start = range.start + raw.indexOf(quote),
      end = start + quote.length;
    const measuredBanana =
      /^\d+(?:[.,]\d+)?\s*(?:kg|g)\s+(?:banaan\p{L}*|bananas?)$/iu.test(quote);
    const recipe = measuredBanana
      ? undefined
      : recipes.find((fixture) => fixture.pattern.test(quote))?.recipe;
    const intent: RequestIntent = {
      id: `fixture-${start}`,
      kind: recipe ? "meal" : "grocery",
      label: quote,
      evidence: { start, end, quote },
      provenance: "explicit-note",
      quantity: null,
      mealIndex: null,
      itemIndex: null,
      unresolvedReason: null,
    };
    if (recipe) {
      if (!draft.recipes.some((saved) => saved.id === recipe.id))
        draft.recipes.push(structuredClone(recipe));
      intent.mealIndex = draft.meals.length;
      draft.meals.push({
        recipeId: recipe.id,
        day: Math.min(draft.meals.length, 6),
        servings,
        leftovers: false,
      });
    } else {
      const name = groceries.find(([pattern]) => pattern.test(quote))?.[1];
      const quantity = noteQuantity(quote);
      const count = noteUnspecifiedCount(quote);
      intent.quantity = quantity
        ? { ...quantity, provenance: "explicit-note" }
        : count !== null
          ? {
              amount: count,
              unit: null,
              provenance: "explicit-note",
            }
          : { amount: null, unit: null, provenance: "unknown" };
      if (!name) intent.unresolvedReason = "unsupported-request";
      else if (quantity && !Number.isInteger(quantity.amount))
        intent.unresolvedReason = "unsupported-quantity";
      else if (!quantity)
        intent.unresolvedReason =
          intent.quantity.amount === null ? "unknown-quantity" : "unknown-unit";
      else {
        intent.itemIndex = draft.items.length;
        draft.items.push({ id: `fixture-item-${start}`, name, ...quantity });
      }
    }
    draft.intents.push(intent);
  }
  return draft;
}
