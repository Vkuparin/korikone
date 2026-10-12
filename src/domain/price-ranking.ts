import { z } from "zod";
import { packageAmount } from "./package-content";
import type { Product, Requirement } from "./model";
import { approximateCost, pieceQuote } from "./product-price";

export const priceBasisSchema = z.enum(["unit", "total"]);
export type PriceBasis = z.infer<typeof priceBasisSchema>;
/** Exact ratio in cents per kg/l/individual piece; deposits never buy product content. */
export type UnitValue = {
  numerator: number;
  denominator: number;
  unit: "kg" | "l" | "pcs";
  estimated: boolean;
};
export type PriceMetrics = {
  unitValue: UnitValue | null;
  packs: number;
  payable: number;
  surplus: number;
  estimated: boolean;
  fallback: "unknown-unit" | null;
};
function ratio(
  price: number,
  amount: number,
  unit: Requirement["unit"],
  estimated: boolean,
): UnitValue | null {
  // Preserve fractional source content rather than using a rounded display ratio.
  const denominator = amount * 1_000_000;
  const numerator = price * (unit === "pcs" ? 1 : 1000) * 1_000_000;
  if (
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    !Number.isSafeInteger(numerator)
  )
    return null;
  return {
    numerator,
    denominator,
    unit: unit === "g" ? "kg" : unit === "ml" ? "l" : "pcs",
    estimated,
  };
}
/** Local arithmetic only. Optional campaign/personal claims never override the quoted source price. */
export function priceMetrics(
  requirement: Requirement,
  product: Product,
): PriceMetrics | null {
  if (
    product.available !== true ||
    !Number.isSafeInteger(requirement.amount) ||
    requirement.amount <= 0
  )
    return null;
  const piece = pieceQuote(requirement, product);
  if (piece) {
    const amount =
      requirement.unit === "pcs"
        ? 1
        : product.pieceOrdering!.estimatedWeightGrams;
    const unitValue = ratio(
      product.cataloguePricing!.amount!,
      amount,
      requirement.unit,
      true,
    );
    return {
      unitValue,
      packs: piece.pieces,
      payable: piece.total,
      surplus:
        requirement.unit === "pcs" ? 0 : piece.weightGrams - requirement.amount,
      estimated: true,
      fallback: unitValue ? null : "unknown-unit",
    };
  }
  const estimate = approximateCost(requirement, product);
  if (estimate !== null) {
    const unitValue = ratio(
      product.cataloguePricing!.amount!,
      1000,
      requirement.unit,
      true,
    );
    return {
      unitValue,
      packs: 0,
      payable: estimate,
      surplus: 0,
      estimated: true,
      fallback: unitValue ? null : "unknown-unit",
    };
  }
  const content = packageAmount(product, requirement.unit);
  if (
    product.pieceOrdering ||
    content === null ||
    !Number.isSafeInteger(product.price) ||
    product.price === null ||
    product.price < 0 ||
    !Number.isSafeInteger(product.deposit) ||
    product.deposit < 0 ||
    !Number.isFinite(product.packAmount) ||
    product.packAmount <= 0 ||
    !Number.isFinite(product.increment) ||
    product.increment <= 0
  )
    return null;
  const source = product.cataloguePricing;
  if (
    (requirement.unit === "pcs" && !Number.isSafeInteger(content)) ||
    (["kpl", "pcs"].includes(product.nativeUnit.toLowerCase()) &&
      !Number.isSafeInteger(product.increment))
  )
    return null;
  if (
    source &&
    ((source.deposit !== null && source.deposit !== product.deposit) ||
      (source.amount !== null && source.amount !== product.price))
  )
    return null;
  const packs =
    Math.ceil(requirement.amount / content! / product.increment) *
    product.increment;
  const payable = packs * (product.price + product.deposit);
  const surplus = packs * content! - requirement.amount;
  if (
    !Number.isFinite(packs) ||
    packs <= 0 ||
    !Number.isSafeInteger(payable) ||
    !Number.isFinite(surplus) ||
    surplus < 0
  )
    return null;
  const unitValue = ratio(product.price, content!, requirement.unit, false);
  return {
    unitValue,
    packs,
    payable,
    surplus,
    estimated: false,
    fallback: unitValue ? null : "unknown-unit",
  };
}
const identityOrder = (a: Product, b: Product) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export function compareUnitValues(a: UnitValue, b: UnitValue): number | null {
  if (a.unit !== b.unit) return null;
  const delta =
    BigInt(a.numerator) * BigInt(b.denominator) -
    BigInt(b.numerator) * BigInt(a.denominator);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
/** Eligibility and explicit/brand preferences must be applied before automatic price ranking. */
export function compareProductPrices(
  requirement: Requirement,
  a: Product,
  b: Product,
  basis: PriceBasis,
): number {
  const left = priceMetrics(requirement, a),
    right = priceMetrics(requirement, b);
  if (!left || !right) return left ? -1 : right ? 1 : identityOrder(a, b);
  if (basis === "unit") {
    if (!left.unitValue || !right.unitValue) {
      if (Boolean(left.unitValue) !== Boolean(right.unitValue))
        return left.unitValue ? -1 : 1;
    } else {
      const comparison = compareUnitValues(left.unitValue, right.unitValue);
      if (comparison !== null && comparison !== 0) return comparison;
    }
  }
  return (
    left.payable - right.payable ||
    left.surplus - right.surplus ||
    identityOrder(a, b)
  );
}
export function rankProductPrices(
  requirement: Requirement,
  products: readonly Product[],
  basis: PriceBasis,
): Product[] {
  return [...products].sort((a, b) =>
    compareProductPrices(requirement, a, b, basis),
  );
}
/** A lower unit value may have a higher payable price. Never label that as checkout savings. */
export function comparePriceAlternative(
  requirement: Requirement,
  selected: Product,
  proposed: Product,
  basis: PriceBasis,
) {
  const current = priceMetrics(requirement, selected),
    alternative = priceMetrics(requirement, proposed);
  if (!current || !alternative) return null;
  const unitComparison =
    current.unitValue && alternative.unitValue
      ? compareUnitValues(alternative.unitValue, current.unitValue)
      : null;
  const payableDelta = alternative.payable - current.payable;
  const unknownFallback = !current.unitValue && !alternative.unitValue;
  const improves =
    basis === "total"
      ? payableDelta < 0
      : unitComparison === -1 ||
        ((unitComparison === 0 || unknownFallback) && payableDelta < 0);
  const benefit = unknownFallback
    ? ("unknown-unit" as const)
    : unitComparison === -1 && payableDelta >= 0
      ? ("lower-unit" as const)
      : payableDelta < 0
        ? ("lower-total" as const)
        : null;
  return {
    current,
    alternative,
    unitComparison,
    payableDelta,
    improves,
    benefit,
  };
}
