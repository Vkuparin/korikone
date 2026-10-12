import { expect, test, vi } from "vitest";
import { collectOffers } from "../src/application/offers";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { KRuokaSite } from "../src/stores/k-ruoka-site";
import type { StoreProvider } from "../src/stores/provider";
import type { StoreContext } from "../src/domain/model";
import type { OfferSourceResult } from "../src/domain/offers";
import { personalOffer, kPersonalOffersRaw } from "./fixtures/offers";

const context: StoreContext = {
  providerId: "k-ruoka",
  storeId: "synthetic-store",
  storeName: "Synthetic",
  fulfillment: "pickup",
};
const bound = { providerId: context.providerId, storeId: context.storeId };
const ready: OfferSourceResult = {
  ...bound,
  status: "ready",
  accountKey: "k-ruoka:0123456789abcdef",
  offers: [personalOffer],
  truncated: false,
};
const now = () => new Date("2026-10-12T10:00:00Z");
function source(result: unknown = ready) {
  const readOffers = vi.fn(async () => result as OfferSourceResult);
  const forbidden = vi.fn(async () => {
    throw new Error("Unexpected catalogue/cart call");
  });
  const provider: StoreProvider = {
    id: "k-ruoka",
    capabilities: {
      catalogue: true,
      cart: true,
      orderHistory: false,
      offers: { public: false, personal: true },
    },
    readOffers,
    searchStores: forbidden,
    searchProducts: forbidden,
    getCart: forbidden,
    setQuantity: forbidden,
  };
  return { provider, readOffers, forbidden };
}

test("one active-store read retains conditional bundle authority and does not touch prices/cart", async () => {
  const { provider, readOffers, forbidden } = source();
  expect(await collectOffers(provider, context, { now })).toEqual(ready);
  expect(readOffers).toHaveBeenCalledExactlyOnceWith(context, {
    signal: undefined,
  });
  expect(forbidden).not.toHaveBeenCalled();
});

test("public and personal capabilities gate ready facts independently", async () => {
  const publicOffer = {
    ...personalOffer,
    id: "public",
    kind: "public",
    eligibility: "eligible",
    conditions: [],
  };
  const { provider } = source({
    ...ready,
    offers: [publicOffer],
    accountKey: null,
  });
  expect(await collectOffers(provider, context, { now })).toMatchObject({
    status: "error",
    code: "storeUnavailable",
  });
  provider.capabilities.offers = { public: true, personal: false };
  expect(await collectOffers(provider, context, { now })).toMatchObject({
    status: "ready",
    offers: [publicOffer],
  });
  const personalOnly = source();
  personalOnly.provider.capabilities.offers = { public: true, personal: false };
  expect(
    await collectOffers(personalOnly.provider, context, { now }),
  ).toMatchObject({ status: "error", code: "storeUnavailable" });
});

test("expired, exhausted and unavailable facts are suppressed, supported empty remains ready", async () => {
  const { provider } = source({
    ...ready,
    offers: [
      { ...personalOffer, id: "expired", validUntil: "2026-10-11" },
      { ...personalOffer, id: "exhausted", remainingRedemptions: 0 },
      {
        ...personalOffer,
        id: "unavailable",
        products: personalOffer.products.map((p) => ({
          ...p,
          available: false,
        })),
      },
    ],
    truncated: true,
  });
  expect(await collectOffers(provider, context, { now })).toMatchObject({
    status: "ready",
    offers: [],
    truncated: true,
  });
});

test.each([
  { ...bound, status: "signed-out" },
  { ...bound, status: "unsupported", reason: "no-discovery-source" },
  { ...bound, status: "error", code: "storeBlocked" },
  { ...ready, offers: [] },
])("source status $status stays distinct", async (result) => {
  expect(
    await collectOffers(source(result).provider, context, { now }),
  ).toEqual(result);
});

