import { reconcile } from "../../domain/receipt-accounting";
import {
  purchaseEventSchema,
  sanitizeLabel,
  type PurchaseEvent,
} from "../../domain/purchases";
import { parseKGroup } from "./k-group";
import { parseSGroup } from "./s-group";
import { receiptRows, type ParsedReceipt } from "./shared";

export type ReceiptParse =
  | {
      outcome: "event";
      receipt: ParsedReceipt;
      /** The evidence as an event without IDs; the importer assigns those. */
      facts: Omit<PurchaseEvent, "id" | "sourceIds">;
    }
  /** Not a receipt of a supported layout: every row is unreadable and nothing was bought. */
  | { outcome: "unsupported"; pages: number; lines: number };

/**
 * Parses receipt text locally and deterministically. The layout is chosen from the shop name on
 * the first row; a file of another kind is `unsupported` rather than read loosely. The text is
 * data only: nothing in it can change how it is read.
 */
export function parseReceipt(text: string): ReceiptParse {
  const { rows, pages } = receiptRows(text);
  const receipt = parseSGroup(rows, pages) ?? parseKGroup(rows, pages);
  // A shop name alone is not a receipt: at least one row must have been read as evidence.
  if (!receipt || !receipt.evidence.some((line) => line.role !== "unreadable"))
    return { outcome: "unsupported", pages, lines: rows.length };
  // Validated as a whole event under placeholder IDs, which the importer replaces.
  const {
    id: _id,
    sourceIds: _sourceIds,
    ...facts
  } = purchaseEventSchema.parse({
    id: "pending",
    sourceIds: ["pending"],
    origin: "receipt",
    status: "completed",
    chain: receipt.chain,
    store: receipt.store ? sanitizeLabel(receipt.store) : null,
    purchasedAt: receipt.purchasedAt,
    datePrecision: receipt.datePrecision,
    lines: receipt.evidence,
    adjustments: receipt.adjustments,
    printed: receipt.printed,
    reconciliation: reconcile({
      lines: receipt.evidence,
      adjustments: receipt.adjustments,
      printed: receipt.printed,
    }),
  });
  return { outcome: "event", receipt, facts };
}
export { receiptRows, receiptLimits, type ParsedReceipt } from "./shared";
