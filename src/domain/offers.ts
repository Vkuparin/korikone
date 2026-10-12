import { z } from "zod";

export const offerLimits = Object.freeze({
  offers: 30,
  rawOffers: 200,
  products: 20,
  responseBytes: 262_144,
});
const cents = z.number().int().nonnegative().max(100_000_000);
export const offerDateSchema = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }),
]);
export const offerConditionSchema = z.enum([
  "plussa-required",
  "activation-unverified",
  "validity-unknown",
  "redemptions-unknown",
  "price-basis-unknown",
]);
export const retailerOfferSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["public", "personal"]),
    title: z.string().min(1).max(500),
    products: z
      .array(
        z
          .object({
            id: z.string().regex(/^\d{8,14}$/),
            name: z.string().min(1).max(500),
            available: z.boolean().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(offerLimits.products),
    price: z
      .object({
        amount: cents.nullable(),
        basis: z.enum(["pcs", "kg", "l", "unknown"]),
        quantity: z.number().int().positive().max(100).nullable(),
        unitLabel: z.string().max(100).nullable(),
      })
      .strict(),
    // The source does not establish a comparable per-item basis for this value.
    normalPrice: cents.nullable(),
    validUntil: offerDateSchema.nullable(),
    remainingRedemptions: z
      .number()
      .int()
      .nonnegative()
      .max(1_000_000)
      .nullable(),
    eligibility: z.enum(["eligible", "conditional"]),
    conditions: z.array(offerConditionSchema).max(5),
  })
  .strict()
  .superRefine((offer, ctx) => {
    const issue = () =>
      ctx.addIssue({ code: "custom", message: "Invalid offer conditions" });
    if (
      new Set(offer.products.map((p) => p.id)).size !== offer.products.length ||
      new Set(offer.conditions).size !== offer.conditions.length
    )
      issue();
    if (
      offer.kind === "personal" &&
      (offer.eligibility !== "conditional" ||
        !offer.conditions.includes("plussa-required") ||
        !offer.conditions.includes("activation-unverified"))
    )
      issue();
    if (
      offer.validUntil === null &&
      !offer.conditions.includes("validity-unknown")
    )
      issue();
    if (
      offer.kind === "personal" &&
      offer.remainingRedemptions === null &&
      !offer.conditions.includes("redemptions-unknown")
    )
      issue();
    if (
      offer.price.basis === "unknown"
        ? offer.price.quantity !== null ||
          !offer.conditions.includes("price-basis-unknown")
        : offer.price.quantity === null
    )
      issue();
    if (
      offer.price.basis !== "pcs" &&
      offer.price.quantity !== null &&
      offer.price.quantity !== 1
    )
      issue();
    if (offer.eligibility === "eligible" && offer.conditions.length) issue();
  });
export type RetailerOffer = z.infer<typeof retailerOfferSchema>;
export const offerCapabilitiesSchema = z
  .object({ public: z.boolean(), personal: z.boolean() })
  .strict();
export type OfferCapabilities = z.infer<typeof offerCapabilitiesSchema>;
const bound = {
  providerId: z.string().min(1).max(100),
  storeId: z.string().min(1).max(100),
};
export const offerSourceResultSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        ...bound,
        status: z.literal("unsupported"),
        reason: z.enum(["no-discovery-source", "external-worker"]),
      })
      .strict(),
    z.object({ ...bound, status: z.literal("signed-out") }).strict(),
    z
      .object({
        ...bound,
        status: z.literal("error"),
        code: z.enum([
          "storeUnavailable",
          "storeBlocked",
          "contextChanged",
          "accountChanged",
          "cancelled",
        ]),
      })
      .strict(),
    z
      .object({
        ...bound,
        status: z.literal("ready"),
        accountKey: z
          .string()
          .regex(/^k-ruoka:[a-f0-9]{16}$/)
          .nullable(),
        offers: z.array(retailerOfferSchema).max(offerLimits.offers),
        truncated: z.boolean(),
      })
      .strict(),
  ])
  .superRefine((result, ctx) => {
    if (result.status !== "ready") return;
    if (
      new Set(result.offers.map((o) => o.id)).size !== result.offers.length ||
      (result.offers.some((o) => o.kind === "personal") && !result.accountKey)
    )
      ctx.addIssue({ code: "custom", message: "Invalid offer source binding" });
  });
export type OfferSourceResult = z.infer<typeof offerSourceResultSchema>;
export type OfferReadOptions = { signal?: AbortSignal };

/** Date-only offer expiry is inclusive through the retailer's Finnish calendar day. */
export function currentOffer(offer: RetailerOffer, now = new Date()): boolean {
  if (
    !retailerOfferSchema.safeParse(offer).success ||
    offer.remainingRedemptions === 0 ||
    !offer.products.some((p) => p.available === true)
  )
    return false;
  if (offer.validUntil === null) return true;
  if (offer.validUntil.length === 10) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = (type: string) => parts.find((p) => p.type === type)!.value;
    return (
      offer.validUntil >= `${value("year")}-${value("month")}-${value("day")}`
    );
  }
  return new Date(offer.validUntil).getTime() > now.getTime();
}
