import { z } from "zod";
import { classificationSchema } from "../domain/categories";
import { recipeSchema, type AppState, type Recipe } from "../domain/model";

export const MAX_CONTEXT_CHARACTERS = 24_000;
export const MAX_CONTEXT_RECIPES = 12;
export const MAX_CONTEXT_PREFERENCES = 20;
export const MAX_OBSERVED_SUMMARIES = 20;

const rememberedSchema = classificationSchema.refine(
  (c) =>
    c.provenance === "remembered" &&
    c.qualifiers.every((q) => q.provenance === "remembered"),
);
/** Future F18 input: bounded semantic hints only; no free text, dates or transaction identity. */
export const observedSummarySchema = z
  .object({
    classification: classificationSchema.refine(
      (c) =>
        c.provenance === "observed" &&
        c.qualifiers.every((q) => q.provenance === "observed"),
    ),
    observations: z.number().int().positive().max(1000),
  })
  .strict();
export const contextOptionsSchema = z
  .object({
    categoryPreferences: z
      .array(rememberedSchema)
      .max(MAX_CONTEXT_PREFERENCES)
      .default([]),
    observedSummaries: z
      .array(observedSummarySchema)
      .max(MAX_OBSERVED_SUMMARIES)
      .default([]),
  })
  .strict();
export type ContextOptions = z.input<typeof contextOptionsSchema>;
export type ObservedSummary = z.infer<typeof observedSummarySchema>;
export type ContextState = Pick<
  AppState,
  "language" | "household" | "recipes" | "productPreference"
>;

const words = (text: string) =>
  text
    .toLocaleLowerCase("fi")
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
const stopWords = new Set([
  "haluan",
  "haluaisin",
  "tänään",
  "viikolle",
  "please",
  "want",
  "with",
  "without",
  "food",
  "make",
  "cook",
]);
/** Local candidate selection; all selected recipe content remains untrusted prompt data. */
export function relevantRecipes(
  request: string,
  recipes: readonly Recipe[],
): Recipe[] {
  const query = words(request)
    .filter((w) => !stopWords.has(w))
    .flatMap((w) => [
      w,
      ...(/[aä]$/.test(w) && w.length > 4 ? [w.slice(0, -1)] : []),
    ]);
  return recipes.filter((recipe) =>
    words(recipe.name).some((name) =>
      query.some(
        (q) => q.startsWith(name) || name.startsWith(q) || name.endsWith(q),
      ),
    ),
  );
}

export function buildCompactContext(
  request: string,
  state: ContextState,
  options: ContextOptions = {},
) {
  z.string().min(1).max(10_000).parse(request);
  const inputs = contextOptionsSchema.parse(options);
  const relevant = relevantRecipes(request, state.recipes);
  if (relevant.length > MAX_CONTEXT_RECIPES) throw new Error("contextTooLarge");
  const recipes = relevant.map((r) => {
    const recipe = recipeSchema.parse(r);
    // Existing recipe references need ingredient amounts, not cooking text or old note spans.
    return {
      id: recipe.id,
      name: recipe.name,
      servings: recipe.servings,
      kind: recipe.kind,
      ingredients: recipe.ingredients.map((item) => ({
        id: item.id,
        name: item.name,
        amount: item.amount,
        unit: item.unit,
        ...(item.classification
          ? {
              classification: {
                category: item.classification.category,
                provenance:
                  item.classification.provenance === "explicit-note"
                    ? "recipe-inferred"
                    : item.classification.provenance,
                qualifiers: item.classification.qualifiers.map((q) => ({
                  kind: q.kind,
                  value: q.value,
                  provenance:
                    q.provenance === "explicit-note"
                      ? "recipe-inferred"
                      : q.provenance,
                })),
              },
            }
          : {}),
      })),
    };
  });
  const context = {
    language: state.language,
    household: {
      servings: state.household.servings,
      budget: state.household.budget,
      exclusions: state.household.exclusions,
    },
    productPreference: state.productPreference,
    recipes,
    categoryPreferences: inputs.categoryPreferences,
    observedSummaries: inputs.observedSummaries,
  };
  if (JSON.stringify({ request, context }).length > MAX_CONTEXT_CHARACTERS)
    throw new Error("contextTooLarge");
  return context;
}
export type CompactContext = ReturnType<typeof buildCompactContext>;
