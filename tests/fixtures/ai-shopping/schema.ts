import { z } from "zod";
import { categorySchema } from "../../../src/domain/categories";
import { unitSchema } from "../../../src/domain/model";

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
    category: categorySchema.optional(),
    amount: z.number().int().positive().optional(),
    unit: unitSchema.optional(),
    admissible: z.array(z.string()).default([]),
    forbidden: z.array(z.string()).default([]),
  })
  .strict()
  .refine(
    (r) =>
      r.kind === "dish" ||
      (!!r.category && r.amount !== undefined && r.unit !== undefined),
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
  // Task adapters and current UI capability tests land in their assigned cards.
  unsupported: ShoppingCase["requiredCapabilities"];
  editCorrectness: "unsupported";
};
