import { z } from "zod";
import { editDeltaSchema, type EditDelta } from "../domain/edit-delta";
import {
  editAmbiguitySchema,
  editOperationSchema,
  editTargetIdSchema,
  editTargets,
  type EditAmbiguity,
} from "../domain/edits";
import { intentMappingSchema } from "../domain/intents";
import {
  ingredientSchema,
  mealSchema,
  recipeSchema,
  unitSchema,
  type AppState,
} from "../domain/model";
import { editRequestSchema } from "../ai/edit";
import { persistedQuoteSchema } from "./quotes";

/** The SQLite document of the one undoable edit (`development:edit-undo` in development mode). */
export const EDIT_UNDO_KEY = "edit-undo";

export const editListRequestSchema = editRequestSchema
  .extend({
    revision: z.number().int().nonnegative(),
    consent: z.literal(true),
  })
  .strict();
/** Edits that need no interpretation and no catalogue read: they work from the retained quote. */
export const localEditOperations = [
  "removeItem",
  "removeMeal",
  "changeServings",
  "changeQuantity",
  "markAtHome",
] as const;
export const localEditRequestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    operations: z.array(editOperationSchema).min(1).max(100),
  })
  .strict()
  .refine((request) =>
    request.operations.every((o) =>
      (localEditOperations as readonly string[]).includes(o.op),
    ),
  );
export const undoEditRequestSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();

const appliedEditSchema = z
  .object({
    op: z.enum([
      "addItem",
      "removeItem",
      "replaceMeal",
      "changeServings",
      "changeQuantity",
      "markAtHome",
      "addMeal",
      "setItem",
      "removeMeal",
    ]),
    targetId: editTargetIdSchema,
    name: z.string(),
    to: z.string().optional(),
    unit: unitSchema.optional(),
    before: z.number().optional(),
    after: z.number().optional(),
  })
  .strict();
/** The plan fields an edit can change. Undo restores exactly these and nothing else. */
const editedPlanSchema = z
  .object({
    recipes: z.array(recipeSchema),
    meals: z.array(mealSchema),
    extras: z.array(ingredientSchema),
    skipped: z.array(z.string()),
    removed: z.array(z.string()),
    quantities: z.record(z.string(), z.number().int().positive()),
    requestIntents: z.array(intentMappingSchema),
  })
  .strict();
export const editUndoSchema = z
  .object({
    version: z.literal(1),
    /** The revision the edit produced. Undo is offered only while the plan is still at it. */
    revision: z.number().int().positive(),
    plan: editedPlanSchema,
    /** The quote that belonged to the plan before the edit, when there was one. */
    quote: persistedQuoteSchema.nullable(),
    applied: z.array(appliedEditSchema).max(20),
    delta: editDeltaSchema,
  })
  .strict();
export type EditUndo = z.infer<typeof editUndoSchema>;
export const editedPlan = (state: AppState): EditUndo["plan"] =>
  structuredClone({
    recipes: state.recipes,
    meals: state.meals,
    extras: state.extras,
    skipped: state.skipped,
    removed: state.removed,
    quantities: state.quantities,
    requestIntents: state.requestIntents,
  });

/** The last edit outcome for the plan revision it belongs to. Never saved in `AppState`. */
export type EditStatus =
  | {
      status: "applied" | "undone";
      revision: number;
      applied: EditUndo["applied"];
      delta: EditDelta;
    }
  | {
      status: "clarification";
      revision: number;
      ambiguities: {
        phrase: string;
        candidates: { targetId: string; name: string; detail: string }[];
      }[];
      unsupported: string[];
    };

/** Names the candidates of a clarification so the shopper can tell similar targets apart. */
export function describeAmbiguities(
  state: AppState,
  ambiguities: EditAmbiguity[],
  now = new Date(),
) {
  const targets = editTargets(state, now);
  return z
    .array(editAmbiguitySchema)
    .parse(ambiguities)
    .map((ambiguity) => ({
      phrase: ambiguity.phrase,
      candidates: ambiguity.candidates.map((targetId) => {
        const row = targets.rows.find((r) => r.targetId === targetId);
        const meal = targets.meals.find((m) => m.targetId === targetId);
        return {
          targetId,
          name: row?.name ?? meal?.name ?? targetId,
          // Amount and unit, or servings, in plain data for the UI to format.
          detail: row
            ? `${row.amount} ${row.unit}`
            : meal
              ? String(meal.servings)
              : "",
        };
      }),
    }));
}
