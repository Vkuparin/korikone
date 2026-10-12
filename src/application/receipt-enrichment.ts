import { enrichReceipt } from "../ai/receipt-enrichment";
import { InferenceError, type InferenceSession } from "../ai/provider";
import { receiptEnrichmentTask } from "../ai/tasks";
import type { PurchaseLedger, SemanticAnnotation } from "../domain/purchases";
import {
  buildEnrichmentBatch,
  enrichmentAllowed,
  validateEnrichment,
} from "../domain/receipt-semantics";

export type EnrichmentRun =
  | {
      status: "enriched";
      eventId: string;
      sourceRevision: number;
      annotations: SemanticAnnotation[];
      rejected: number;
      unresolved: number;
      omitted: number;
    }
  /** Nothing was sent: no consent for this provider and scope, or no ambiguous line. */
  | { status: "skipped"; reason: "consent" | "nothing-ambiguous" }
  /** The request was not made or failed; `reason` is a countable code, never provider text. */
  | {
      status: "unavailable" | "failed" | "cancelled" | "stale";
      reason: string;
    };

/**
 * One enrichment action for one purchase event. It reads the ledger and returns proposals; it
 * writes nothing, so every outcome leaves the local facts exactly as they were. `session` is
 * asked for only after consent for its provider is established, and is used for at most one call.
 */
export async function runReceiptEnrichment(options: {
  ledger: () => Promise<PurchaseLedger>;
  eventId: string;
  /** The AI provider the session will use, known before any model is contacted. */
  providerId: string;
  /** The shopper's answer for this action; absent for an automatic run. */
  consent?: unknown;
  session: () => Promise<InferenceSession>;
  now?: () => Date;
}): Promise<EnrichmentRun> {
  const before = await options.ledger();
  if (!enrichmentAllowed(before.consent, options.providerId, options.consent))
    return { status: "skipped", reason: "consent" };
  if (!before.events.some((event) => event.id === options.eventId))
    return { status: "failed", reason: "purchaseMissing" };
  const batch = buildEnrichmentBatch(before, options.eventId);
  if (!batch.request) return { status: "skipped", reason: "nothing-ambiguous" };
  let session: InferenceSession;
  try {
    session = await options.session();
  } catch (error) {
    return failure(error);
  }
  // Consent names one provider; a session of any other provider is never used.
  if (session.model.providerId !== options.providerId)
    return { status: "unavailable", reason: "unsupportedProvider" };
  if (
    !session.model.capabilities.tasks.some(
      (task) =>
        task.id === receiptEnrichmentTask.id &&
        task.version === receiptEnrichmentTask.version,
    )
  )
    return { status: "unavailable", reason: "unsupportedTask" };
  let result: unknown;
  try {
    result = await enrichReceipt(session, batch);
  } catch (error) {
    return failure(error);
  }
  try {
    // The ledger may have been corrected or the event deleted while the model answered.
    const outcome = validateEnrichment(
      batch,
      result,
      await options.ledger(),
      {
        providerId: session.model.providerId,
        modelId: session.model.modelId,
        taskVersion: receiptEnrichmentTask.version,
      },
      (options.now?.() ?? new Date()).toISOString(),
    );
    return {
      status: "enriched",
      eventId: batch.eventId,
      sourceRevision: batch.sourceRevision,
      ...outcome,
      omitted: batch.omitted,
    };
  } catch (error) {
    return error instanceof Error && error.message === "enrichmentStale"
      ? { status: "stale", reason: "enrichmentStale" }
      : { status: "failed", reason: "invalidOutput" };
  }
}

function failure(error: unknown): EnrichmentRun {
  const code =
    error instanceof InferenceError
      ? error.code
      : error instanceof Error && /^[a-zA-Z]{1,40}$/.test(error.message)
        ? error.message
        : "transport";
  if (code === "cancelled" || code === "aiCancelled")
    return { status: "cancelled", reason: "cancelled" };
  return [
    "unsupportedProvider",
    "unsupportedTask",
    "unsupportedCapability",
    "notConnected",
    "modelUnavailable",
    "modelsUnavailable",
  ].includes(code)
    ? { status: "unavailable", reason: code }
    : { status: "failed", reason: code };
}
