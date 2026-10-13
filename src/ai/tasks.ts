import type { InferenceTask } from "./provider";
export const shoppingDraftTask = {
  id: "shopping-draft",
  version: 1,
} satisfies InferenceTask;
export const recipeImportTask = {
  id: "recipe-import",
  version: 1,
} satisfies InferenceTask;
export const interpretationTasks = [shoppingDraftTask, recipeImportTask];
export const candidateResolutionTask = {
  id: "candidate-resolution",
  version: 1,
} satisfies InferenceTask;
export const shoppingPlanTask = {
  id: "shopping-plan",
  version: 1,
} satisfies InferenceTask;
export const shoppingEditTask = {
  id: "shopping-edit",
  version: 1,
} satisfies InferenceTask;
export const receiptEnrichmentTask = {
  id: "receipt-enrichment",
  version: 1,
} satisfies InferenceTask;
/** Version 2 of the receipt task adds a grounded readable name per row (F27.6, F27.9). */
export const receiptNameTask = {
  id: "receipt-enrichment",
  version: 2,
} satisfies InferenceTask;
export const offerIdeasTask = {
  id: "offer-ideas",
  version: 1,
} satisfies InferenceTask;
export const inferenceTasks = [
  ...interpretationTasks,
  candidateResolutionTask,
  shoppingPlanTask,
  shoppingEditTask,
  receiptEnrichmentTask,
  receiptNameTask,
  offerIdeasTask,
];
