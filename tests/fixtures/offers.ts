import type { RetailerOffer } from "../../src/domain/offers";

// Independently authored source-shaped examples; no owner account or offer capture.
export const kPersonalOffersRaw = {
  offers: [
    {
      localizedTitle: { finnish: "Synteettinen kahvitarjous" },
      pricing: { price: 9, unit: { fi: "3 kpl" }, discountPercentage: "-40 %" },
      normalPricing: { price: 15 },
      remainingQuantity: 2,
      validUntil: "2030-01-01",
      products: [
        {
          product: {
            ean: "2000000000011",
            localizedName: { finnish: "Synteettinen kahvi 500 g" },
            isAvailable: true,
          },
        },
      ],
    },
  ],
};
export const personalOffer: RetailerOffer = {
  id: "synthetic-coffee-bundle",
  kind: "personal",
  title: "Synteettinen kahvitarjous",
  products: [
    { id: "2000000000011", name: "Synteettinen kahvi 500 g", available: true },
  ],
  price: { amount: 900, basis: "pcs", quantity: 3, unitLabel: "3 kpl" },
  normalPrice: 1500,
  validUntil: "2030-01-01",
  remainingRedemptions: 2,
  eligibility: "conditional",
  conditions: ["plussa-required", "activation-unverified"],
};
