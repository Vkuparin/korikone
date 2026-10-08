import type { AppState, BasketLine, Product, Requirement } from "./model";
export function requirements(state: AppState, now = new Date()): Requirement[] {
  const result = new Map<string, Requirement>();
  const add = (item: Requirement) => {
    const key = `${item.id}:${item.unit}`;
    if (state.skipped.includes(key)) return;
    const previous = result.get(key);
    if (previous) {
      previous.amount += item.amount;
      previous.sources.push(...item.sources);
    } else result.set(key, { ...item, sources: [...item.sources] });
  };
  for (const meal of state.meals) {
    if (meal.leftovers) continue;
    const recipe = state.recipes.find((r) => r.id === meal.recipeId);
    if (!recipe) throw new Error("missingRecipe");
    for (const item of recipe.ingredients)
      add({
        ...item,
        amount: Math.ceil((item.amount * meal.servings) / recipe.servings),
        sources: [recipe.name],
      });
  }
  for (const staple of state.staples) {
    const due =
      !staple.lastPurchased ||
      now.getTime() - new Date(staple.lastPurchased).getTime() >=
        staple.everyDays * 86400000;
    if (staple.enabled && due) add({ ...staple, sources: ["staple"] });
  }
  return [...result.values()];
}
/** Comma- or line-separated words such as "sianliha, pähkinä". */
export function exclusionTerms(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((t) => t.trim().toLocaleLowerCase("fi"))
    .filter((t) => t.length >= 3);
}
export function match(
  requirement: Requirement,
  products: Product[],
  accepted: string[],
  exclusions: string[] = [],
): BasketLine {
  const matching = products.filter(
    (p) => p.ingredientId === requirement.id && p.unit === requirement.unit,
  );
  // A hard requirement: excluded products never reach ranking or acceptance.
  const candidates = matching.filter(
    (p) =>
      !exclusions.some((term) => p.name.toLocaleLowerCase("fi").includes(term)),
  );
  const eligible = candidates.filter(
    (p) =>
      accepted.includes(p.id) &&
      p.available === true &&
      p.price !== null &&
      p.packAmount > 0 &&
      p.increment > 0,
  );
  const cost = (p: Product) =>
    Math.ceil(requirement.amount / p.packAmount / p.increment) *
    p.increment *
    (p.price! + p.deposit);
  eligible.sort(
    (a, b) =>
      cost(a) - cost(b) ||
      Math.ceil(requirement.amount / a.packAmount / a.increment) *
        a.increment *
        a.packAmount -
        Math.ceil(requirement.amount / b.packAmount / b.increment) *
          b.increment *
          b.packAmount ||
      a.id.localeCompare(b.id),
  );
  const product = eligible[0] ?? null;
  const packs = product
    ? Math.ceil(requirement.amount / product.packAmount / product.increment) *
      product.increment
    : 0;
  return {
    requirement,
    product,
    packs,
    total: product ? cost(product) : null,
    candidates,
    excluded: matching.length - candidates.length,
  };
}
export function shoppingList(state: AppState): string {
  return requirements(state)
    .map((r) => `${r.name}: ${r.amount} ${r.unit} (${r.sources.join(", ")})`)
    .join("\n");
}
