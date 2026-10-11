import { z } from "zod";
import {
  categorySchema,
  classificationSchema,
  qualifierSchema,
  qualifierValues,
} from "./categories";

export const productFamilySchema = z.enum([
  "plain-milk",
  "plant-drink",
  "flavoured-milk",
  "bread",
  "crispbread",
  "tortilla",
  "sweet-bread",
  "hen-egg",
  "other-egg",
  "egg-product",
  "meat-mince",
  "plant-mince",
  "onion",
  "garlic",
  "dry-rice",
  "prepared-rice",
  "dairy-cream",
  "plant-cream",
  "ground-coffee",
  "coffee-beans",
  "instant-coffee",
  "coffee-capsule",
  "coffee-drink",
  "seasoning",
  "prepared-food",
  "equipment",
  "other-food",
]);
export type ProductFamily = z.infer<typeof productFamilySchema>;
const observedQualifierSchema = z
  .object({
    kind: qualifierSchema.shape.kind,
    value: z.string().min(1).max(40),
  })
  .strict()
  .refine((q) =>
    (qualifierValues[q.kind] as readonly string[]).includes(q.value),
  );
/** Recognized retailer-label claims, not allergen certification or shopper requirements. */
export const productEvidenceSchema = z
  .object({
    source: z.literal("retailer-name"),
    quote: z.string().min(1).max(500),
    category: categorySchema.nullable(),
    family: productFamilySchema.nullable(),
    qualifiers: z.array(observedQualifierSchema).max(8),
    retailerCategory: z.string().max(200).nullable(),
    labels: z.array(z.string().max(100)).max(20),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (!e.category && e.qualifiers.length)
      ctx.addIssue({
        code: "custom",
        message: "Unknown categories cannot establish qualifiers",
      });
    if (
      e.category &&
      !classificationSchema.safeParse({
        category: e.category,
        provenance: "observed",
        qualifiers: e.qualifiers.map((q) => ({ ...q, provenance: "observed" })),
      }).success
    )
      ctx.addIssue({ code: "custom", message: "Invalid retailer qualifiers" });
  });
export type ProductEvidence = z.infer<typeof productEvidenceSchema>;

/** Source price fields remain readable even when the app cannot price/transfer that unit yet. */
export const campaignDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === date
    );
  });
export const cataloguePricingSchema = z
  .object({
    amount: z.number().int().nonnegative().nullable(),
    unit: z.string().max(40).nullable(),
    basis: z.string().max(40).nullable(),
    approximate: z.boolean().nullable(),
    deposit: z.number().int().nonnegative().nullable(),
    regularPrice: z
      .number()
      .int()
      .nonnegative()
      .max(100_000_000)
      .nullable()
      .optional(),
    campaignPrice: z
      .number()
      .int()
      .nonnegative()
      .max(100_000_000)
      .nullable()
      .optional(),
    campaignValidUntil: campaignDateSchema.nullable().optional(),
    lowest30DayPrice: z
      .number()
      .int()
      .nonnegative()
      .max(100_000_000)
      .nullable()
      .optional(),
  })
  .strict();
export type CataloguePricing = z.infer<typeof cataloguePricingSchema>;

/** Explicit retailer weight per ordered piece; final weighed amount can vary. */
export const pieceOrderingSchema = z
  .object({
    unit: z.literal("kpl"),
    increment: z.literal(1),
    estimatedWeightGrams: z.number().positive().max(100_000),
  })
  .strict();
export type PieceOrdering = z.infer<typeof pieceOrderingSchema>;

export function pieceOrdering(
  weightKg: number | null | undefined,
): PieceOrdering | undefined {
  if (weightKg == null) return undefined;
  const result = pieceOrderingSchema.safeParse({
    unit: "kpl",
    increment: 1,
    estimatedWeightGrams: weightKg * 1000,
  });
  return result.success ? result.data : undefined;
}
