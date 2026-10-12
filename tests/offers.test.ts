import { expect, test } from "vitest";
import {
  retailerOfferSchema,
  offerSourceResultSchema,
  currentOffer,
} from "../src/domain/offers";
import { personalOffer } from "./fixtures/offers";

test("offer contract preserves conditional bundle prices and rejects unconditional personal eligibility", () => {
  expect(retailerOfferSchema.parse(personalOffer).price).toEqual({
    amount: 900,
    basis: "pcs",
    quantity: 3,
    unitLabel: "3 kpl",
  });
  for (const changed of [
    { ...personalOffer, eligibility: "eligible" },
    { ...personalOffer, conditions: [] },
    { ...personalOffer, price: { ...personalOffer.price, basis: "unknown" } },
    {
      ...personalOffer,
      products: [...personalOffer.products, ...personalOffer.products],
    },
  ])
    expect(retailerOfferSchema.safeParse(changed).success).toBe(false);
});
test("supported empty, unsupported, signed-out and error are distinct; account binding stays private and bounded", () => {
  const bound = { providerId: "k-ruoka", storeId: "fixture-store" };
  for (const result of [
    {
      ...bound,
      status: "ready",
      accountKey: "k-ruoka:0123456789abcdef",
      offers: [],
      truncated: false,
    },
    { ...bound, status: "unsupported", reason: "no-discovery-source" },
    { ...bound, status: "signed-out" },
    { ...bound, status: "error", code: "storeUnavailable" },
  ])
    expect(offerSourceResultSchema.parse(result).status).toBe(result.status);
  const ready = {
    ...bound,
    status: "ready",
    accountKey: null,
    offers: [personalOffer],
    truncated: false,
  };
  expect(offerSourceResultSchema.safeParse(ready).success).toBe(false);
  expect(
    offerSourceResultSchema.safeParse({
      ...ready,
      accountKey: "owner@example.com",
    }).success,
  ).toBe(false);
  expect(
    offerSourceResultSchema.safeParse({
      ...ready,
      accountKey: "k-ruoka:0123456789abcdef",
      offers: Array.from({ length: 31 }, (_, n) => ({
        ...personalOffer,
        id: `fixture-${n}`,
      })),
    }).success,
  ).toBe(false);
  expect(
    offerSourceResultSchema.safeParse({
      ...bound,
      status: "signed-out",
      token: "private",
    }).success,
  ).toBe(false);
});
test("offer expiry follows Finland day boundaries and exhausted/unavailable offers cannot be current", () => {
  const offer = { ...personalOffer, validUntil: "2026-10-12" };
  expect(currentOffer(offer, new Date("2026-10-12T20:59:59Z"))).toBe(true);
  expect(currentOffer(offer, new Date("2026-10-12T21:00:00Z"))).toBe(false);
  expect(
    currentOffer(
      { ...offer, validUntil: "2026-10-12T10:00:00+03:00" },
      new Date("2026-10-12T07:00:00Z"),
    ),
  ).toBe(false);
  expect(
    currentOffer(
      { ...offer, remainingRedemptions: 0 },
      new Date("2026-10-12T10:00:00Z"),
    ),
  ).toBe(false);
  expect(
    currentOffer(
      {
        ...offer,
        products: offer.products.map((p) => ({ ...p, available: null })),
      },
      new Date("2026-10-12T10:00:00Z"),
    ),
  ).toBe(false);
});
