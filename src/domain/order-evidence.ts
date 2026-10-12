import { z } from "zod";
import {
  purchaseEventSchema,
  purchaseLimits,
  purchaseSourceSchema,
  sanitizeLabel,
  type PurchaseChain,
  type PurchaseEvent,
  type PurchaseSource,
} from "./purchases";

export const ORDER_PARSER = Object.freeze({ id: "retailer-order", version: 1 });
/**
 * A retailer's own record of one order, as a store adapter reads it. Money is integer cents here;
 * adapters convert once at the boundary. It holds no address, contact, payment or pickup code.
 */
export const retailerOrderSchema = z
  .object({
    orderId: z.string().min(1).max(200),
    state: z.enum(["completed", "pending", "cancelled", "unknown"]),
    storeName: z.string().max(200).nullable(),
    /** The delivery or pickup day, `YYYY-MM-DD`, when the retailer reports one. */
    date: z.iso.date().nullable(),
    /** The total the retailer shows, including any fees. */
    total: z.number().int().min(0).max(purchaseLimits.cents).nullable(),
    /** Null when the rows could not be read; the order is then kept with no lines. */
    items: z
      .array(
        z
          .object({
            name: z.string().max(500).nullable(),
            /** Pieces, or kilograms for products sold by weight. */
            quantity: z.number().positive().max(100_000).nullable(),
            unit: z.enum(["pcs", "kg"]).nullable(),
            /** Price of one piece or one kilogram when the order was placed. */
            unitPrice: z
              .number()
              .int()
              .min(0)
              .max(purchaseLimits.cents)
              .nullable(),
          })
          .strict(),
      )
      .max(purchaseLimits.lines)
      .nullable(),
  })
  .strict();
export type RetailerOrder = z.infer<typeof retailerOrderSchema>;

/**
 * Turns an order record into purchase evidence. Quantities and unit prices are the order's own;
 * line totals are not reported by the retailer and stay unknown, as does the paid amount of a
 * weighed row. `identity` is a digest of chain and order ID, so the ID itself is never stored.
 */
export function orderPurchase(
  input: unknown,
  chain: PurchaseChain,
  identity: string,
  importedAt: string,
): { source: PurchaseSource; event: PurchaseEvent } {
  const order = retailerOrderSchema.parse(input);
  const id = `order-${identity.slice(0, 24)}`;
  const items = order.items ?? [];
  const source = purchaseSourceSchema.parse({
    id,
    kind: "order",
    chain,
    format: "order",
    parser: ORDER_PARSER,
    importedAt,
    fingerprint: identity,
    retention: "sanitized",
    revision: 1,
    pages: null,
    lines: items.length,
    unreadableLines: 0,
  });
  const lines = items.map((item, index) => {
    const grams =
      item.unit === "kg" && item.quantity !== null
        ? Math.round(item.quantity * 1000)
        : null;
    const amount =
      item.quantity === null || item.unit === null
        ? null
        : item.unit === "kg"
          ? grams
          : Number.isInteger(item.quantity)
            ? item.quantity
            : null;
    const known = amount !== null && amount > 0;
    return {
      id: `l${index + 1}`,
      role: "product" as const,
      label: sanitizeLabel(item.name ?? ""),
      span: { page: null, line: index + 1, endLine: index + 1 },
      quantity: known
        ? {
            amount,
            unit: item.unit === "kg" ? ("g" as const) : ("pcs" as const),
            provenance: "source" as const,
          }
        : { amount: null, unit: null, provenance: "unknown" as const },
      unitPrice: item.unit === null ? null : item.unitPrice,
      unitPriceBasis:
        item.unit === null || item.unitPrice === null ? null : item.unit,
      gross: null,
      net: null,
      provenance: "source" as const,
    };
  });
  const event = purchaseEventSchema.parse({
    id,
    sourceIds: [id],
    origin: "order",
    status: order.state,
    chain,
    store: order.storeName ? sanitizeLabel(order.storeName) : null,
    purchasedAt: order.date ? `${order.date}T00:00:00.000Z` : null,
    datePrecision: order.date ? "day" : "unknown",
    lines,
    adjustments: [],
    printed:
      order.total === null
        ? []
        : [
            {
              role: "total",
              amount: order.total,
              span: { page: null, line: 1, endLine: 1 },
            },
          ],
    // An order reports unit prices and one total with fees, so nothing can be added up from it.
    reconciliation: {
      status: "incomplete",
      computedTotal: null,
      printedTotal: order.total,
      difference: null,
      reasons: [
        ...(order.total === null ? (["no-printed-total"] as const) : []),
        "missing-line-amount",
      ],
    },
  });
  return { source, event };
}