test("absent or unsupported capability does no discovery, search or account read", async () => {
  for (const capabilities of [undefined, { public: false, personal: false }]) {
    const { provider, readOffers, forbidden } = source();
    provider.capabilities.offers = capabilities;
    expect(await collectOffers(provider, context)).toMatchObject({
      status: "unsupported",
    });
    expect(readOffers).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  }
  const worker = vi.fn(async () => {
    throw new Error("Unexpected worker call");
  });
  expect(
    await collectOffers(new KRuokaProvider(worker), context),
  ).toMatchObject({ status: "unsupported", reason: "external-worker" });
  expect(
    await collectOffers(new SKaupatProvider(worker), {
      ...context,
      providerId: "s-kaupat",
    }),
  ).toMatchObject({ status: "unsupported", reason: "no-discovery-source" });
  expect(worker).not.toHaveBeenCalled();
});

test.each([
  { ...ready, storeId: "other" },
  { ...ready, providerId: "s-kaupat" },
])("mismatched source binding is rejected", async (result) => {
  expect(await collectOffers(source(result).provider, context)).toMatchObject({
    status: "error",
    code: "contextChanged",
  });
});

test.each([
  { ...ready, accountKey: null },
  { ...ready, offers: [personalOffer, personalOffer] },
  {
    ...ready,
    offers: Array.from({ length: 31 }, (_, n) => ({
      ...personalOffer,
      id: String(n),
    })),
  },
  {
    ...ready,
    offers: [{ ...personalOffer, eligibility: "eligible", conditions: [] }],
  },
  { ...ready, token: "must-not-leak" },
  {
    ...ready,
    offers: [
      { ...personalOffer, price: { ...personalOffer.price, amount: 3.3 } },
    ],
  },
])("malformed or unbounded source is a sanitized error", async (result) => {
  expect(await collectOffers(source(result).provider, context)).toEqual({
    ...bound,
    status: "error",
    code: "storeUnavailable",
  });
});

test("missing reader, reader throw and wrong provider do not become empty offers", async () => {
  const { provider, readOffers } = source();
  delete provider.readOffers;
  expect(await collectOffers(provider, context)).toMatchObject({
    status: "error",
    code: "storeUnavailable",
  });
  provider.readOffers = async () => {
    throw new Error("private-session-secret");
  };
  expect(await collectOffers(provider, context)).toEqual({
    ...bound,
    status: "error",
    code: "storeUnavailable",
  });
  expect(
    await collectOffers(provider, { ...context, providerId: "s-kaupat" }),
  ).toMatchObject({ status: "error", code: "contextChanged" });
  expect(readOffers).not.toHaveBeenCalled();
});

test("cancellation and active-context changes discard a result before or after discovery", async () => {
  for (const phase of ["before", "after"] as const) {
    for (const cause of ["cancelled", "contextChanged"] as const) {
      const { provider, readOffers } = source();
      const controller = new AbortController();
      let current = true;
      const change = () => {
        if (cause === "cancelled") controller.abort();
        else current = false;
      };
      if (phase === "before") change();
      else
        readOffers.mockImplementation(async () => {
          change();
          return ready;
        });
      expect(
        await collectOffers(provider, context, {
          signal: controller.signal,
          isCurrent: () => current,
        }),
      ).toMatchObject({ status: "error", code: cause });
      expect(readOffers).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
    }
  }
});

test("real embedded adapter feeds aggregation without catalogue, worker or cart writes", async () => {
  const sent: string[] = [];
  const site = new KRuokaSite(async (request) => {
    sent.push(`${request.method} ${request.path}`);
    const body =
      request.path === "/kr-api/tos-offers"
        ? kPersonalOffersRaw
        : {
            id: "synthetic-basket",
            store: { id: context.storeId, name: context.storeName },
            userInfo: { email: "synthetic@example.invalid" },
            items: [],
          };
    return {
      status: 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify(body),
    };
  }, 0);
  const provider = new KRuokaProvider(site.call, (c, o) =>
    site.readOffers(c, o),
  );
  expect(await collectOffers(provider, context, { now })).toMatchObject({
    status: "ready",
    offers: [
      expect.objectContaining({
        eligibility: "conditional",
        price: { amount: 900, basis: "pcs", quantity: 3, unitLabel: "3 kpl" },
      }),
    ],
  });
  expect(sent).toEqual([
    "POST /kr-api/basket/active",
    "POST /kr-api/tos-offers",
    "POST /kr-api/basket/active",
  ]);
});
