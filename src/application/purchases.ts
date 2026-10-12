import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PURCHASES_KEY,
  backupLedger,
  deletePurchase,
  legacySource,
  mergePurchase,
  purchaseLedgerSchema,
  purchaseLimits,
  purchaseOriginalKey,
  readLedger,
  restoreLedger,
  type PurchaseChain,
  type PurchaseLedger,
  type PurchaseSource,
} from "../domain/purchases";
import { orderPurchase, type RetailerOrder } from "../domain/order-evidence";
import type { Storage } from "./service";

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
    if (this.db.setMany) await this.db.setMany(entries);
    else if (entries.length === 1) await this.db.set(PURCHASES_KEY, validated);
    else throw new Error("storageFailed");
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
      }
      if (summary.added || summary.updated) await this.write(ledger);
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
