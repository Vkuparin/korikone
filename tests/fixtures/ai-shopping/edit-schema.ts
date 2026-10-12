import { z } from "zod";
import { editTargetIdSchema } from "../../../src/domain/edits";

/** One operation the author expects, named by its explicit target ID. */
export const expectedEditSchema = z
  .object({
    op: z.enum([
      "addItem",
      "removeItem",
      "replaceMeal",
      "changeServings",
      "changeQuantity",
      "markAtHome",
    ]),
    targetId: editTargetIdSchema,
    /** Row amount or servings after the operation, when the author states one. */
    after: z.number().optional(),
  })
  .strict();

/**
 * An edit scenario against the shared `editPlan()` list. Everything is written from the
 * instruction and the plan, never from the interpreter's reply.
 */
export const editCaseSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(["fi", "en"]),
    kind: z.enum([
      "add",
      "remove",
      "replace",
      "servings",
      "quantity",
      "at-home",
      "conflict",
      "multi",
      "undo",
    ]),
    instruction: z.string().min(1).max(2000),
    focusTargetId: editTargetIdSchema.optional(),
    /**
     * `applied` changes the list. `clarification` must ask and leave it exactly as it was.
     * `unchanged` accepts a clarification or a rejection, never a partial edit.
     */
    outcome: z.enum(["applied", "clarification", "unchanged"]),
    expectedOperations: z.array(expectedEditSchema).max(20),
    /** For a clarification: the candidates the shopper must be offered, per ambiguity. */
    expectedCandidates: z.array(z.array(editTargetIdSchema).min(2)).optional(),
    /** Bought amount per requirement key after the edit; 0 means not bought. */
    expectedAmounts: z.record(z.string(), z.number().int().nonnegative()),
    /** Meal ID to the name of the recipe it must use afterwards. */
    expectedMealRecipes: z.record(z.string(), z.string()).optional(),
    /** Requirement keys whose bought amount must be exactly what it was. */
    preserved: z.array(z.string()),
    /** Undo the edit afterwards and expect the plan before it, with no request or retailer write. */
    undo: z.boolean().default(false),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.outcome !== "applied" && c.expectedOperations.length)
      ctx.addIssue({
        code: "custom",
        message: "A clarification applies no operation",
      });
    if (c.outcome === "applied" && !c.expectedOperations.length)
      ctx.addIssue({ code: "custom", message: "An edit expects operations" });
    const targets = c.expectedOperations.map((o) => o.targetId);
    if (new Set(targets).size !== targets.length)
      ctx.addIssue({ code: "custom", message: "Duplicate expected target" });
    for (const key of Object.keys(c.expectedAmounts))
      if (c.preserved.includes(key))
        ctx.addIssue({
          code: "custom",
          message: `Both changed and preserved: ${key}`,
        });
  });
export type EditCase = z.infer<typeof editCaseSchema>;

export type EditEvaluationResult = {
  id: string;
  provider: "chatgpt" | "alternative";
  language: "fi" | "en";
  /** Operations the author expected. */
  requested: number;
  /** Expected operations not applied as expected; a clarification or unsupported part counts. */
  missingEdits: string[];
  /** Applied operations the author did not expect, or with a wrong resulting value. */
  incorrectEdits: string[];
  amountErrors: string[];
  mealErrors: string[];
  preservedViolations: string[];
  outcomeErrors: string[];
  aiRequests: number;
  retailerWrites: number;
  /** Null unless the case undoes: the plan fields were restored with no request or write. */
  undoCorrect: boolean | null;
};
