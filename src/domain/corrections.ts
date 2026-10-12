import { z } from "zod";
import { categoryPreferenceSchema } from "./preferences";
import type { AppState, Requirement, StoreContext } from "./model";

export const correctionReasonSchema = z.enum([
  "wrong-product-type",
  "wrong-quantity",
  "unsuitable-alternative",
]);
const binding = {
  revision: z.number().int().nonnegative(),
  requirementKey: z.string().min(1).max(110),
};
const replacement = {
  ...binding,
  replacementProductId: z.string().min(1).max(100).nullable(),
  remember: categoryPreferenceSchema.optional(),
};
export const correctRowSchema = z
  .discriminatedUnion("reason", [
    z
      .object({ ...replacement, reason: z.literal("wrong-product-type") })
      .strict(),
    z
      .object({ ...replacement, reason: z.literal("unsuitable-alternative") })
      .strict(),
    z
      .object({
        ...binding,
        reason: z.literal("wrong-quantity"),
        amount: z.number().int().positive().max(10_000_000),
      })
      .strict(),
  ])
  .refine(
    (input) =>
      input.reason === "wrong-quantity" ||
      !input.remember ||
      input.replacementProductId !== null,
  );
export type CorrectRow = z.infer<typeof correctRowSchema>;
export const correctionHoldsSchema = z
  .array(z.string().min(1).max(400))
  .max(1000)
  .refine((keys) => new Set(keys).size === keys.length);
export function correctionKey(
  context: StoreContext,
  requirement: Pick<Requirement, "id" | "unit">,
) {
  return `${context.providerId}:${context.storeId}:${requirement.id}:${requirement.unit}`;
}
/** A new list drops correction choices; explicit category memory remains. */
export function clearRowCorrections(state: AppState) {
  return {
    specifications: {},
    correctionHolds: [],
    correctionChoices: [],
    accepted: Object.fromEntries(
      Object.entries(state.accepted).filter(
        ([key]) => !state.correctionChoices.includes(key),
      ),
    ),
  };
}
