import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PURCHASES_KEY,
  backupLedger,
  deletePurchase,
  legacySource,
  mergePurchase,
  purchaseEventSchema,
  purchaseLedgerSchema,
  purchaseSourceSchema,
  purchaseLimits,
  purchaseOriginalKey,
  readLedger,
  restoreLedger,
  type PurchaseChain,
  type PurchaseLedger,
  type PurchaseMergeOutcome,
  type PurchaseSource,
} from "../domain/purchases";
import { orderPurchase, type RetailerOrder } from "../domain/order-evidence";
import { ruleAnnotations } from "../domain/receipt-semantics";
import { parseReceipt, type ReceiptParse } from "../receipts/parsers";
import type { Storage } from "./service";

export type ReceiptImport = {
  outcome: PurchaseMergeOutcome | "unsupported";
  eventId: string | null;
  lines: number;
  unreadableLines: number;
  reconciliation: "balanced" | "unbalanced" | "incomplete" | null;
};
/**
 * Identity of a receipt: the evidence that was read, not the bytes of the file. The same trip
 * exported as text or as PDF is one source; another day, time, row or amount is another. Rows
 * after the total (payment, card and loyalty details) are never read, so none can be in it.
 */
export function receiptFingerprint(
  parsed: Extract<ReceiptParse, { outcome: "event" }>,
): string {
  const { facts } = parsed;
  return fingerprintText(
    JSON.stringify([
      "receipt",
      facts.chain,
      facts.store,
      facts.purchasedAt,
      facts.lines.map((l) => [
        l.role,
        l.label,
        l.quantity.amount,
        l.quantity.unit,
        l.gross,
      ]),
      facts.adjustments.map((a) => [a.kind, a.label, a.amount]),
      facts.printed.map((p) => [p.role, p.amount]),
    ]),
  );
}
export function receiptPurchase(
  parsed: Extract<ReceiptParse, { outcome: "event" }>,
  format: "pdf" | "txt" | "csv",
  fingerprint: string,
  importedAt: string,
) {
  const id = `receipt-${fingerprint.slice(0, 24)}`;
  return {
    source: purchaseSourceSchema.parse({
      id,
      kind: "receipt",
      chain: parsed.receipt.chain,
      format,
      parser: parsed.receipt.parser,
      importedAt,
      fingerprint,
      retention: "sanitized",
      revision: 1,
      pages: parsed.receipt.pages,
      lines: parsed.receipt.lines,
      unreadableLines: parsed.receipt.unreadableLines,
    }),
    event: purchaseEventSchema.parse({ ...parsed.facts, id, sourceIds: [id] }),
  };
}

export const fingerprintText = (text: string) =>
  createHash("sha256").update(text.normalize("NFC")).digest("hex");
const originalsSchema = z
  .record(
    z.string().min(1).max(100),
    z.string().max(purchaseLimits.originalCharacters),
  )
  .refine((entries) => Object.keys(entries).length <= purchaseLimits.events);

/**
 * The purchase ledger document and the optional retained originals. Separate from `AppState`, so
 * ordinary saves, quotes and diagnostics never carry receipt contents.
 */
