import type { AppState, BasketLine, Product, Requirement } from "./model";
import { classificationKey } from "./categories";
import { pieceOrderingSchema } from "./product-evidence";

/** Order whole pieces from an explicit average weight; final weight remains estimated. */
export function pieceQuote(
  requirement: Requirement,
  product: Product,
): { pieces: number; total: number; weightGrams: number } | null {
  const ordering = pieceOrderingSchema.safeParse(product.pieceOrdering);
  const source = product.cataloguePricing;
  if (
    !ordering.success ||
    !source ||
    product.available !== true ||
    product.nativeUnit !== "kpl" ||
    product.increment !== 1 ||
    source.unit?.toLowerCase() !== "kpl" ||
    ![null, "per_item"].includes(source.basis) ||
    source.approximate !== true ||
    source.amount === null ||
    !Number.isSafeInteger(source.amount) ||
    source.amount < 0 ||
    product.deposit !== 0 ||
    (source.deposit !== null && source.deposit !== 0) ||
    !Number.isSafeInteger(requirement.amount) ||
    requirement.amount <= 0 ||
    !["g", "pcs"].includes(requirement.unit)
  )
    return null;
  const pieces =
    requirement.unit === "pcs"
      ? requirement.amount
      : Math.ceil(requirement.amount / ordering.data.estimatedWeightGrams);
  const total = pieces * source.amount;
  const maximum = ["s-kaupat", "demo-s"].includes(product.providerId)
    ? 99
    : 100;
  if (
    !Number.isSafeInteger(pieces) ||
    pieces <= 0 ||
    pieces > maximum ||
    !Number.isSafeInteger(total)
  )
    return null;
  return {
    pieces,
    total,
    weightGrams: pieces * ordering.data.estimatedWeightGrams,
  };
}

