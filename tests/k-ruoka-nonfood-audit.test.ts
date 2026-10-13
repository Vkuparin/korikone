import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { StoreContext } from "../src/domain/model";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { KRuokaSite, type PageRequest } from "../src/stores/k-ruoka-site";
import {
  LARGE_STORE,
  SMALL_STORE,
  largeStore,
  response,
} from "./fixtures/k-ruoka/non-food";

type Sent = Parameters<PageRequest>[0];
const store = (storeId: string): StoreContext => ({
  providerId: "k-ruoka",
  storeId,
  storeName: "Synteettinen kauppa",
  fulfillment: "pickup",
});
/** The real site client and adapter over a fake store page that answers a search by its query. */
function client(
  storeId: string,
  answer: (query: string, sent: Sent) => { status?: number; body?: unknown },
) {
  const sent: Sent[] = [];
  const request: PageRequest = async (r) => {
    sent.push(r);
    const query = decodeURIComponent(
      r.path.match(/product-search\/([^?]+)/)?.[1] ?? "",
    );
    const a: { status?: number; body?: unknown } = r.path.startsWith(
      "/kr-api/v2/product-search/",
    )
      ? answer(query, r)
      : r.path.startsWith("/kr-api/basket/")
        ? { body: { ...basket, userInfo: null } }
        : { status: 404 };
    return {
      status: a.status ?? 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify(a.body ?? {}),
    };
  };
  const site = new KRuokaSite(request, 0);
  return { sent, site, provider: new KRuokaProvider(site.call) };
}
const basket = JSON.parse(
  readFileSync(
    new URL("./fixtures/k-ruoka/basket-active.json", import.meta.url),
    "utf8",
  ),
);
const large = () =>
  client(LARGE_STORE, (query) => ({
    body: response(LARGE_STORE, query, largeStore[query] ?? []),
  }));

test("what the captured response carries, and which of it the site client passes on", async () => {
  const captured = JSON.parse(
    readFileSync(
      new URL("./fixtures/k-ruoka/product-search.json", import.meta.url),
      "utf8",
    ),
  );
  const product = captured.result[0].product;
  // Observed on a grocery product on 9 October 2026. No size, colour or specification field.
  expect(Object.keys(product).sort()).toEqual([
    "availability",
    "brand",
    "ean",
    "id",
    "isAvailable",
    "localizedName",
    "mobilescan",
    "store",
    "type",
  ]);
  expect(Object.keys(product.availability).sort()).toEqual(["store", "web"]);
  expect(Object.keys(captured).sort()).toContain("totalHits");
  // The site client passes on seven fields; brand, the store/web split and the hit count stop there.
  const { site } = large();
  const raw = (await site.call("search_products", {
    store_id: LARGE_STORE,
    query: "AA paristo",
    limit: 20,
  })) as { results: Record<string, unknown>[] };
  expect(Object.keys(raw.results[0]).sort()).toEqual([
    "averagePieceWeightKg",
    "ean",
    "isAvailable",
    "name",
    "price",
    "priceIsApproximate",
    "priceUnit",
  ]);
  expect(Object.keys(raw)).toEqual(["results"]);
});

test("a search is bound to the selected store and needs no sign-in; the basket does", async () => {
  const { provider, sent } = large();
  const found = await provider.searchProducts(
    store(LARGE_STORE),
    "kumisaappaat 32",
    "boots",
  );
  expect(sent[0]).toMatchObject({
    method: "POST",
    path: `/kr-api/v2/product-search/${encodeURIComponent("kumisaappaat 32")}?language=fi&storeId=${LARGE_STORE}&offset=0&limit=20`,
  });
  expect(found.every((p) => p.storeId === LARGE_STORE)).toBe(true);
  // Signed out: discovery still answers, the basket refuses.
  await expect(provider.getCart(store(LARGE_STORE))).rejects.toThrow(
    "loginRequired",
  );
  // A product that names another store is a stale context, not a result.
  const other = client(LARGE_STORE, (query) => ({
    body: response(LARGE_STORE, query, [
      {
        ean: "6400000000328",
        name: "Lasten kumisaapas koko 32",
        storeId: "N999",
      },
    ]),
  }));
  await expect(
    other.provider.searchProducts(
      store(LARGE_STORE),
      "kumisaappaat 32",
      "boots",
    ),
  ).rejects.toThrow("contextChanged");
});

