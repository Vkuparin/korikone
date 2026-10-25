import { z } from "zod";

export const operationStages = [
  "queued",
  "working",
  "discovering",
  "generating",
  "repairing",
  "searching",
  "resolving",
  "saving",
  "checking",
  "transferring",
  "verifying",
  "opening",
  "cancelling",
  "done",
  "failed",
  "cancelled",
] as const;
export const operationProgressSchema = z
  .object({
    id: z.uuid(),
    sequence: z.number().int().positive(),
    method: z.string().min(1).max(80),
    stage: z.enum(operationStages),
    startedAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    completed: z.number().int().nonnegative().nullable(),
    total: z.number().int().positive().nullable(),
    cancellable: z.boolean(),
  })
  .strict()
  .refine(
    (p) => p.completed === null || (p.total !== null && p.completed <= p.total),
  );
export type OperationProgress = z.infer<typeof operationProgressSchema>;
export type OperationStep = {
  stage: OperationProgress["stage"];
  completed?: number;
  total?: number;
  cancellable?: boolean;
};
export const terminalOperation = (p: OperationProgress) =>
  ["done", "failed", "cancelled"].includes(p.stage);
export const aiOperation = (method: string) =>
  [
    "generate",
    "planShopping",
    "editList",
    "importRecipe",
    "suggestOffers",
    "suggestStarterIdeas",
  ].includes(method);
export const trackedOperation = (method: string) =>
  aiOperation(method) ||
  [
    "approveDraft",
    "confirmPurchase",
    "newWeek",
    "reuseWeek",
    "repeatList",
    "correctRow",
    "rememberCategoryPreference",
    "editCategoryPreference",
    "forgetCategoryPreference",
    "resetCategoryPreferences",
    "omit",
    "recover",
    "openStoreCart",
    "commitPlanning",
    "save",
    "editLocally",
    "setHouseholdSize",
    "accept",
    "clearList",
    "resetList",
    "undoEdit",
    "setPackSize",
    "buildBasket",
    "requestPrices",
    "compareStores",
    "changeContext",
    "prepare",
    "transferDisplayed",
    "execute",
    "resume",
    "openStore",
    "findProduct",
  ].includes(method);

/** Numeric stages only: no notes, products, account data or model output. Late runs cannot overwrite a newer action. */
export class OperationTracker {
  current: OperationProgress | null = null;
  private sequence = 0;
  constructor(
    private emit: (value: OperationProgress) => void,
    private now = Date.now,
  ) {}
  start(method: string): string {
    const at = this.now();
    this.current = {
      id: crypto.randomUUID(),
      sequence: ++this.sequence,
      method,
      stage: "queued",
      startedAt: at,
      updatedAt: at,
      completed: null,
      total: null,
      cancellable:
        aiOperation(method) ||
        [
          "buildBasket",
          "requestPrices",
          "compareStores",
          "prepare",
          "transferDisplayed",
          "execute",
          "resume",
        ].includes(method),
    };
    this.emit(structuredClone(this.current));
    return this.current.id;
  }
  update(id: string, step: OperationStep) {
    const current = this.current;
    if (!current || current.id !== id || terminalOperation(current)) return;
    // Keep cancellation visible while an unavoidable in-flight read/write settles.
    if (
      current.stage === "cancelling" &&
      !["done", "failed", "cancelled"].includes(step.stage)
    )
      return;
    this.current = operationProgressSchema.parse({
      ...current,
      ...step,
      sequence: ++this.sequence,
      updatedAt: this.now(),
      completed: step.completed ?? null,
      total: step.total ?? null,
    });
    this.emit(structuredClone(this.current));
  }
  finish(id: string, stage: "done" | "failed" | "cancelled") {
    this.update(id, { stage, cancellable: false });
  }
}
