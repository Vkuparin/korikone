import { z } from "zod";
import { categorySchema } from "../../../src/domain/categories";
import { recipeSchema, unitSchema } from "../../../src/domain/model";
import type { OperationMetric } from "../../../src/application/metrics";

const productSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    price: z.number().nonnegative().nullable(),
    available: z.boolean().optional(),
    weighed: z.boolean().optional(),
  })
  .strict();
/** Expectations are authored from the note, never reconstructed from the model reply. */
export const expectedRequestSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["grocery", "dish"]),
    names: z.array(z.string().min(1)).min(1),
    // null explicitly expects a grocery outside the eight matcher categories.
    category: categorySchema.nullable().optional(),
    // null means the note supplied no quantity; an invented number must fail.
    amount: z.number().int().positive().nullable().optional(),
    unit: unitSchema.optional(),
    admissible: z.array(z.string()).default([]),
    forbidden: z.array(z.string()).default([]),
  })
  .strict()
  .refine(
    (r) =>
      r.kind === "dish" ||
      (r.category !== undefined &&
        r.amount !== undefined &&
        r.unit !== undefined),
  );
export const shoppingCaseSchema = z
  .object({
    id: z.string().min(1),
    note: z.string().min(1).max(10_000),
    expected: z.array(expectedRequestSchema).min(1).max(100),
    // One response per attempted interpretation/repair. Never derives the expectations above.
    replies: z.array(z.string()).min(1).max(2),
    completion: z.enum(["complete", "incomplete"]).default("complete"),
    catalogue: z.record(z.string(), z.array(productSchema)),
    boundaryFailure: z.enum(["search-error", "malformed"]).optional(),
    contextSetup: z
      .object({
        household: z
          .object({
            servings: z.number().int().min(1).max(100),
            budget: z.number().int().min(0).max(1_000_000),
            exclusions: z.string().max(1000),
          })
          .optional(),
        recipes: z.array(recipeSchema).max(1000).optional(),
        receiptText: z.string().max(50_000).optional(),
        productPreference: z
          .enum(["price", "storeBrand", "avoidStoreBrand"])
          .optional(),
      })
      .strict()
      .optional(),
    requiredCapabilities: z
      .array(
        z.enum([
          "weighed-pricing",
          "preview",
          "edit",
          "resolver",
          "visible-unsearchable-request",
          "cancellation",
          "stale-run",
          "store-change",
          "preferences",
          "compact-context",
          "dietary-evidence",
          "unknown-quantity",
        ]),
      )
      .default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    const groceryNames = c.expected
      .filter((r) => r.kind === "grocery")
      .flatMap((r) =>
        r.names.map((name) => name.trim().toLocaleLowerCase("fi")),
      );
    if (new Set(groceryNames).size !== groceryNames.length)
      ctx.addIssue({
        code: "custom",
        message: "Overlapping expected grocery aliases",
      });
    if (new Set(c.expected.map((r) => r.id)).size !== c.expected.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate expected request ID",
      });
    for (const r of c.expected)
      if (r.admissible.some((id) => r.forbidden.includes(id)))
        ctx.addIssue({
          code: "custom",
          message: "Conflicting admissible/forbidden expectations",
        });
  });
export type ShoppingCase = z.infer<typeof shoppingCaseSchema>;
export type ExpectedRequest = z.infer<typeof expectedRequestSchema>;
export type UnresolvedReason =
  | "empty-search"
  | "search-error"
  | "normalization"
  | "stock"
  | "pack"
  | "price"
  | "unit"
  | "suitability"
  | "ranking"
  | "missing-request"
  | "invalid-output"
  | "incomplete";
export type EvaluationResult = {
  operationMetrics: OperationMetric[];
  id: string;
  chain: "k-ruoka" | "s-kaupat";
  requested: number;
  missingRequests: string[];
  wrongCategory: string[];
  wrongQuantity: string[];
  unsuitable: string[];
  safePriced: number;
  unresolved: number;
  reasons: Partial<Record<UnresolvedReason, number>>;
  aiRequests: number;
  searches: number;
  retailerWrites: number;
  contextCharacters: number;
  // Task adapters and current UI capability tests land in their assigned cards.
  unsupported: ShoppingCase["requiredCapabilities"];
  editCorrectness: "unsupported";
};
