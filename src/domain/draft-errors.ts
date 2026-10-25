/**
 * Why a model draft was refused, as a fixed code and a position. Neither carries any text of the
 * note or of the reply, so both are safe to show, count and put in diagnostics.
 */
export const draftFailureReasons = [
  "json",
  "shape",
  "recipe-id",
  "recipe-reference",
  "classification",
  "intents-missing",
  "intent-span",
  "intent-quantity",
  "intent-target",
  "intent-coverage",
  "assumed-side",
  "merchandise",
  "offer-selection",
] as const;
export type DraftFailureReason = (typeof draftFailureReasons)[number];
/** The message stays `invalidDraft`, which is what triggers the single repair request. */
export class DraftError extends Error {
  constructor(
    readonly reason: DraftFailureReason,
    /** Where in the reply, such as `intents[2]`; never a value. */
    readonly path: string | null = null,
  ) {
    super("invalidDraft");
    this.name = "DraftError";
  }
}
/** A refused request ledger. The message stays `invalidIntentLedger` for existing callers. */
export class IntentLedgerError extends Error {
  constructor(
    readonly reason: Extract<DraftFailureReason, `intent-${string}` | "shape">,
    readonly index: number | null = null,
  ) {
    super("invalidIntentLedger");
    this.name = "IntentLedgerError";
  }
}
