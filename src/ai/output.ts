import { z } from "zod";
import {
  categorySchema,
  provenanceSchema,
  qualifierSchema,
} from "../domain/categories";
import { unitSchema } from "../domain/model";
import type { ContextState } from "./context";
import {
  InferenceError,
  type InferenceOutput,
  type InferenceSession,
  type InferenceTask,
} from "./provider";
import { shoppingDraftTask, recipeImportTask } from "./tasks";
import {
  draftPrompt,
  recipePrompt,
  validateDraft,
  validateRecipe,
  generateValidated,
} from "./draft";

// Native wire schemas deliberately exclude task refinements/defaults. Domain validation follows.
const evidenceWireSchema = z
  .object({ start: z.int(), end: z.int(), quote: z.string() })
  .strict();
const qualifierWireSchema = z
  .object({
    kind: qualifierSchema.shape.kind,
    value: z.string(),
    provenance: provenanceSchema,
    evidence: evidenceWireSchema.nullable(),
  })
  .strict();
const classificationWireSchema = z
  .object({
    category: categorySchema,
    provenance: provenanceSchema,
    evidence: evidenceWireSchema.nullable(),
    qualifiers: z.array(qualifierWireSchema),
  })
  .strict();
const ingredientWireSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    amount: z.int(),
    unit: unitSchema,
    classification: classificationWireSchema.nullable(),
  })
  .strict();
export const recipeWireSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    servings: z.int(),
    ingredients: z.array(ingredientWireSchema),
    instructions: z.string(),
    kind: z.enum(["meal", "ready", "breakfast", "evening", "snack"]).nullable(),
  })
  .strict();
export const shoppingWireSchema = z
  .object({
    recipes: z.array(recipeWireSchema),
    meals: z.array(
      z
        .object({
          day: z.int().nullable(),
          recipeId: z.string(),
          servings: z.int(),
          leftovers: z.boolean().nullable(),
        })
        .strict(),
    ),
    items: z.array(ingredientWireSchema),
    notes: z.string(),
  })
  .strict();

function nativeOutput(
  name: string,
  schema: z.ZodType,
): Extract<InferenceOutput, { mode: "json-schema" }> {
  const { $schema: _dialect, ...wire } = z.toJSONSchema(schema, {
    target: "draft-07",
    reused: "inline",
  });
  return { mode: "json-schema", name, schema: wire };
}
export const shoppingNativeOutput = nativeOutput(
  "shopping_draft_v1",
  shoppingWireSchema,
);
export const recipeNativeOutput = nativeOutput(
  "recipe_import_v1",
  recipeWireSchema,
);

/** Null means omitted only for optional native fields declared above. No permissive domain parsing. */
function omitNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNulls);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, omitNulls(entry)]),
    );
  return value;
}
function normalizeNative(raw: string, schema: z.ZodType): string {
  try {
    return JSON.stringify(omitNulls(schema.parse(JSON.parse(raw))));
  } catch {
    throw new Error("invalidDraft");
  }
}

export type TaskOutput<T> = {
  task: InferenceTask;
  prompt: string;
  native: Extract<InferenceOutput, { mode: "json-schema" }>;
  normalizeNative: (raw: string) => string;
  validate: (raw: string) => T;
  repairLimit: 0 | 1;
  correction: string;
};

/** One selected format for all attempts. Provider failures are outside the validation repair. */
export async function invokeTaskOutput<T>(
  session: InferenceSession,
  definition: TaskOutput<T>,
): Promise<T> {
  if (definition.repairLimit !== 0 && definition.repairLimit !== 1)
    throw new InferenceError("unsupportedTask");
  const modes = session.model.capabilities.outputModes;
  const native = modes.includes("json-schema");
  if (!native && !modes.includes("text"))
    throw new InferenceError("unsupportedCapability");
  const output: InferenceOutput = native
    ? structuredClone(definition.native)
    : { mode: "text" };
  const prompt =
    definition.prompt +
    (native
      ? " Use the supplied native schema exactly. Every field is required on the wire; use null only for optional metadata, kind, day or leftovers. Empty optional arrays are []."
      : "");
  const generate = async (input: string) =>
    (await session.invoke(definition.task, input, output)).text;
  const validate = (raw: string) =>
    definition.validate(native ? definition.normalizeNative(raw) : raw);
  return definition.repairLimit === 1
    ? generateValidated(generate, prompt, validate, definition.correction)
    : validate(await generate(prompt));
}

function taskSnapshot(state: ContextState, note: string) {
  return {
    language: state.language,
    recipes: structuredClone(state.recipes),
    household: structuredClone(state.household),
    productPreference: state.productPreference,
    categoryPreferences: structuredClone(state.categoryPreferences ?? []),
    note,
  };
}
export function interpretShopping(
  session: InferenceSession,
  note: string,
  state: ContextState,
) {
  const snapshot = taskSnapshot(state, note);
  return invokeTaskOutput(session, {
    task: shoppingDraftTask,
    prompt: draftPrompt(note, snapshot),
    native: shoppingNativeOutput,
    normalizeNative: (raw) => normalizeNative(raw, shoppingWireSchema),
    validate: (raw) => validateDraft(raw, snapshot, note),
    repairLimit: 1,
    correction:
      " The previous response failed validation. Check integer quantities, unique recipe IDs, source evidence and that every meal references an existing or new recipe. Return complete JSON only.",
  });
}
export function extractRecipe(
  session: InferenceSession,
  text: string,
  state: ContextState,
) {
  const snapshot = taskSnapshot(state, "");
  return invokeTaskOutput(session, {
    task: recipeImportTask,
    prompt: recipePrompt(text, snapshot),
    native: recipeNativeOutput,
    normalizeNative: (raw) => normalizeNative(raw, recipeWireSchema),
    validate: (raw) => validateRecipe(raw, snapshot),
    repairLimit: 1,
    correction:
      " The previous response failed validation. Return one complete recipe object with positive integer g, ml or pcs quantities, servings from 1 to 100, and at least one ingredient. Return JSON only.",
  });
}