export function transferableLine(line: BasketLine): boolean {
  if (!line.product || line.total === null) return false;
  if (!line.approximate) {
    const p = line.product;
    if (
      p.pieceOrdering ||
      p.available !== true ||
      p.price === null ||
      !Number.isSafeInteger(p.price) ||
      p.price < 0 ||
      !Number.isSafeInteger(p.deposit) ||
      p.deposit < 0 ||
      p.unit !== line.requirement.unit ||
      p.packAmount <= 0 ||
      p.increment <= 0
    )
      return false;
    const packs =
      Math.ceil(line.requirement.amount / p.packAmount / p.increment) *
      p.increment;
    return (
      Number.isFinite(packs) &&
      packs > 0 &&
      line.packs === packs &&
      line.total === packs * (p.price + p.deposit)
    );
  }
  const quote = pieceQuote(line.requirement, line.product);
  return (
    quote !== null && quote.pieces === line.packs && quote.total === line.total
  );
}
export function requirements(
  state: AppState,
  now = new Date(),
  includeHome = false,
): Requirement[] {
  const result = new Map<string, Requirement>();
  const add = (item: Requirement) => {
    const key = `${item.id}:${item.unit}`;
    if (
      (!includeHome && state.skipped.includes(key)) ||
      state.removed.includes(key)
    )
      return;
    const previous = result.get(key);
    if (previous) {
      if (
        classificationKey(previous.classification) !==
        classificationKey(item.classification)
      )
        throw new Error("conflictingRequirement");
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
  for (const item of state.extras) add({ ...item, sources: ["extra"] });
  return [...result.values()].map((item) => ({
    ...item,
    amount: state.quantities[`${item.id}:${item.unit}`] ?? item.amount,
  }));
}
/** Comma- or line-separated words such as "sianliha, pähkinä". */
export function exclusionTerms(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((t) => t.trim().toLocaleLowerCase("fi"))
    .filter((t) => t.length >= 3);
}
const words = (text: string) =>
  text
    .toLocaleLowerCase("fi")
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
/**
 * Whether a product is the ingredient itself rather than a compound or ready meal
 * that merely contains its name. Finnish compounds put the head word last, so
 * "valkosipuli" is not "sipuli" and "jauhelihamauste" is not "jauheliha". Each
 * word of the ingredient must begin a word of the product name, allowing only a
 * short inflection ending such as "kananmunat" or "sipulit".
 */
// Variants a shopper would name explicitly; never chosen for a plain ingredient.
const variants = [
  "kana",
  "kanan",
  "broileri",
  "broilerin",
  "kalkkuna",
  "kalkkunan",
  "kasvis",
  "herne",
  "soija",
  "nyhtökaura",
];
export function relevant(productName: string, ingredientName: string) {
  const split = words(productName);
  // Stores also write compounds apart: "kanan munat" for "kananmunat".
  const name = [...split, ...split.slice(1).map((w, i) => split[i] + w)];
  const wanted = words(ingredientName);
  if (
    split.some((w) => variants.includes(w) && !wanted.includes(w)) &&
    !wanted.some((w) => variants.some((v) => w.startsWith(v)))
  )
    return false;
  return (
    wanted.length > 0 &&
    wanted.every((w) =>
      name.some((n) => {
        if (n.startsWith(w)) return n.length - w.length <= 2;
        // Stem change before an ending: kananmuna → kananmunia.
        const stem = w.slice(0, -1);
        return (
          w.length >= 5 && n.startsWith(stem) && n.length - stem.length <= 3
        );
      }),
    )
  );
}
/** Estimate from an explicit source kg/l basis, never from a pack label or comparison price. */
export function approximateCost(
  requirement: Requirement,
  product: Product,
): number | null {
  const piece = pieceQuote(requirement, product);
  if (piece) return piece.total;
  const source = product.cataloguePricing;
  const unit = source?.unit?.toLowerCase();
  if (
    !source ||
    product.available !== true ||
    product.deposit !== 0 ||
    (source.deposit !== null && source.deposit !== 0) ||
    !Number.isSafeInteger(source.amount) ||
    source.amount === null ||
    source.amount < 0 ||
    !Number.isSafeInteger(requirement.amount) ||
    requirement.amount <= 0 ||
    !(
      (unit === "kg" &&
        requirement.unit === "g" &&
        (source.basis === null || source.basis === "per_weight")) ||
      (unit === "l" &&
        requirement.unit === "ml" &&
        (source.basis === null || source.basis === "per_volume"))
    ) ||
    (product.packAmount > 0 && product.unit !== requirement.unit)
  )
    return null;
  const numerator = source.amount * requirement.amount;
  if (!Number.isSafeInteger(numerator)) return null;
  return Math.round(numerator / 1000);
}

export function priceBreakdown(lines: BasketLine[]) {
  return lines.reduce(
    (sum, line) => {
      if (!line.product || line.total === null) sum.unknown++;
      else if (line.approximate) sum.approximate += line.total;
      else sum.exact += line.total;
      return sum;
    },
    { exact: 0, approximate: 0, unknown: 0 },
  );
}

export function match(
  requirement: Requirement,
  products: Product[],
  accepted: string[],
  exclusions: string[] = [],
): BasketLine {
  const matching = products.filter(
    (p) =>
      p.ingredientId === requirement.id &&
      // A product without a readable pack size stays listed so the shopper can confirm it.
      (p.unit === requirement.unit ||
        p.packAmount === 0 ||
        approximateCost(requirement, p) !== null),
  );
  // A hard requirement: excluded products never reach ranking or acceptance.
  const candidates = matching.filter(
    (p) =>
      !exclusions.some((term) => p.name.toLocaleLowerCase("fi").includes(term)),
  );
  // Products that are the ingredient itself come first among the alternatives.
  candidates.sort(
    (a, b) =>
      Number(relevant(b.name, requirement.name)) -
      Number(relevant(a.name, requirement.name)),
  );
  const eligible = candidates.filter(
    (p) =>
      accepted.includes(p.id) &&
      p.available === true &&
      (approximateCost(requirement, p) !== null ||
        (p.price !== null && p.packAmount > 0 && p.increment > 0)),
  );
  const cost = (p: Product) =>
    approximateCost(requirement, p) ??
    Math.ceil(requirement.amount / p.packAmount / p.increment) *
      p.increment *
      (p.price! + p.deposit);
  const surplus = (p: Product) =>
    approximateCost(requirement, p) !== null
      ? 0
      : Math.ceil(requirement.amount / p.packAmount / p.increment) *
          p.increment *
          p.packAmount -
        requirement.amount;
  eligible.sort(
    (a, b) =>
      cost(a) - cost(b) || surplus(a) - surplus(b) || a.id.localeCompare(b.id),
  );
  const product = eligible[0] ?? null;
  const approximate =
    product !== null && approximateCost(requirement, product) !== null;
  const packs =
    product && approximate
      ? (pieceQuote(requirement, product)?.pieces ?? 0)
      : product
        ? Math.ceil(
            requirement.amount / product.packAmount / product.increment,
          ) * product.increment
        : 0;
  return {
    requirement,
    ...(approximate ? { approximate: true } : {}),
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

/** Fills in the pack size the shopper confirmed for products whose label could not be read. */
export function applyPackSizes(
  products: Product[],
  sizes: AppState["packSizes"],
): Product[] {
  return products.map((p) => {
    const size = sizes[p.id];
    return !p.pieceOrdering && !p.packAmount && size
      ? { ...p, packAmount: size.amount, unit: size.unit }
      : p;
  });
}
