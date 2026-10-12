import { storeKey } from "./changes";
import type { AppState, BasketLine } from "./model";

type HistoryEntry = AppState["listHistory"][number];

/** What a Repeat produced, bound to the revision it created. Counts and names, no prices invented. */
export type RepeatResult = {
  historyId: string;
  revision: number;
  /** When the repeated list was transferred. A transfer is not a purchase. */
  transferredAt: string;
  rows: number;
  /** Rows with no usable product or price at the selected store now. */
  unresolvedRows: number;
  /** The list was transferred at another store, so earlier prices are not comparable. */
  storeChanged: boolean;
  /** The entry was saved before recipes, the store or transferred products were kept. */
  partialHistory: boolean;
  /** Meals of the entry whose recipe exists neither in the entry nor among saved recipes. */
  missingRecipes: string[];
  /** Transferred products now quoted at another pack price, at the same store only. */
  changedPrices: { name: string; before: number; now: number }[];
  /** Transferred products that the fresh quote did not select again, at the same store only. */
  notSelected: string[];
};

/**
 * The plan fields a history entry restores. Recipes saved since then win over the entry's copies;
 * a meal whose recipe is gone is left out and reported, never replaced by a guess.
 */
export function repeatPlan(state: AppState, entry: HistoryEntry) {
  const recipes = [...state.recipes];
  for (const recipe of entry.recipes)
    if (!recipes.some((r) => r.id === recipe.id))
      recipes.push(structuredClone(recipe));
  const missingRecipes = [
    ...new Set(
      entry.meals
        .filter((meal) => !recipes.some((r) => r.id === meal.recipeId))
        .map((meal) => meal.recipeId),
    ),
  ];
  return {
    missingRecipes,
    state: {
      recipes,
      meals: entry.meals
        .filter((meal) => recipes.some((r) => r.id === meal.recipeId))
        .map((meal) => ({ ...meal, id: crypto.randomUUID() })),
      extras: structuredClone(entry.extras),
      skipped: [...entry.skipped],
      removed: [...entry.removed],
      quantities: { ...entry.quantities },
      note: entry.note,
      assumptions: "",
    },
  };
}

export function repeatResult(
  next: AppState,
  entry: HistoryEntry,
  plan: ReturnType<typeof repeatPlan>,
  basket: BasketLine[],
): RepeatResult {
  const sameStore = entry.storeKey === storeKey(next.context);
  const selected = new Map(
    basket.flatMap((line) =>
      line.product ? [[line.product.id, line.product] as const] : [],
    ),
  );
  return {
    historyId: entry.id,
    revision: next.revision,
    transferredAt: entry.date,
    rows: basket.length,
    unresolvedRows: basket.filter((l) => !l.product || l.total === null).length,
    storeChanged: !sameStore,
    partialHistory:
      !entry.storeKey ||
      (entry.meals.length > 0 && entry.recipes.length === 0) ||
      entry.transferred.length === 0,
    missingRecipes: plan.missingRecipes,
    changedPrices: sameStore
      ? entry.transferred.flatMap((item) => {
          const product = selected.get(item.productId);
          return product &&
            product.price !== null &&
            item.price > 0 &&
            product.price !== item.price
            ? [{ name: item.name, before: item.price, now: product.price }]
            : [];
        })
      : [],
    notSelected: sameStore
      ? entry.transferred
          .filter((item) => item.quantity > 0 && !selected.has(item.productId))
          .map((item) => item.name)
      : [],
  };
}
