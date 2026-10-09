import { z } from "zod";
import {
  contextSchema,
  ingredientSchema,
  unitSchema,
  type AppState,
} from "../domain/model";
import { requirements } from "../domain/planner";

/** Only inputs that affect catalogue matching belong in a quote's binding. */
export function pricingKey(state: AppState): string {
  return JSON.stringify({
    context: state.context,
    requirements: requirements(state).map(
      ({ id, name, amount, unit, sources }) => ({
        id,
        name,
        amount,
        unit,
        sources,
      }),
    ),
    accepted: state.accepted,
    exclusions: state.household.exclusions,
    preference: state.productPreference,
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
});
export const persistedQuoteSchema = z.object({
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
      requirement: ingredientSchema.extend({ sources: z.array(z.string()) }),
      product: productSchema.nullable(),
      packs: z.number().nonnegative(),
      total: z.number().nonnegative().nullable(),
      candidates: z.array(productSchema),
      excluded: z.number().int().nonnegative().optional(),
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
  // Reattach the current requirements, including recurring-item metadata.
  quote.basket = quote.basket.map((line, index) => ({
    ...line,
    requirement: wanted[index],
  }));
  return quote;
}
