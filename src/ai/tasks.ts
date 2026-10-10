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
