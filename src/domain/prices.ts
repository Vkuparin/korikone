import { z } from "zod";
import type { Product } from "./model";

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

const sameDay = (a: PriceObservation, b: PriceObservation) =>
  a.productId === b.productId &&
  a.providerId === b.providerId &&
  a.storeId === b.storeId &&
  a.date === b.date;

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
  return limitPrices(
    [...history.filter((old) => !seen.some((s) => sameDay(old, s))), ...seen],
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
