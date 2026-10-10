import { z } from "zod";
import {
  categorySchema,
  classificationSchema,
  qualifierSchema,
  qualifierValues,
} from "./categories";

export const categoryPreferenceSchema = z
  .object({
    category: categorySchema,
    qualifiers: z
      .array(
        z
          .object({
            kind: qualifierSchema.shape.kind,
            value: z.string().min(1).max(40),
          })
          .strict()
          .refine((q) =>
            (qualifierValues[q.kind] as readonly string[]).includes(q.value),
          ),
      )
      .min(1)
      .max(8),
    strength: z.enum(["required", "preferred"]),
  })
  .strict()
  .refine(
    (p) =>
      classificationSchema.safeParse({
        category: p.category,
        provenance: "remembered",
        qualifiers: p.qualifiers.map((q) => ({
          ...q,
          provenance: "remembered",
        })),
      }).success,
  );
export type CategoryPreference = z.infer<typeof categoryPreferenceSchema>;

export const categoryPreferencesSchema = z
  .array(categoryPreferenceSchema)
  .max(8)
  .refine(
    (rules) =>
      new Set(rules.map((rule) => rule.category)).size === rules.length,
  );

const revisionSchema = z.number().int().nonnegative();
export const rememberCategoryPreferenceSchema = z
  .object({
    revision: revisionSchema,
    requirementKey: z.string().min(1).max(110),
    productId: z.string().min(1).max(100),
    preference: categoryPreferenceSchema,
  })
  .strict();
export const editCategoryPreferenceSchema = z
  .object({ revision: revisionSchema, preference: categoryPreferenceSchema })
  .strict();
export const forgetCategoryPreferenceSchema = z
  .object({ revision: revisionSchema, category: categorySchema })
  .strict();
export const resetCategoryPreferencesSchema = z
  .object({ revision: revisionSchema })
  .strict();
export type RememberCategoryPreference = z.infer<
  typeof rememberCategoryPreferenceSchema
>;
export type EditCategoryPreference = z.infer<
  typeof editCategoryPreferenceSchema
>;
export type ForgetCategoryPreference = z.infer<
  typeof forgetCategoryPreferenceSchema
>;
export type ResetCategoryPreferences = z.infer<
  typeof resetCategoryPreferencesSchema
>;
