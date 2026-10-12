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
export const inferenceTasks = [
  ...interpretationTasks,
  candidateResolutionTask,
  shoppingPlanTask,
  shoppingEditTask,
  receiptEnrichmentTask,
];
