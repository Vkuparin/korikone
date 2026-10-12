import type { Product, Requirement } from "./model";
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