test("the exact variant is an EAN and a name: size and colour exist only as printed words", async () => {
  const { provider } = large();
  const boots = await provider.searchProducts(
    store(LARGE_STORE),
    "kumisaappaat 32",
    "boots",
  );
  expect(boots.map((p) => [p.id, p.name, p.price, p.available])).toEqual([
    ["6400000000311", "Lasten kumisaapas sininen koko 31", 1990, true],
    ["6400000000328", "Lasten kumisaapas sininen koko 32", 1990, true],
    ["6400000000335", "Lasten kumisaapas punainen koko 32", 2190, false],
    ["6400000000342", "Lasten kumisaapas keltainen", 1890, true],
  ]);
  // The search for size 32 also returned size 31 and a boot with no printed size: a returned
  // product is not evidence that it is the requested variant.
  expect(boots.filter((p) => / 32$/.test(p.name)).map((p) => p.id)).toEqual([
    "6400000000328",
    "6400000000335",
  ]);
  // Nothing structured describes the variant: no size, colour or brand reaches the product.
  for (const product of boots) {
    expect(Object.keys(product)).not.toEqual(
      expect.arrayContaining(["size", "colour", "brand", "attributes"]),
    );
    expect(product.evidence).toMatchObject({ category: null, family: null });
  }
  // The requested size is absent from this answer: sizes 31 only.
  const missing = await provider.searchProducts(
    store(LARGE_STORE),
    "kumisaappaat 34",
    "boots",
  );
  expect(missing.map((p) => p.name)).toEqual([
    "Lasten kumisaapas sininen koko 31",
  ]);
});

test("today's mapping of single items, multipacks, missing price and unknown stock", async () => {
  const { provider } = large();
  const facts = async (query: string) =>
    (await provider.searchProducts(store(LARGE_STORE), query, "item")).map(
      (p) => ({
        id: p.id,
        pack: [p.packAmount, p.unit],
        price: p.price,
        available: p.available,
        increment: p.increment,
      }),
    );
  // A single item sold by the piece has no count in its name, so its pack is unknown today and
  // the row would wait for the shopper to confirm a pack size. "28 cm" is not a pack.
  expect(await facts("paistinpannu")).toEqual([
    {
      id: "6400000001004",
      pack: [0, "pcs"],
      price: 2490,
      available: true,
      increment: 1,
    },
    // No price: the product is listed with its price unknown.
    {
      id: "6400000001011",
      pack: [0, "pcs"],
      price: null,
      available: true,
      increment: 0,
    },
    // No availability field at all: unknown, never assumed in stock.
    {
      id: "6400000001028",
      pack: [0, "pcs"],
      price: 1790,
      available: null,
      increment: 1,
    },
  ]);
  // A printed count is read as the pack.
  expect(await facts("AA paristo")).toEqual([
    {
      id: "6400000002001",
      pack: [4, "pcs"],
      price: 399,
      available: true,
      increment: 1,
    },
    {
      id: "6400000002018",
      pack: [4, "pcs"],
      price: 399,
      available: true,
      increment: 1,
    },
    // In the shop but not orderable online: today this is indistinguishable from orderable,
    // because only `isAvailable` is read and it says true.
    {
      id: "6400000002025",
      pack: [10, "pcs"],
      price: 749,
      available: true,
      increment: 1,
    },
  ]);
});

test("a small store's empty answer, an error and a changed site are three different things", async () => {
  // Nothing listed here. That is this store's answer only, not the chain's.
  const small = client(SMALL_STORE, (query) => ({
    body: response(SMALL_STORE, query, []),
  }));
  expect(
    await small.provider.searchProducts(
      store(SMALL_STORE),
      "kumisaappaat 32",
      "boots",
    ),
  ).toEqual([]);
  // The store did not answer.
  const down = client(LARGE_STORE, () => ({ status: 503 }));
  await expect(
    down.provider.searchProducts(store(LARGE_STORE), "paistinpannu", "pan"),
  ).rejects.toThrow();
  // The site changed its answer's shape.
  const changed = client(LARGE_STORE, () => ({ body: { products: [] } }));
  await expect(
    changed.provider.searchProducts(store(LARGE_STORE), "paistinpannu", "pan"),
  ).rejects.toThrow();
  // Today an empty answer and a zero hit count look the same to the app: the hit count and
  // `hasGoodResults` are not passed on, so "not listed here" rests on the empty list alone.
  expect(small.sent).toHaveLength(1);
});

test("a basket write is by EAN and piece count, only for a product this session's search returned", async () => {
  const { site } = large();
  await site.call("search_products", {
    store_id: LARGE_STORE,
    query: "AA paristo",
    limit: 20,
  });
  // An EAN the search did not return in this session is refused before any request.
  await expect(
    site.call("add_to_cart", {
      store_id: LARGE_STORE,
      ean: "6400000009999",
      quantity: 1,
      unit: "kpl",
      allow_substitutes: false,
    }),
  ).rejects.toThrow("productUnavailable");
  // Nothing in the client is specific to groceries, and nothing proves that the store's basket
  // accepts a non-food EAN: that needs one authorized live write and read-back.
  for (const invalid of [
    { quantity: 0 },
    { unit: "kg" },
    { allow_substitutes: true },
  ])
    await expect(
      site.call("add_to_cart", {
        store_id: LARGE_STORE,
        ean: "6400000002001",
        quantity: 1,
        unit: "kpl",
        allow_substitutes: false,
        ...invalid,
      }),
    ).rejects.toThrow();
});
