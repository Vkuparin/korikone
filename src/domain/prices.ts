import { z } from "zod";
import type { BasketLine, Product } from "./model";

/** One price seen at one store on one day. Kept outside AppState, under the `prices:` key prefix. */
export const priceObservationSchema = z.object({
  productId: z.string().min(1),
  providerId: z.string().min(1),
  storeId: z.string().min(1),
  /** Local calendar day, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Euro cents for the whole pack. */
  price: z.number().int().nonnegative(),
  /** Euro cents per unit of the pack (kg, l or piece); null when the pack size is unknown. */
  unitPrice: z.number().nonnegative().nullable(),
});
export type PriceObservation = z.infer<typeof priceObservationSchema>;
export const priceObservationsSchema = z.array(priceObservationSchema);

export const PRICE_KEY = "prices:observations";
export const MAX_PRICE_DAYS = 365;
export const MAX_PRICE_ENTRIES = 20_000;

/** Public campaign evidence is independent of locally observed price changes. */
export function currentOffer(product: Product, now = new Date()): boolean {
  const pricing = product.cataloguePricing;
  return (
    product.providerId === "s-kaupat" &&
    pricing?.campaignPrice != null &&
    pricing.amount === pricing.campaignPrice &&
    (pricing.campaignValidUntil == null ||
      pricing.campaignValidUntil >= day(now))
  );
}

/** Compare today's unit price with the last eight earlier observations at this store. */
export function cheaperThanUsual(
  product: Product,
  history: PriceObservation[],
  now = new Date(),
): boolean {
  if (product.price == null || product.packAmount <= 0) return false;
  const previous = history
    .filter(
      (entry) =>
        entry.productId === product.id &&
        entry.providerId === product.providerId &&
        entry.storeId === product.storeId &&
        entry.date < day(now),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .filter((entry) => entry.unitPrice != null)
    .map((entry) => entry.unitPrice!)
    .sort((a, b) => a - b);
  if (previous.length < 4) return false;
  const middle = Math.floor(previous.length / 2);
  const median =
    previous.length % 2
      ? previous[middle]
      : (previous[middle - 1] + previous[middle]) / 2;
  return median > 0 && product.price / product.packAmount <= median * 0.9;
}

const dayKey = (o: PriceObservation) =>
  JSON.stringify([o.productId, o.providerId, o.storeId, o.date]);

const day = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Adds today's prices to the history. A product seen again the same day replaces its earlier entry.
 * Entries older than 365 days go first, then the oldest entries beyond 20,000.
 */
export function recordPrices(
  history: PriceObservation[],
  products: Product[],
  now = new Date(),
): PriceObservation[] {
  const date = day(now);
  const seen = products.flatMap((p): PriceObservation[] =>
    p.price === null
      ? []
      : [
          {
            productId: p.id,
            providerId: p.providerId,
            storeId: p.storeId,
            date,
            price: Math.round(p.price),
            unitPrice: p.packAmount > 0 ? p.price / p.packAmount : null,
          },
        ],
  );
  // Today's observations replace the same product's entry for today. A key set keeps this
  // linear in history size instead of history × products (B5.10).
  const replaced = new Set(seen.map(dayKey));
  return limitPrices(
    [...history.filter((old) => !replaced.has(dayKey(old))), ...seen],
    now,
  );
}

export function limitPrices(
  history: PriceObservation[],
  now = new Date(),
): PriceObservation[] {
  const cutoff = day(new Date(now.getTime() - MAX_PRICE_DAYS * 86_400_000));
  const kept = history
    .filter((o) => o.date > cutoff)
    // Stable sort keeps insertion order within a day, so the newest write survives a cut.
    .sort((a, b) => a.date.localeCompare(b.date));
  return kept.length > MAX_PRICE_ENTRIES
    ? kept.slice(kept.length - MAX_PRICE_ENTRIES)
    : kept;
}

export type PriceRise = {
  productId: string;
  name: string;
  before: number;
  now: number;
};

/** A rise over this share of the price paid at the last verified transfer is worth a look. */
export const PRICE_RISE_LIMIT = 0.05;

/**
 * Products whose pack price is now more than 5 % above what the last verified transfer
 * that included them paid. `history` is newest first. Falls and products never bought are left out.
 */
export function priceRises(
  quotes: BasketLine[],
  history: { prices: Record<string, number> }[],
): PriceRise[] {
  return quotes.flatMap((line) => {
    const p = line.product;
    if (!p || p.price === null) return [];
    const before = history.find((h) => p.id in h.prices)?.prices[p.id];
    return before !== undefined && p.price > before * (1 + PRICE_RISE_LIMIT)
      ? [{ productId: p.id, name: p.name, before, now: p.price }]
      : [];
  });
}
