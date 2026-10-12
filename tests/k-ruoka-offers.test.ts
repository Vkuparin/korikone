import { expect, test } from "vitest";
import { KRuokaSite, type PageRequest } from "../src/stores/k-ruoka-site";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { normalizeKPersonalOffers } from "../src/stores/k-ruoka-offers";
import { offerLimits } from "../src/domain/offers";
import { kPersonalOffersRaw } from "./fixtures/offers";
import type { StoreContext } from "../src/domain/model";

const context: StoreContext = {
  providerId: "k-ruoka",
  storeId: "synthetic-store",
  storeName: "Synthetic",
  fulfillment: "pickup",
};
const basket = {
  id: "synthetic-basket",
  store: { id: context.storeId, name: "Synthetic" },
  userInfo: { email: "synthetic@example.invalid" },
  items: [],
};
type Request = Parameters<PageRequest>[0];
function boundary(
  answer?: (
    request: Request,
    index: number,
  ) => Partial<Awaited<ReturnType<PageRequest>>> | undefined,
) {
  const sent: Request[] = [];
  const site = new KRuokaSite(async (request) => {
    sent.push(request);
    return {
      status: 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify(
        request.path === "/kr-api/tos-offers" ? kPersonalOffersRaw : basket,
      ),
      ...answer?.(request, sent.length),
    };
  }, 0);
  const provider = new KRuokaProvider(site.call, (c, o) =>
    site.readOffers(c, o),
  );
  return { site, provider, sent };
}
const rawOffer = () => structuredClone(kPersonalOffersRaw.offers[0]);

test("embedded personal offers retain conditional bundle facts and private account binding", async () => {
  const { provider, sent } = boundary();
  const result = await provider.readOffers(context);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("not ready");
  expect(result.accountKey).toMatch(/^k-ruoka:[a-f0-9]{16}$/);
  expect(JSON.stringify(result)).not.toContain("example.invalid");
  expect(result.offers[0]).toMatchObject({
    eligibility: "conditional",
    conditions: ["plussa-required", "activation-unverified"],
    price: { amount: 900, basis: "pcs", quantity: 3 },
    normalPrice: 1500,
    remainingRedemptions: 2,
  });
  expect(sent.map((r) => [r.method, r.path])).toEqual([
    ["POST", "/kr-api/basket/active"],
    ["POST", "/kr-api/tos-offers"],
    ["POST", "/kr-api/basket/active"],
  ]);
  expect(sent[1].body).toEqual({ storeId: context.storeId });
  expect(provider.capabilities.offers).toEqual({
    public: false,
    personal: true,
  });
});

test("normalization suppresses expired, exhausted and unavailable offers; unknown facts stay conditional", () => {
  const expired = { ...rawOffer(), validUntil: "2000-01-01" };
  const exhausted = { ...rawOffer(), remainingQuantity: 0 };
  const unavailable = rawOffer();
  unavailable.products[0].product.isAvailable = false;
  expect(
    normalizeKPersonalOffers({ offers: [expired, exhausted, unavailable] })
      .offers,
  ).toEqual([]);
  const unknown = {
    ...rawOffer(),
    validUntil: null,
    remainingQuantity: null,
    pricing: { price: 9, unit: { fi: "paketti" } },
  };
  const offer = normalizeKPersonalOffers({ offers: [unknown] }).offers[0];
  expect(offer.price).toEqual({
    amount: 900,
    basis: "unknown",
    quantity: null,
    unitLabel: "paketti",
  });
  expect(offer.conditions).toEqual([
    "plussa-required",
    "activation-unverified",
    "validity-unknown",
    "redemptions-unknown",
    "price-basis-unknown",
  ]);
  for (const basis of ["kg", "l"] as const) {
    expect(
      normalizeKPersonalOffers({
        offers: [
          { ...rawOffer(), pricing: { price: 2.49, unit: { fi: basis } } },
        ],
      }).offers[0].price,
    ).toMatchObject({ basis, quantity: 1, amount: 249 });
  }
});

test("only current unique offers count toward the thirty-offer limit", () => {
  const offers = Array.from({ length: 31 }, (_, n) => ({
    ...rawOffer(),
    localizedTitle: { finnish: `Offer ${n}` },
  }));
  expect(
    normalizeKPersonalOffers({ offers: [...offers, offers[0]] }),
  ).toMatchObject({ offers: expect.any(Array), truncated: true });
  expect(normalizeKPersonalOffers({ offers }).offers).toHaveLength(30);
  expect(() =>
    normalizeKPersonalOffers({ offers: Array.from({ length: 201 }, rawOffer) }),
  ).toThrow();
  expect(() =>
    normalizeKPersonalOffers({
      offers: [
        {
          ...rawOffer(),
          products: Array.from({ length: 21 }, () => rawOffer().products[0]),
        },
      ],
    }),
  ).toThrow();
});

test("signed-out, empty and unsupported are distinct and unsupported never calls a worker", async () => {
  const signedOut = boundary(() => ({
    body: JSON.stringify({ ...basket, userInfo: null }),
  }));
  expect(await signedOut.provider.readOffers(context)).toMatchObject({
    status: "signed-out",
  });
  expect(signedOut.sent).toHaveLength(1);
  const empty = boundary((r) =>
    r.path === "/kr-api/tos-offers" ? { body: '{"offers":[]}' } : undefined,
  );
  expect(await empty.provider.readOffers(context)).toMatchObject({
    status: "ready",
    offers: [],
    truncated: false,
  });
  const unexpected = async () => {
    throw new Error("must not call worker");
  };
  const fallback = new KRuokaProvider(unexpected);
  expect(fallback.capabilities.offers).toEqual({
    public: false,
    personal: false,
  });
  expect(await fallback.readOffers(context)).toMatchObject({
    status: "unsupported",
    reason: "external-worker",
  });
  const s = new SKaupatProvider(unexpected);
  expect(s.capabilities.offers).toEqual({ public: false, personal: false });
  expect(
    await s.readOffers({ ...context, providerId: "s-kaupat" }),
  ).toMatchObject({ status: "unsupported", reason: "no-discovery-source" });
});

