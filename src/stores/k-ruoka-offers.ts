import { createHash } from "node:crypto";
import { z } from "zod";
import {
  currentOffer,
  offerDateSchema,
  offerLimits,
  retailerOfferSchema,
  type RetailerOffer,
} from "../domain/offers";

const text = z.string().trim().min(1).max(500);
const euros = z.number().finite().nonnegative().max(1_000_000);
// Extra retailer fields are discarded, never forwarded to inference or diagnostics.
export const kPersonalOffersSchema = z.object({
  offers: z
    .array(
      z.object({
        localizedTitle: z.object({ finnish: text }),
        pricing: z
          .object({
            price: euros.nullish(),
            unit: z.object({ fi: z.string().max(100).nullish() }).nullish(),
          })
          .nullish(),
        normalPricing: z.object({ price: euros.nullish() }).nullish(),
        remainingQuantity: z
          .number()
          .int()
          .nonnegative()
          .max(1_000_000)
          .nullish(),
        validUntil: offerDateSchema.nullish(),
        products: z
          .array(
            z.object({
              product: z.object({
                ean: z.string().regex(/^\d{8,14}$/),
                localizedName: z.object({ finnish: text }),
                isAvailable: z.boolean().nullish(),
              }),
            }),
          )
          .min(1)
          .max(offerLimits.products),
      }),
    )
    .max(offerLimits.rawOffers),
});

export function normalizeKPersonalOffers(raw: unknown, now = new Date()) {
  const source = kPersonalOffersSchema.parse(raw);
  const unique = new Map<string, RetailerOffer>();
  for (const item of source.offers) {
    const unitLabel = item.pricing?.unit?.fi ?? null;
    const label = unitLabel?.trim().toLowerCase();
    const pieces = label?.match(/^(?:(\d+)\s*)?kpl$/);
    const count = pieces ? Number(pieces[1] ?? 1) : null;
    const basis =
      count && count <= 100
        ? "pcs"
        : label === "kg"
          ? "kg"
          : label === "l"
            ? "l"
            : "unknown";
    const conditions: RetailerOffer["conditions"] = [
      "plussa-required",
      "activation-unverified",
    ];
    if (!item.validUntil) conditions.push("validity-unknown");
    if (item.remainingQuantity == null) conditions.push("redemptions-unknown");
    if (basis === "unknown") conditions.push("price-basis-unknown");
    const facts = {
      kind: "personal" as const,
      title: item.localizedTitle.finnish,
      products: item.products.map((p) => ({
        id: p.product.ean,
        name: p.product.localizedName.finnish,
        available: p.product.isAvailable ?? null,
      })),
      price: {
        amount:
          item.pricing?.price == null
            ? null
            : Math.round(item.pricing.price * 100),
        basis,
        quantity: basis === "unknown" ? null : basis === "pcs" ? count : 1,
        unitLabel,
      },
      normalPrice:
        item.normalPricing?.price == null
          ? null
          : Math.round(item.normalPricing.price * 100),
      validUntil: item.validUntil ?? null,
      remainingRedemptions: item.remainingQuantity ?? null,
      eligibility: "conditional" as const,
      conditions,
    };
    const id = `k-personal:${createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 24)}`;
    const offer = retailerOfferSchema.parse({ id, ...facts });
    if (currentOffer(offer, now)) unique.set(id, offer);
  }
  return {
    offers: [...unique.values()].slice(0, offerLimits.offers),
    truncated: unique.size > offerLimits.offers,
  };
}
