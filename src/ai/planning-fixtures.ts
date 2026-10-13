import { initialState, type Unit } from "../domain/model";
import {
  noteQuantity,
  noteUnspecifiedCount,
  type RequestIntent,
} from "../domain/intents";
import { mealFixtures } from "./meal-fixtures";
import { merchandiseFixture } from "./merchandise-fixtures";
import { noSideRequested, type MealDraft } from "./draft";

/**
 * Finite synthetic planning responses. No fuzzy fallback meal. A dish named alone gets its scripted
 * side, and a known grocery named without an amount gets one ordinary purchase marked as assumed.
 */
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
    sides: [],
  };
  const noSide = noSideRequested(note);
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
  const recipes: (typeof mealFixtures)[number][] = [
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
    // An explicit variety keeps its own name; only the bare word is the generic grocery.
    [/kevytmaito/i, "Kevytmaito"],
    [/vaniljajäätelö|vanilla ice cream/i, "Vaniljajäätelö"],
    [/maito|milk/i, "Maito"],
    [/kahvi|coffee/i, "Kahvi"],
    [/kananmun(?:a|ia|at)|eggs?/i, "Kananmuna"],
    [/jauheliha|mince/i, "Jauheliha"],
    [/sipuli|onions?/i, "Sipuli"],
    [/riisi|rice/i, "Riisi"],
    [/kerma|cream/i, "Kerma"],
    [/omena|apples?/i, "Omena"],
    [/banaan|bananas?/i, "Banaani"],
    [/leip|bread/i, "Leipä"],
    [/pakastepizza|frozen pizza/i, "Pakastepizza"],
    [/voi(?:ta)?(?![\p{L}])|butter/iu, "Voi"],
    [/juusto|cheese/i, "Juusto"],
  ];
  // One ordinary purchase of a grocery the note names without an amount. Coffee has none here on
  // purpose: it stays the scripted example of a request the planner could not size.
  const usual: Record<string, { amount: number; unit: Unit }> = {
    Kevytmaito: { amount: 1000, unit: "ml" },
    Vaniljajäätelö: { amount: 1000, unit: "ml" },
    Maito: { amount: 1000, unit: "ml" },
    Kananmuna: { amount: 10, unit: "pcs" },
    Jauheliha: { amount: 400, unit: "g" },
    Sipuli: { amount: 500, unit: "g" },
    Riisi: { amount: 1000, unit: "g" },
    Kerma: { amount: 200, unit: "ml" },
    Omena: { amount: 1000, unit: "g" },
    Banaani: { amount: 1000, unit: "g" },
    Leipä: { amount: 500, unit: "g" },
    Voi: { amount: 500, unit: "g" },
    Juusto: { amount: 500, unit: "g" },
  };
  for (const range of ranges) {
    const raw = note.slice(range.start, range.end);
    const quote = raw.trim();
    if (!quote) continue;
    const start = range.start + raw.indexOf(quote),
      end = start + quote.length;
    const measuredBanana =
      /^\d+(?:[.,]\d+)?\s*(?:kg|g)\s+(?:banaan\p{L}*|bananas?)$/iu.test(quote);
    const fixture = measuredBanana
      ? undefined
      : recipes.find((entry) => entry.pattern.test(quote.toLowerCase()));
    // A dish named alone gets its side, unless the note names that side or declines one.
    const side =
      fixture?.side &&
      !noSide &&
      !ranges.some(
        (other) =>
          other !== range &&
          fixture.side!.pattern.test(
            note.slice(other.start, other.end).toLowerCase(),
          ),
      )
        ? fixture.side
        : undefined;
    const recipe = fixture && structuredClone(fixture.recipe);
    if (recipe && side) {
      recipe.id = `${recipe.id}-with-side`;
      for (const extra of side.ingredients) {
        const same = recipe.ingredients.find(
          (i) => i.id === extra.id && i.unit === extra.unit,
        );
        if (same) same.amount += extra.amount;
        else recipe.ingredients.push(structuredClone(extra));
      }
    }
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
      if (side && !draft.sides!.some((s) => s.mealIndex === intent.mealIndex))
        draft.sides!.push({ mealIndex: intent.mealIndex, name: side.name });
      draft.meals.push({
        recipeId: recipe.id,
        day: Math.min(draft.meals.length, 6),
        servings,
        leftovers: false,
      });
    } else if (merchandiseFixture(quote)) {
      // A non-food request: one piece unless a count in pieces is written.
      const found = merchandiseFixture(quote)!;
      const stated = noteQuantity(quote);
      const pieces =
        stated?.unit === "pcs" && Number.isInteger(stated.amount)
          ? stated.amount
          : 1;
      intent.quantity = {
        amount: pieces,
        unit: "pcs",
        provenance: stated?.unit === "pcs" ? "explicit-note" : "assumed",
      };
      intent.itemIndex = draft.items.length;
      draft.items.push({
        id: `fixture-item-${start}`,
        name: found.name,
        amount: pieces,
        unit: "pcs",
        merchandise: found.merchandise,
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
      else if (!quantity && count === null && usual[name]) {
        // No amount in the note: one ordinary purchase, marked as an assumption.
        intent.quantity = { ...usual[name], provenance: "assumed" };
        intent.itemIndex = draft.items.length;
        draft.items.push({ id: `fixture-item-${start}`, name, ...usual[name] });
      } else if (!quantity)
        intent.unresolvedReason =
          intent.quantity.amount === null ? "unknown-quantity" : "unknown-unit";
      else {
        intent.itemIndex = draft.items.length;
        draft.items.push({ id: `fixture-item-${start}`, name, ...quantity });
        if (/^500 g suodatinjauhettua kahvia$/i.test(quote)) {
          draft.items.at(-1)!.classification = {
            category: "coffee",
            provenance: "explicit-note",
            evidence: { start, end, quote },
            qualifiers: [
              {
                kind: "coffee",
                value: "ground",
                provenance: "explicit-note",
                evidence: { start, end, quote },
              },
            ],
          };
        }
      }
    }
    draft.intents.push(intent);
  }
  return draft;
}
