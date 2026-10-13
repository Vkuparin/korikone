import { z } from "zod";
import type { InferenceSession } from "../ai/provider";
import { RECEIPT_DATA_SCOPE, type PurchaseLedger } from "../domain/purchases";
import {
  correctPurchase,
  interpretPurchase,
  purchaseView,
} from "../domain/purchase-review";
import {
  applyEnrichment,
  buildCombinedBatch,
  enrichmentConsentSchema,
} from "../domain/receipt-semantics";
import type { PurchaseStore, ReceiptImport } from "./purchases";
import { runBatchEnrichment, runReceiptEnrichment } from "./receipt-enrichment";

/** The selected AI provider and a way to get a one-call session from it. */
export type ReceiptAI = {
  providerId: string;
  session: () => Promise<InferenceSession>;
  /** True while another inference (planning, an edit) owns the connection. */
  busy?: () => boolean;
};
/** Outcome of the one enrichment request of a multi-receipt action. Counts and codes only. */
export type BatchEnrichmentStatus = {
  status:
    "enriched" | "skipped" | "unavailable" | "failed" | "cancelled" | "stale";
  reason: string | null;
  /** Purchases the request covered, and those changed or deleted before the answer landed. */
  events: number;
  stale: number;
  accepted: number;
  rejected: number;
  unresolved: number;
  omitted: number;
};
/** The shopper's answer to the invitation shown after an import. */
export const receiptConsentActionSchema = z
  .object({
    choice: z.enum(["enable", "once", "decline"]),
    providerId: z.string().min(1).max(100),
    scope: z.literal(RECEIPT_DATA_SCOPE),
    /** The purchases of the import the invitation belongs to. */
    eventIds: z.array(z.string().min(1).max(100)).max(20),
  })
  .strict();
/** Outcome of the optional enrichment step of one action. Counts only; no label or model text. */
export type ReceiptEnrichmentStatus = {
  eventId: string;
  status:
    "enriched" | "skipped" | "unavailable" | "failed" | "cancelled" | "stale";
  reason: string | null;
  accepted: number;
  rejected: number;
  unresolved: number;
  omitted: number;
};
export const enrichPurchaseRequestSchema = z
  .object({
    eventId: z.string().min(1).max(100),
    /** The shopper's answer to the disclosure for this one receipt. */
    consent: enrichmentConsentSchema,
  })
  .strict();
export const receiptConsentRequestSchema = z
  .object({
    automatic: z.boolean(),
    providerId: z.string().min(1).max(100),
    scope: z.literal(RECEIPT_DATA_SCOPE),
  })
  .strict();

/**
 * Receipt import and its optional second step. Local facts are committed first and on their own;
 * enrichment then makes at most one request and can only add interpretations. It never removes or
 * changes a committed purchase, a shopping list, a cart or a saved preference.
 */
export class ReceiptImportCoordinator {
  constructor(private store: PurchaseStore) {}

  /**
   * One enrichment action for one event. The proposals are committed only if the event still
   * exists at the revision they were made for, so a correction, reprocessing or deletion made
   * while the model answered always wins.
   */
  async enrich(
    eventId: string,
    ai: ReceiptAI | null,
    consent?: unknown,
  ): Promise<ReceiptEnrichmentStatus> {
    const empty = {
      eventId,
      accepted: 0,
      rejected: 0,
      unresolved: 0,
      omitted: 0,
    };
    if (!ai)
      return { ...empty, status: "unavailable", reason: "unsupportedProvider" };
    const run = await runReceiptEnrichment({
      ledger: () => this.store.ledger(),
      eventId,
      providerId: ai.providerId,
      consent,
      session: ai.session,
    });
    if (run.status !== "enriched")
      return { ...empty, status: run.status, reason: run.reason };
    const counts = {
      eventId,
      accepted: run.annotations.length,
      rejected: run.rejected,
      unresolved: run.unresolved,
      omitted: run.omitted,
    };
    return this.store.serialize(async () => {
      const ledger = await this.store.ledger();
      const event = ledger.events.find((e) => e.id === eventId);
      const revision = event
        ? Math.max(
            ...ledger.sources
              .filter((s) => event.sourceIds.includes(s.id))
              .map((s) => s.revision),
          )
        : -1;
      if (revision !== run.sourceRevision)
        return {
          ...empty,
          status: "stale" as const,
          reason: "enrichmentStale",
        };
      if (run.annotations.length)
        await this.store.write(applyEnrichment(ledger, run.annotations));
      return { ...counts, status: "enriched" as const, reason: null };
    });
  }

  /**
   * One request for several purchases, committed purchase by purchase: each still at the revision
   * its rows were read at gets its proposals; one corrected or deleted meanwhile gets nothing.
   */
  async enrichBatch(
    eventIds: string[],
    ai: ReceiptAI | null,
    consent?: unknown,
  ): Promise<BatchEnrichmentStatus> {
    const empty = {
      events: 0,
      stale: 0,
      accepted: 0,
      rejected: 0,
      unresolved: 0,
      omitted: 0,
    };
    if (!ai)
      return { ...empty, status: "unavailable", reason: "unsupportedProvider" };
    const run = await runBatchEnrichment({
      ledger: () => this.store.ledger(),
      eventIds,
      providerId: ai.providerId,
      consent,
      busy: ai.busy,
      session: ai.session,
    });
    if (run.status !== "enriched")
      return { ...empty, status: run.status, reason: run.reason };
    return this.store.serialize(async () => {
      const ledger = await this.store.ledger();
      const current = new Set(
        [...run.events]
          .filter(([eventId, revision]) => {
            const event = ledger.events.find((e) => e.id === eventId);
            return (
              !!event &&
              Math.max(
                ...ledger.sources
                  .filter((s) => event.sourceIds.includes(s.id))
                  .map((s) => s.revision),
              ) === revision
            );
          })
          .map(([eventId]) => eventId),
      );
      const annotations = run.annotations.filter((a) => current.has(a.eventId));
      if (annotations.length)
        await this.store.write(applyEnrichment(ledger, annotations));
      return {
        status: current.size ? ("enriched" as const) : ("stale" as const),
        reason: current.size ? null : "enrichmentStale",
        events: run.events.size,
        stale: run.events.size - current.size,
        accepted: annotations.length,
        rejected: run.rejected,
        unresolved:
          run.unresolved + (run.annotations.length - annotations.length),
        omitted: run.omitted,
      };
    });
  }

