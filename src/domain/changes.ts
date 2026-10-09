import type { Review, StoreContext } from "./model";

type Line = {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
};
export type Changes = {
  /** The last transfer went to another store, so its products are not comparable. */
  storeChanged: boolean;
  added: Line[];
  dropped: Line[];
  quantity: { name: string; unit: string; before: number; now: number }[];
  price: { name: string; before: number; now: number }[];
};

export const storeKey = (context: StoreContext) =>
  `${context.providerId}:${context.storeId}`;

/**
 * What this review changes compared with the newest verified transfer (`history` is newest first):
 * new and dropped products, changed quantities and changed pack prices. Returns null when there
 * is nothing to compare with: no earlier transfer, or one saved before its products were kept.
 */
export function compareTransfers(
  review: Pick<Review, "context" | "targets">,
  history: { storeKey: string; transferred: Line[] }[],
): Changes | null {
  const last = history[0];
  if (!last || !last.storeKey) return null;
  const empty = { added: [], dropped: [], quantity: [], price: [] };
  if (last.storeKey !== storeKey(review.context))
    return { storeChanged: true, ...empty };
  const before = new Map(last.transferred.map((l) => [l.productId, l]));
  const now = new Map(review.targets.map((t) => [t.productId, t]));
  const changes: Changes = { storeChanged: false, ...empty };
  for (const t of review.targets) {
    const old = before.get(t.productId);
    if (!old) {
      changes.added.push(t);
      continue;
    }
    if (old.quantity !== t.quantity)
      changes.quantity.push({
        name: t.name,
        unit: t.unit,
        before: old.quantity,
        now: t.quantity,
      });
    if (old.price !== t.price)
      changes.price.push({ name: t.name, before: old.price, now: t.price });
  }
  changes.dropped = last.transferred.filter((l) => !now.has(l.productId));
  return changes;
}

export const hasChanges = (c: Changes) =>
  c.added.length + c.dropped.length + c.quantity.length + c.price.length > 0;