test.each([
  { status: 401, expected: "signed-out" },
  { status: 403, expected: "signed-out" },
  { status: 503, expected: "storeUnavailable" },
  { cfMitigated: "challenge", expected: "storeBlocked" },
  { body: '{"offers":{}}', expected: "storeUnavailable" },
  { body: "invalid-json", expected: "storeUnavailable" },
  {
    body: " ".repeat(offerLimits.responseBytes + 1),
    expected: "storeUnavailable",
  },
])(
  "source failure $expected cannot masquerade as supported empty",
  async ({ expected, ...response }) => {
    const { provider, sent } = boundary((r) =>
      r.path === "/kr-api/tos-offers" ? response : undefined,
    );
    expect(await provider.readOffers(context)).toMatchObject(
      expected === "signed-out"
        ? { status: expected }
        : { status: "error", code: expected },
    );
    expect(sent).toHaveLength(2);
  },
);

test.each(["store", "account"])(
  "a changed %s after the read discards the offers",
  async (change) => {
    const { provider } = boundary((_, n) =>
      n === 3
        ? {
            body: JSON.stringify(
              change === "store"
                ? { ...basket, store: { ...basket.store, id: "other" } }
                : { ...basket, userInfo: { email: "other@example.invalid" } },
            ),
          }
        : undefined,
    );
    expect(await provider.readOffers(context)).toMatchObject({
      status: "error",
      code: change === "store" ? "contextChanged" : "accountChanged",
    });
  },
);

test("build conflicts retry once per read, at most six page requests", async () => {
  const { provider, sent } = boundary((_, n) =>
    n % 2 ? { status: 409, build: `build-${n}` } : undefined,
  );
  expect(await provider.readOffers(context)).toMatchObject({ status: "ready" });
  expect(sent).toHaveLength(6);
  expect(sent[1].build).toBe("build-1");
  const refused = boundary(() => ({ status: 409, build: "99" }));
  expect(await refused.provider.readOffers(context)).toMatchObject({
    status: "error",
    code: "storeUnavailable",
  });
  expect(refused.sent).toHaveLength(2);
});

test("cancellation before and during a read stops subsequent page requests", async () => {
  for (const phase of [0, 1, 2, 3]) {
    const controller = new AbortController();
    const { provider, sent } = boundary((_, n) => {
      if (n === phase) controller.abort();
      return undefined;
    });
    if (!phase) controller.abort();
    expect(
      await provider.readOffers(context, { signal: controller.signal }),
    ).toMatchObject({ status: "error", code: "cancelled" });
    expect(sent).toHaveLength(phase);
  }
});

test("offer reads never establish cart review or authorize an offer EAN for addition", async () => {
  const { site, sent } = boundary();
  await site.readOffers(context);
  await expect(
    site.call("update_cart_item", {
      store_id: context.storeId,
      item_id: "item",
      quantity: 1,
      unit: "kpl",
    }),
  ).rejects.toThrow("reviewRequired");
  await site.call("get_cart", { store_id: context.storeId });
  await expect(
    site.call("add_to_cart", {
      store_id: context.storeId,
      ean: "2000000000011",
      quantity: 1,
      unit: "kpl",
      allow_substitutes: false,
    }),
  ).rejects.toThrow("productUnavailable");
  expect(sent.every((r) => r.method === "POST")).toBe(true);
});

test("provider validates the returned source binding and rejects unknown data", async () => {
  const provider = new KRuokaProvider(
    async () => undefined,
    async () => ({
      providerId: "other",
      storeId: context.storeId,
      status: "signed-out",
    }),
  );
  expect(await provider.readOffers(context)).toMatchObject({
    status: "error",
    code: "contextChanged",
  });
});

test("offer reads preserve the earlier cart review when another account is signed in", async () => {
  const { site, sent } = boundary((r, n) =>
    r.path === "/kr-api/basket/active" && n > 1
      ? {
          body: JSON.stringify({
            ...basket,
            userInfo: { email: "other@example.invalid" },
          }),
        }
      : undefined,
  );
  await site.call("get_cart", { store_id: context.storeId });
  expect(await site.readOffers(context)).toMatchObject({ status: "ready" });
  await expect(
    site.call("update_cart_item", {
      store_id: context.storeId,
      item_id: "item",
      quantity: 1,
      unit: "kpl",
    }),
  ).rejects.toThrow("accountChanged");
  expect(sent.some((r) => r.method === "PATCH")).toBe(false);
});

test("an offer request cancelled while queued never reaches the page", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: Request[] = [];
  const site = new KRuokaSite(async (r) => {
    sent.push(r);
    entered();
    await gate;
    return {
      status: 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify(basket),
    };
  }, 0);
  const first = site.call("auth_status", { store_id: context.storeId });
  await started;
  const controller = new AbortController();
  const offers = site.readOffers(context, { signal: controller.signal });
  controller.abort();
  release();
  await first;
  expect(await offers).toMatchObject({ status: "error", code: "cancelled" });
  expect(sent).toHaveLength(1);
});
