import { enrichReceipt } from "../ai/receipt-enrichment";
import { InferenceError, type InferenceSession } from "../ai/provider";
import { receiptEnrichmentTask, receiptNameTask } from "../ai/tasks";
import type { PurchaseLedger, SemanticAnnotation } from "../domain/purchases";
import {
  buildCombinedBatch,
  buildEnrichmentBatch,
  enrichmentAllowed,
  validateCombined,
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
  // Version 2 (readable names) when the model advertises it; version 1 otherwise. One request,
  // one model, no repair or fallback to another provider either way.
  const task = receiptTask(session);
  if (!task) return { status: "unavailable", reason: "unsupportedTask" };
  let result: unknown;
  try {
    result = await enrichReceipt(session, batch, task);
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
        taskVersion: task.version,
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

export type BatchEnrichmentRun =
  | {
      status: "enriched";
      /** Each purchase that got proposals and the source revision they were made for. */
      events: Map<string, number>;
      annotations: SemanticAnnotation[];
      rejected: number;
      unresolved: number;
      omitted: number;
      stale: string[];
    }
  | { status: "skipped"; reason: "consent" | "nothing-ambiguous" }
  | {
      status: "unavailable" | "failed" | "cancelled" | "stale";
      reason: string;
    };
/**
 * The one enrichment request of a multi-receipt action. Like `runReceiptEnrichment` it writes
 * nothing and asks for a session only after consent for its provider is established. Consent is
 * checked again when the answer arrives, so consent withdrawn meanwhile discards the answer.
 */
export async function runBatchEnrichment(options: {
  ledger: () => Promise<PurchaseLedger>;
  eventIds: string[];
  providerId: string;
  consent?: unknown;
  /** Another inference owns the connection: nothing is asked and nothing is queued. */
  busy?: () => boolean;
  session: () => Promise<InferenceSession>;
  now?: () => Date;
}): Promise<BatchEnrichmentRun> {
  const before = await options.ledger();
  if (!enrichmentAllowed(before.consent, options.providerId, options.consent))
    return { status: "skipped", reason: "consent" };
  const batch = buildCombinedBatch(before, options.eventIds);
  if (!batch.request) return { status: "skipped", reason: "nothing-ambiguous" };
  if (options.busy?.()) return { status: "unavailable", reason: "aiBusy" };
  let session: InferenceSession;
  try {
    session = await options.session();
  } catch (error) {
    return failure(error) as BatchEnrichmentRun;
  }
  if (session.model.providerId !== options.providerId)
    return { status: "unavailable", reason: "unsupportedProvider" };
  // Version 2 (readable names) when the model advertises it; version 1 otherwise. One request,
  // one model, no repair or fallback to another provider either way.
  const task = receiptTask(session);
  if (!task) return { status: "unavailable", reason: "unsupportedTask" };
  let result: unknown;
  try {
    result = await enrichReceipt(session, batch, task);
  } catch (error) {
    return failure(error) as BatchEnrichmentRun;
  }
  const after = await options.ledger();
  if (!enrichmentAllowed(after.consent, options.providerId, options.consent))
    return { status: "skipped", reason: "consent" };
  try {
    const outcome = validateCombined(
      batch,
      result,
      after,
      {
        providerId: session.model.providerId,
        modelId: session.model.modelId,
        taskVersion: task.version,
      },
      (options.now?.() ?? new Date()).toISOString(),
    );
    if (outcome.stale.length === batch.events.size)
      return { status: "stale", reason: "enrichmentStale" };
    return {
      status: "enriched",
      events: batch.events,
      ...outcome,
      omitted: batch.omitted,
    };
  } catch {
    return { status: "failed", reason: "invalidOutput" };
  }
}

/** The receipt task version the session's model supports, newest first, or null. */
function receiptTask(session: InferenceSession) {
  const supports = (version: number) =>
    session.model.capabilities.tasks.some(
      (task) =>
        task.id === receiptEnrichmentTask.id && task.version === version,
    );
  if (supports(receiptNameTask.version)) return receiptNameTask;
  if (supports(receiptEnrichmentTask.version)) return receiptEnrichmentTask;
  return null;
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
  // The connection is answering someone else: nothing is queued for later.
  if (code === "busy") return { status: "unavailable", reason: "aiBusy" };
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
