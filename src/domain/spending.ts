import type { ActualPurchase } from "./purchase-links";
import type { TransferRecord } from "./memory";

/**
 * Weekly spending from confirmed purchases (F8.1). Only deduplicated completed purchases count
 * as actual spending; a verified transfer that no purchase confirms may appear beside them as a
 * separately labelled estimate and is never summed into the actual figure. Nothing is allocated,
 * guessed or filled: an unknown total, an undated purchase and a breakdown the receipt does not
 * print stay visible as such.
 *
 * Weeks run Monday to Sunday and are read from the UTC date stored on the purchase. A purchase
 * with day precision sits at the start of its day, so a late-evening receipt is placed by its
 * recorded instant, not by a guess about the shopper's clock.
 */

const DAY = 86_400_000;

export type SpendingWeek = {
  /** Monday, `YYYY-MM-DD`. */
  start: string;
  /** Sunday, `YYYY-MM-DD`. */
  end: string;
  purchases: number;
  /** Sum of the known totals of this week's purchases, in cents. */
  actual: number;
  /** Purchases of the week whose total is not known; the sum above leaves them out. */
  unknownTotals: number;
  /** Purchases whose linked records print different totals. The authoritative total is used. */
  conflicting: number;
  /**
   * Printed food and non-food subtotals, summed over the purchases that print them. A purchase
   * without a printed breakdown adds to `withoutBreakdown` and to neither amount.
   */
  breakdown: {
    food: number;
    nonFood: number;
    withBreakdown: number;
    withoutBreakdown: number;
  };
  /** `complete` when every purchase of the week has a known total, `none` for an empty week. */
  coverage: "complete" | "partial" | "none";
  /** Unconfirmed transfers of the week. An estimate, never spending. */
  transferEstimate: {
    transfers: number;
    amount: number;
    /** Transferred products with no recorded price: the estimate is then a lower bound. */
    unknownItems: number;
  };
};

export type Spending = {
  /** Oldest first. */
  weeks: SpendingWeek[];
  /** Purchases with no date: counted, never placed in a week. */
  undated: { purchases: number; actual: number; unknownTotals: number };
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Monday 00:00 UTC of the week containing the instant. */
export function weekStartMs(ms: number) {
  const day = Math.floor(ms / DAY);
  // 1970-01-01 was a Thursday: day 0 is Thursday, so Monday is day - ((day + 3) mod 7).
  return (day - ((((day + 3) % 7) + 7) % 7)) * DAY;
}

export function spendingWeeks(
  purchases: ActualPurchase[],
  transfers: TransferRecord[],
  now: Date,
  options: { weeks?: number; confirmedTransferIds?: string[] } = {},
): Spending {
  const count = options.weeks ?? 12;
  const confirmed = new Set(options.confirmedTransferIds ?? []);
  const thisWeek = weekStartMs(now.getTime());
  const weeks: SpendingWeek[] = Array.from({ length: count }, (_, i) => {
    const start = thisWeek - (count - 1 - i) * 7 * DAY;
    return {
      start: iso(start),
      end: iso(start + 6 * DAY),
      purchases: 0,
      actual: 0,
      unknownTotals: 0,
      conflicting: 0,
      breakdown: { food: 0, nonFood: 0, withBreakdown: 0, withoutBreakdown: 0 },
      coverage: "none",
      transferEstimate: { transfers: 0, amount: 0, unknownItems: 0 },
    };
  });
  const undated = { purchases: 0, actual: 0, unknownTotals: 0 };
  const indexOf = (ms: number) => {
    const offset = (weekStartMs(ms) - Date.parse(weeks[0].start)) / (7 * DAY);
    return Number.isInteger(offset) && offset >= 0 && offset < count
      ? offset
      : -1;
  };

  for (const purchase of purchases) {
    const ms = purchase.purchasedAt ? Date.parse(purchase.purchasedAt) : NaN;
    if (!Number.isFinite(ms)) {
      undated.purchases++;
      if (purchase.total === null) undated.unknownTotals++;
      else undated.actual += purchase.total;
      continue;
    }
    const at = indexOf(ms);
    if (at < 0) continue;
    const week = weeks[at];
    week.purchases++;
    if (purchase.total === null) week.unknownTotals++;
    else week.actual += purchase.total;
    if (purchase.conflictingTotals) week.conflicting++;
    if (purchase.foodSubtotal !== null && purchase.nonFoodSubtotal !== null) {
      week.breakdown.food += purchase.foodSubtotal;
      week.breakdown.nonFood += purchase.nonFoodSubtotal;
      week.breakdown.withBreakdown++;
    } else week.breakdown.withoutBreakdown++;
  }
  for (const week of weeks)
    week.coverage = !week.purchases
      ? "none"
      : week.unknownTotals
        ? "partial"
        : "complete";

  for (const transfer of transfers) {
    if (confirmed.has(transfer.id)) continue;
    const ms = Date.parse(transfer.date);
    if (!Number.isFinite(ms)) continue;
    const at = indexOf(ms);
    if (at < 0) continue;
    const estimate = weeks[at].transferEstimate;
    estimate.transfers++;
    for (const item of transfer.items) {
      if (item.price > 0) estimate.amount += item.price * item.quantity;
      else estimate.unknownItems++;
    }
  }
  return { weeks, undated };
}
