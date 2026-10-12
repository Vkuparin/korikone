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
  enrichmentConsentSchema,
} from "../domain/receipt-semantics";
import type { PurchaseStore, ReceiptImport } from "./purchases";
import { runReceiptEnrichment } from "./receipt-enrichment";

/** The selected AI provider and a way to get a one-call session from it. */
export type ReceiptAI = {
  providerId: string;
  session: () => Promise<InferenceSession>;
};
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
   * Imports a receipt and, only for a newly added or changed purchase with saved automatic
   * consent for the selected provider, enriches it. Any enrichment outcome leaves the import done.
   */
  async import(
    text: string,
    format: "pdf" | "txt" | "csv",
    options: { keepOriginal?: boolean; ai?: ReceiptAI | null } = {},
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