export class PurchaseStore {
  private writes: Promise<void> = Promise.resolve();
  constructor(private db: Storage) {}
  /** Ledger changes run one at a time, each reading the result of the one before. */
  serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async ledger(): Promise<PurchaseLedger> {
    return readLedger(await this.db.get(PURCHASES_KEY));
  }
  /** The legacy text as a source beside the ledger; it never becomes an event by itself. */
  legacy(receiptText: string): PurchaseSource | null {
    return legacySource(receiptText, fingerprintText(receiptText));
  }
  async original(sourceId: string): Promise<string | null> {
    const text = await this.db.get(purchaseOriginalKey(sourceId));
    return typeof text === "string" ? text : null;
  }
  /** One atomic write of the ledger with any originals to keep (text) or remove (null). */
  async write(
    ledger: PurchaseLedger,
    originals: { sourceId: string; text: string | null }[] = [],
  ) {
    const validated = purchaseLedgerSchema.parse(ledger);
    const entries = [
      { key: PURCHASES_KEY, value: validated as unknown },
      ...originals.map(({ sourceId, text }) => ({
        key: purchaseOriginalKey(sourceId),
        value:
          text === null
            ? null
            : z.string().max(purchaseLimits.originalCharacters).parse(text),
      })),
    ];
    // The SQLite store always commits these together. A store without `setMany` can hold only
    // the ledger itself, so it is never left pointing at an original that was not written.
    if (!this.db.setMany) {
      if (entries.length !== 1) throw new Error("storageFailed");
      await this.db.set(PURCHASES_KEY, validated);
      return validated;
    }
    const same = (x: unknown, y: unknown) =>
      JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    const prior: unknown[] = [];
    for (const entry of entries) prior.push(await this.db.get(entry.key));
    try {
      await this.db.setMany(entries);
    } catch (error) {
      // An interrupted write is read back: durable, rolled back, or unknown. It is never retried.
      const stored: unknown[] = [];
      try {
        for (const entry of entries) stored.push(await this.db.get(entry.key));
      } catch {
        throw new Error("commitUnknown");
      }
      if (entries.every((entry, i) => same(stored[i], entry.value)))
        return validated;
      if (entries.every((_, i) => same(stored[i], prior[i]))) throw error;
      throw new Error("commitUnknown");
    }
    return validated;
  }
  /** Imports order records through the shared dedupe rule, in one atomic write. */
  importOrders(orders: RetailerOrder[], chain: PurchaseChain) {
    return this.serialize(async () => {
      let ledger = await this.ledger();
      const summary = { added: 0, updated: 0, duplicate: 0 };
      const importedAt = new Date().toISOString();
      for (const order of orders) {
        const { source, event } = orderPurchase(
          order,
          chain,
          fingerprintText(`${chain}\norder\n${order.orderId}`),
          importedAt,
        );
        const merged = mergePurchase(ledger, source, event);
        ledger = merged.ledger;
        summary[merged.outcome]++;
        if (merged.outcome === "duplicate") continue;
        // Local rules read the same category metadata from order labels as from receipt rows;
        // a label they do not recognize keeps no interpretation and stays unresolved.
        const current = ledger.events.find((e) => e.id === merged.eventId)!;
        const stored = ledger.sources.find((s) =>
          current.sourceIds.includes(s.id),
        )!;
        ledger = {
          ...ledger,
          annotations: [
            ...ledger.annotations.filter(
              (a) => a.eventId !== current.id || a.origin !== "rule",
            ),
            ...ruleAnnotations(current, stored.revision, importedAt),
          ],
        };
      }
      if (summary.added || summary.updated) await this.write(ledger);
      return summary;
    });
  }
  /**
   * Parses one receipt text and commits its source, evidence, reconciliation, rule
   * interpretations and optional original in one write. An exact repeat adds nothing.
   */
  importReceipt(
    text: string,
    format: "pdf" | "txt" | "csv",
    options: { keepOriginal?: boolean } = {},
  ): Promise<ReceiptImport> {
    return this.serialize(async () => {
      const parsed = parseReceipt(text);
      if (parsed.outcome === "unsupported")
        return {
          outcome: "unsupported",
          eventId: null,
          lines: parsed.lines,
          unreadableLines: parsed.lines,
          reconciliation: null,
        };
      const importedAt = new Date().toISOString();
      const { source, event } = receiptPurchase(
        parsed,
        format,
        receiptFingerprint(parsed),
        importedAt,
      );
      const merged = mergePurchase(await this.ledger(), source, event);
      const summary = {
        outcome: merged.outcome,
        eventId: merged.eventId,
        lines: parsed.receipt.lines,
        unreadableLines: parsed.receipt.unreadableLines,
        reconciliation: parsed.facts.reconciliation.status,
      };
      const stored = merged.ledger.sources.find((s) =>
        merged.ledger.events
          .find((e) => e.id === merged.eventId)!
          .sourceIds.includes(s.id),
      )!;
      // Keeping the original is the shopper's choice per import; a repeat can add it later.
      const keep =
        options.keepOriginal === true && stored.retention !== "original";
      if (merged.outcome === "duplicate" && !keep) return summary;
      const current = merged.ledger.events.find(
        (e) => e.id === merged.eventId,
      )!;
      await this.write(
        {
          ...merged.ledger,
          sources: merged.ledger.sources.map((s) =>
            s.id === stored.id && keep ? { ...s, retention: "original" } : s,
          ),
          annotations:
            merged.outcome === "duplicate"
              ? merged.ledger.annotations
              : [
                  ...merged.ledger.annotations.filter(
                    (a) => a.eventId !== current.id || a.origin !== "rule",
                  ),
                  ...ruleAnnotations(current, stored.revision, importedAt),
                ],
        },
        keep
          ? [
              {
                sourceId: stored.id,
                text: text.slice(0, purchaseLimits.originalCharacters),
              },
            ]
          : [],
      );
      return summary;
    });
  }
  delete(input: unknown) {
    return this.serialize(async () => {
      const result = deletePurchase(await this.ledger(), input);
      return this.write(
        result.ledger,
        result.originals.map((sourceId) => ({ sourceId, text: null })),
      );
    });
  }
  /** Backup fields: sanitized records always, retained originals only when asked for. */
  async backup(includeOriginals = false) {
    const ledger = await this.ledger();
    const originals: Record<string, string> = {};
    if (includeOriginals)
      for (const source of ledger.sources) {
        const text =
          source.retention === "original"
            ? await this.original(source.id)
            : null;
        if (text !== null) originals[source.id] = text;
      }
    return {
      purchases: backupLedger(ledger),
      ...(includeOriginals ? { purchaseOriginals: originals } : {}),
    };
  }
  /** Replaces the ledger from a backup that carries one; a backup without one changes nothing. */
  restore(raw: unknown) {
    if (!raw || typeof raw !== "object" || !("purchases" in raw))
      return Promise.resolve(null);
    const originals =
      "purchaseOriginals" in raw
        ? originalsSchema.parse(raw.purchaseOriginals)
        : {};
    const next = restoreLedger(raw.purchases, new Set(Object.keys(originals)));
    return this.serialize(async () => {
      const previous = await this.ledger();
      const kept = new Set(
        next.sources.filter((s) => s.retention === "original").map((s) => s.id),
      );
      return this.write(next, [
        // Originals of the replaced ledger do not outlive it.
        ...previous.sources
          .filter((s) => s.retention === "original" && !kept.has(s.id))
          .map((s) => ({ sourceId: s.id, text: null })),
        ...[...kept].map((sourceId) => ({
          sourceId,
          text: originals[sourceId],
        })),
      ]);
    });
  }
}
