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
export const clearListRequestSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const householdSizeRequestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    servings: z.number().int().min(1).max(100),
  })
  .strict();
/**
 * What a new household size does to the current meals. A meal planned for the old household size
 * follows the new one exactly. A meal the shopper deliberately planned for another number of
 * servings is kept as it is and listed, so nothing is rounded or guessed.
 */
export function householdScaling(state: AppState, servings: number) {
  const name = (recipeId: string) =>
    state.recipes.find((r) => r.id === recipeId)?.name ?? recipeId;
  const old = state.household.servings;
  return {
    from: old,
    to: servings,
    scaled: state.meals
      .filter((m) => !m.leftovers && m.servings === old && old !== servings)
      .map((m) => ({
        mealId: m.id,
        name: name(m.recipeId),
        before: old,
        after: servings,
      })),
    kept: state.meals
      .filter((m) => !m.leftovers && m.servings !== old)
      .map((m) => ({
        mealId: m.id,
        name: name(m.recipeId),
        servings: m.servings,
      })),
  };
}
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
      "specifyItem",
      "setAttribute",
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
    // Absent in undo snapshots saved before row specifications existed.
    specifications: z.record(z.string(), z.string()).default({}),
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
    applied: z.array(appliedEditSchema).max(100),
    delta: editDeltaSchema,
    /**
     * Other saved fields the operation changed, restored with the plan: the note and plan flags
     * for Clear list, the household size for a size change. Absent for ordinary edits.
     */
    also: z
      .object({
        note: z.string().max(10000),
        assumptions: z.string().max(5000),
        recurringPaused: z.boolean(),
        calendar: z.record(
          z.string(),
          z.object({ mealIds: z.array(z.string()), leftovers: z.boolean() }),
        ),
        household: z.object({ servings: z.number().int().min(1).max(100) }),
      })
      .partial()
      .strict()
      .optional(),
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
    specifications: state.specifications,
  });

/** The fields outside `plan` that a change touched, as they were before it. */
export function changedAlso(base: AppState, next: AppState): EditUndo["also"] {
  const also: NonNullable<EditUndo["also"]> = {};
  if (base.note !== next.note) also.note = base.note;
  if (base.assumptions !== next.assumptions)
    also.assumptions = base.assumptions;
  if (base.recurringPaused !== next.recurringPaused)
    also.recurringPaused = base.recurringPaused;
  if (JSON.stringify(base.calendar) !== JSON.stringify(next.calendar))
    also.calendar = structuredClone(base.calendar);
  if (base.household.servings !== next.household.servings)
    also.household = { servings: base.household.servings };
  return Object.keys(also).length ? also : undefined;
}
/** A state with an undo snapshot put back over it. */
export function restoredPlan(state: AppState, undo: EditUndo) {
  const { household, ...also } = structuredClone(undo.also ?? {});
  return {
    ...state,
    ...structuredClone(undo.plan),
    ...also,
    household: { ...state.household, ...household },
  };
}

/** The last edit outcome for the plan revision it belongs to. Never saved in `AppState`. */
export type EditStatus =
  | {
      /** `cleared`: Clear list. `resized`: a household-size change. Both undo like an edit. */
      status: "applied" | "undone" | "cleared" | "resized";
      revision: number;
      applied: EditUndo["applied"];
      delta: EditDelta;
      /** Parts of an applied instruction that were not done (B4.4). */
      unsupported?: string[];
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