  /**
   * The answer to the invitation shown after an import, in one action. `enable` saves automatic
   * consent and interprets the just-imported purchases; `once` interprets them without saving
   * anything; `decline` records the answer for this provider and scope and sends nothing.
   */
  async consentAction(
    input: unknown,
    ai: ReceiptAI | null,
    now = new Date(),
  ): Promise<BatchEnrichmentStatus | null> {
    const action = receiptConsentActionSchema.parse(input);
    if (action.choice === "decline") {
      await this.store.serialize(async () => {
        const ledger = await this.store.ledger();
        return this.store.write({
          ...ledger,
          consent: {
            ...ledger.consent,
            asked: true,
            declined: {
              providerId: action.providerId,
              scope: action.scope,
              at: now.toISOString(),
            },
          },
        });
      });
      return null;
    }
    // The answer names the provider it was shown for; another provider is never used.
    if (!ai || ai.providerId !== action.providerId)
      return {
        status: "unavailable",
        reason: "unsupportedProvider",
        events: 0,
        stale: 0,
        accepted: 0,
        rejected: 0,
        unresolved: 0,
        omitted: 0,
      };
    if (action.choice === "enable")
      await this.setConsent(
        {
          automatic: true,
          providerId: action.providerId,
          scope: action.scope,
        },
        now,
      );
    return this.enrichBatch(
      action.eventIds,
      ai,
      action.choice === "once"
        ? { providerId: action.providerId, scope: action.scope }
        : undefined,
    );
  }
  /**
   * Whether to offer the invitation for these purchases: there are rows a model could name, and
   * the shopper has neither enabled nor declined it for this provider and data scope.
   */
  async invitation(eventIds: string[], ai: ReceiptAI | null) {
    if (!ai || !eventIds.length) return null;
    const ledger = await this.store.ledger();
    const { consent } = ledger;
    if (
      (consent.automatic?.providerId === ai.providerId &&
        consent.automatic.scope === RECEIPT_DATA_SCOPE) ||
      (consent.declined?.providerId === ai.providerId &&
        consent.declined.scope === RECEIPT_DATA_SCOPE)
    )
      return null;
    const batch = buildCombinedBatch(ledger, eventIds);
    if (!batch.request) return null;
    return {
      providerId: ai.providerId,
      scope: RECEIPT_DATA_SCOPE,
      eventIds: [...batch.events.keys()],
      rows: batch.request.rows.length,
      omitted: batch.omitted,
    };
  }

  /**
   * Imports a receipt and, only for a newly added or changed purchase with saved automatic
   * consent for the selected provider, enriches it. Any enrichment outcome leaves the import done.
   */
  async import(
    text: string,
    format: "pdf" | "txt" | "csv",
    options: {
      keepOriginal?: boolean;
      ai?: ReceiptAI | null;
      ocrPages?: number[];
    } = {},
  ): Promise<{
    receipt: ReceiptImport;
    enrichment: ReceiptEnrichmentStatus | null;
  }> {
    const receipt = await this.store.importReceipt(text, format, options);
    if (
      !receipt.eventId ||
      receipt.outcome === "duplicate" ||
      receipt.outcome === "unsupported" ||
      !options.ai
    )
      return { receipt, enrichment: null };
    const enrichment = await this.enrich(receipt.eventId, options.ai);
    // Without saved consent nothing was asked of anyone: there is no enrichment to report.
    return {
      receipt,
      enrichment:
        enrichment.status === "skipped" && enrichment.reason === "consent"
          ? null
          : enrichment,
    };
  }

  /** Saves or withdraws automatic consent for one provider and the current data scope. */
  setConsent(input: unknown, now = new Date()) {
    const request = receiptConsentRequestSchema.parse(input);
    return this.store.serialize(async () => {
      const ledger = await this.store.ledger();
      return this.store.write({
        ...ledger,
        consent: {
          // Enabling answers an earlier "not now"; switching it off leaves that answer alone.
          ...(request.automatic ? {} : { declined: ledger.consent.declined }),
          asked: true,
          automatic: request.automatic
            ? {
                providerId: request.providerId,
                scope: request.scope,
                grantedAt: now.toISOString(),
              }
            : null,
        },
      });
    });
  }
  correct(input: unknown) {
    return this.change((ledger) => correctPurchase(ledger, input));
  }
  interpret(input: unknown, now = new Date()) {
    return this.change((ledger) =>
      interpretPurchase(ledger, input, now.toISOString()),
    );
  }
  private change(apply: (ledger: PurchaseLedger) => PurchaseLedger) {
    return this.store.serialize(async () =>
      this.store.write(apply(await this.store.ledger())),
    );
  }
  /** Everything the receipt screens need, read fresh from the ledger. */
  async view(receiptText: string) {
    const ledger = await this.store.ledger();
    return {
      purchases: purchaseView(ledger),
      legacy: this.store.legacy(receiptText),
      consent: ledger.consent,
      dataScope: RECEIPT_DATA_SCOPE,
    };
  }
}
