import { z } from "zod";
import { priceBasisSchema } from "../domain/price-ranking";
import { packageContentSchema } from "../domain/package-content";
import {
  contextSchema,
  ingredientSchema,
  unitSchema,
  type AppState,
} from "../domain/model";
import {
  requirements,
  exclusionTerms,
  applyPackSizes,
} from "../domain/planner";
import { matchingSummarySchema, matchRequirement } from "../domain/matching";
import {
  cataloguePricingSchema,
  productEvidenceSchema,
  pieceOrderingSchema,
} from "../domain/product-evidence";

/** The price setting is intentionally absent: saved rows retain their own selection basis. */
export function pricingKey(state: AppState): string {
  return JSON.stringify({
    matchingVersion: 2,
    context: state.context,
    requirements: requirements(state).map(
      ({ id, name, amount, unit, sources, classification }) => ({
        id,
        name,
        amount,
        unit,
        sources,
        classification,
      }),
    ),
    accepted: state.accepted,
    exclusions: state.household.exclusions,
    preference: state.productPreference,
    categoryPreferences: state.categoryPreferences,
    ...(state.correctionHolds.length
      ? { correctionHolds: state.correctionHolds }
      : {}),
    ...(state.correctionChoices.length
      ? { correctionChoices: state.correctionChoices }
      : {}),
    ...(state.requestIntents.length
      ? { requestIntents: state.requestIntents }
      : {}),
    ...(Object.keys(state.packSizes).length
      ? { packSizes: state.packSizes }
      : {}),
  });
}

const productSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  storeId: z.string(),
  name: z.string(),
  ingredientId: z.string(),
  packAmount: z.number().nonnegative(),
  unit: unitSchema,
  price: z.number().int().nonnegative().nullable(),
  available: z.boolean().nullable(),
  deposit: z.number().int().nonnegative(),
  nativeUnit: z.string(),
  increment: z.number().nonnegative(),
  observedAt: z.string(),
  evidence: productEvidenceSchema.optional(),
  cataloguePricing: cataloguePricingSchema.optional(),
  pieceOrdering: pieceOrderingSchema.optional(),
  packageContent: packageContentSchema.optional(),
});
export const persistedQuoteSchema = z.object({
  operationId: z.uuid().optional(),
  key: z.string(),
  context: contextSchema,
  quotedAt: z.iso.datetime(),
  pickupFee: z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    })
    .nullable(),
  basket: z.array(
    z.object({
      priceBasis: priceBasisSchema.optional(),
      requirement: ingredientSchema.extend({ sources: z.array(z.string()) }),
      product: productSchema.nullable(),
      packs: z.number().nonnegative(),
      total: z.number().nonnegative().nullable(),
      approximate: z.boolean().optional(),
      candidates: z.array(productSchema),
      excluded: z.number().int().nonnegative().optional(),
      matching: matchingSummarySchema.optional(),
    }),
  ),
});

export function restoredQuote(input: unknown, state: AppState) {
  const parsed = persistedQuoteSchema.safeParse(input);
  if (!parsed.success || parsed.data.key !== pricingKey(state)) return null;
  const quote = parsed.data;
  if (JSON.stringify(quote.context) !== JSON.stringify(state.context))
    return null;
  const wanted = requirements(state);
  if (
    quote.basket.length !== wanted.length ||
    quote.basket.some((line, index) => {
      const requirement = wanted[index];
      return (
        line.requirement.id !== requirement.id ||
        line.requirement.amount !== requirement.amount ||
        line.requirement.unit !== requirement.unit ||
        [line.product, ...line.candidates].some(
          (product) =>
            product &&
            (product.providerId !== state.context.providerId ||
              product.storeId !== state.context.storeId),
        )
      );
    })
  )
    return null;
  // Recompute selection and arithmetic; persisted product/cost claims alone are insufficient.
  const local = quote.basket.map((line, index) => {
    const requirement = wanted[index];
    const matched = matchRequirement(
      requirement,
      applyPackSizes(line.candidates, state.packSizes),
      {
        context: state.context,
        sourceNote: state.note,
        preferences: state.categoryPreferences,
        holds: state.correctionHolds,
        exclusions: exclusionTerms(state.household.exclusions),
        productPreference: state.productPreference,
        priceBasis: line.priceBasis ?? "total",
        accepted:
          state.accepted[
            `${state.context.providerId}:${state.context.storeId}:${requirement.id}`
          ] ?? [],
      },
    );
    if (line.matching?.reason === "bounded-out") {
      if (
        line.candidates.length ||
        line.product ||
        line.total !== null ||
        line.packs !== 0
      )
        return null;
      matched.matching!.reason = "bounded-out";
    }
    if (
      Boolean(line.approximate) !== Boolean(matched.approximate) ||
      line.product?.id !== matched.product?.id ||
      ((line.product?.pieceOrdering || matched.product?.pieceOrdering) &&
        (JSON.stringify(line.product?.pieceOrdering) !==
          JSON.stringify(matched.product?.pieceOrdering) ||
          JSON.stringify(line.product?.cataloguePricing) !==
            JSON.stringify(matched.product?.cataloguePricing))) ||
      line.packs !== matched.packs ||
      line.total !== matched.total
    )
      return null;
    // Fixed rejection explanations may describe candidates pruned by matching.
    // They cannot authorize selection; retained products and arithmetic were recomputed above.
    if (line.matching && matched.matching) {
      const decisions = new Map(
        matched.matching.decisions.map((decision) => [decision.id, decision]),
      );
      const seen = new Set<string>();
      matched.matching.decisions = line.matching.decisions.flatMap(
        (decision) => {
          const verified = decisions.get(decision.id);
          if (
            seen.has(decision.id) ||
            (!verified && decision.status !== "rejected")
          )
            return [];
          seen.add(decision.id);
          return [verified ?? decision];
        },
      );
      for (const decision of decisions.values())
        if (!seen.has(decision.id)) matched.matching.decisions.push(decision);
      // A pruned rejection still explains an unresolved cached row after restart.
      // This restores display metadata only, after selection/cost revalidation.
      if (
        !matched.product &&
        matched.matching.reason === "empty-search" &&
        line.matching.status === "unresolved" &&
        matched.matching.decisions.some(
          (decision) =>
            decision.status === "rejected" &&
            decision.reason === line.matching!.reason,
        )
      )
        matched.matching.reason = line.matching.reason;
      if (!matchingSummarySchema.safeParse(matched.matching).success)
        return null;
    }
    return matched;
  });
  if (local.some((line) => line === null)) return null;
  // Reattach current requirements, including recurring-item metadata.
  quote.basket = quote.basket.map((line, index) => ({
    ...local[index]!,
    requirement: wanted[index],
  }));
  return quote;
}
