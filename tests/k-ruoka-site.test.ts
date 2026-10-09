import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { KRuokaSite, type PageRequest } from "../src/stores/k-ruoka-site";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import type { StoreContext } from "../src/domain/model";

// Anonymised responses captured from k-ruoka.fi on 9 October 2026 (U3.7).
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/k-ruoka/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const context: StoreContext = {
  providerId: "k-ruoka",
  storeId: "N190",
  storeName: "K-Citymarket Helsinki Easton",
  fulfillment: "pickup",
};
type Sent = Parameters<PageRequest>[0];
/** A fake store page: answers by path and records what was sent. */
function page(
  answer: (request: Sent) => {
    status?: number;
    body?: unknown;
    build?: string;
  },
) {
  const sent: Sent[] = [];
  const request: PageRequest = async (r) => {
    sent.push(r);
    const a = answer(r);
    return {
      status: a.status ?? 200,
      build: a.build ?? "42",
      cfMitigated: null,
      body: JSON.stringify(a.body ?? {}),
    };
  };
  return {
    sent,
    provider: new KRuokaProvider(new KRuokaSite(request, 0).call),
  };
}
const routes =
  (overrides: Partial<Record<string, unknown>> = {}) =>
  (r: Sent) => {
    if (r.path.startsWith("/kr-api/v2/product-search/"))
      return { body: overrides.search ?? fixture("product-search") };
    if (r.path === "/kr-api/stores/search")
      return { body: fixture("stores-search") };
    if (r.path === "/kr-api/basket/active")
      return { body: overrides.basket ?? fixture("basket-active") };
    if (r.path.startsWith("/kr-api/basket/by-id/"))
      return { body: overrides.basket ?? fixture("basket-active") };
    return { status: 404 };
  };

test("search reads the price from the store's pricing and keeps weight prices unresolved", async () => {
  const { provider, sent } = page(routes());
  const products = await provider.searchProducts(context, "maito", "milk");
  expect(sent[0]).toMatchObject({
    method: "POST",
    path: "/kr-api/v2/product-search/maito?language=fi&storeId=N190&offset=0&limit=20",
  });
  expect(
    products.map((p) => [p.id, p.name, p.price, p.packAmount, p.unit]),
  ).toEqual([
    ["6410405082657", "Pirkka suomalainen kevytmaito 1l", 99, 1000, "ml"],
    ["2000000000001", "Synteettinen irtojuusto", null, 0, "pcs"],
  ]);
});

test("store search keeps web stores with pickup", async () => {
  const { provider, sent } = page(routes());
  const found = await provider.searchStores("Helsinki");
  expect(sent[0].body).toEqual({ query: "Helsinki", offset: 0, limit: 20 });
  expect(found.map((s) => s.storeId)).toEqual(["N190"]);
});

test("the cart binds to a hashed account and never carries the e-mail", async () => {
  const { provider, sent } = page(routes());
  const cart = await provider.getCart(context);
  expect(sent[0]).toMatchObject({
    path: "/kr-api/basket/active",
    body: { storeId: "N190", substitutionDefault: false },
  });
  expect(cart.accountId).toMatch(/^k-ruoka:[0-9a-f]{16}$/);
  expect(cart.accountName).toBe("Testi");
  expect(JSON.stringify(cart)).not.toContain("example.invalid");
  expect(cart.lines).toEqual([
    {
      productId: "6410405195005",
      name: "Pirkka suomalainen kiinteä peruna 1kg",
      quantity: 2,
      unit: "kpl",
    },
  ]);
});

test("a signed-out or expired session is a login error, not an anonymous cart", async () => {
  const anonymous = { ...fixture("basket-active"), userInfo: null };
  await expect(
    page(routes({ basket: anonymous })).provider.getCart(context),
  ).rejects.toThrow("loginRequired");
  await expect(
    page(() => ({ status: 401 })).provider.getCart(context),
  ).rejects.toThrow("loginRequired");
});

test("a stale build number is retried once with the one the store names", async () => {
  let first = true;
  const { provider, sent } = page((r) => {
    if (first) {
      first = false;
      return { status: 409, build: "77" };
    }
    return routes()(r);
  });
  await provider.getCart(context);
  expect(sent.map((r) => r.build)).toEqual([null, "77"]);
});

test("writes set an existing item's amount or add a searched product, nothing else", async () => {
  const { provider, sent } = page(routes());
  const cart = await provider.getCart(context);
  const target = {
    accountId: cart.accountId,
    productId: "6410405195005",
    name: "Peruna",
    before: 2,
    quantity: 3,
    unit: "kpl",
    price: 99,
  };
  await provider.setQuantity(context, target);
  const patches = () => sent.filter((r) => r.method === "PATCH");
  expect(patches()).toEqual([
    {
      method: "PATCH",
      path: "/kr-api/basket/by-id/%3CbasketId%3E",
      body: [
        {
          type: "SET-ITEM-AMOUNT",
          itemId: "<itemId>",
          value: { amount: 3, unit: "kpl" },
        },
      ],
      build: "42",
    },
  ]);

  // A product Korikone never saw in a search is not added.
  const milk = {
    ...target,
    productId: "6410405082657",
    before: 0,
    quantity: 1,
  };
  await expect(provider.setQuantity(context, milk)).rejects.toThrow(
    "productUnavailable",
  );
  expect(patches()).toHaveLength(1);
  await provider.searchProducts(context, "maito", "milk");
  await provider.setQuantity(context, milk);
  expect(patches()[1].body).toEqual([
    {
      type: "ADD-ITEM",
      item: {
        ean: "6410405082657",
        allowSubstitutes: false,
        amountInfo: { amount: 1, unit: "kpl" },
      },
    },
  ]);

  // Another account signed in since the review: nothing is written.
  await expect(
    provider.setQuantity(context, { ...target, accountId: "k-ruoka:other" }),
  ).rejects.toThrow("accountChanged");
  expect(patches()).toHaveLength(2);
});

test("calls are spaced out", async () => {
  const times: number[] = [];
  const site = new KRuokaSite(async () => {
    times.push(Date.now());
    return {
      status: 200,
      build: "1",
      cfMitigated: null,
      body: JSON.stringify(fixture("basket-active")),
    };
  }, 50);
  await Promise.all([
    site.call("get_cart", { store_id: "N190" }),
    site.call("get_cart", { store_id: "N190" }),
  ]);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(45);
});
