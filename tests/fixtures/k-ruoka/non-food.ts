/**
 * Synthetic K-Ruoka product-search responses for non-food requests (F22.2).
 *
 * The envelope and the per-product fields follow the anonymised grocery response captured on
 * 9 October 2026 (`product-search.json`): `ean`, `localizedName`, `store`, `availability`,
 * `isAvailable`, `mobilescan.pricing.normal` and `brand`. Every product, EAN, price and store
 * below is invented. Nothing here says that a real K store lists such products, that size or
 * colour arrive as separate fields, or that the basket accepts them: the fixtures only fix how the
 * app behaves if the search answers like this.
 */
type Hit = {
  ean: string;
  name: string;
  price?: number | null;
  unit?: string | null;
  approximate?: boolean | null;
  available?: boolean | null;
  availability?: { store: boolean; web: boolean } | null;
  brand?: string | null;
  storeId?: string;
};
export const hit = (h: Hit, storeId: string) => ({
  id: h.ean,
  type: "product",
  product: {
    type: "product",
    id: h.ean,
    ean: h.ean,
    localizedName: { finnish: h.name },
    store: { id: h.storeId ?? storeId, isLocal: false },
    ...(h.availability === null
      ? {}
      : { availability: h.availability ?? { store: true, web: true } }),
    ...(h.available === null ? {} : { isAvailable: h.available ?? true }),
    mobilescan: {
      pricing:
        h.price === null
          ? {}
          : {
              normal: {
                unit: h.unit === undefined ? "kpl" : h.unit,
                isApproximate: h.approximate ?? false,
                price: h.price ?? 9.9,
              },
            },
    },
    ...(h.brand ? { brand: { id: "1", name: h.brand, slug: "b" } } : {}),
  },
});
export const response = (storeId: string, query: string, hits: Hit[]) => ({
  result: hits.map((h) => hit(h, storeId)),
  hasGoodResults: hits.length > 0,
  totalHits: hits.length,
  language: "fi",
  searchQuery: query,
  storeId,
  type: "products",
});

export const SMALL_STORE = "N301";
export const LARGE_STORE = "N190";
/** A large store that lists children's rubber boots in some sizes, a pan and batteries. */
export const largeStore: Record<string, Hit[]> = {
  "kumisaappaat 32": [
    {
      ean: "6400000000311",
      name: "Lasten kumisaapas sininen koko 31",
      price: 19.9,
      brand: "Synteettinen",
    },
    {
      ean: "6400000000328",
      name: "Lasten kumisaapas sininen koko 32",
      price: 19.9,
      brand: "Synteettinen",
    },
    {
      ean: "6400000000335",
      name: "Lasten kumisaapas punainen koko 32",
      price: 21.9,
      brand: "Synteettinen",
      available: false,
      availability: { store: false, web: false },
    },
    {
      ean: "6400000000342",
      name: "Lasten kumisaapas keltainen",
      price: 18.9,
    },
  ],
  "kumisaappaat 34": [
    {
      ean: "6400000000311",
      name: "Lasten kumisaapas sininen koko 31",
      price: 19.9,
    },
  ],
  paistinpannu: [
    {
      ean: "6400000001004",
      name: "Paistinpannu 28 cm induktio",
      price: 24.9,
      brand: "Synteettinen",
    },
    { ean: "6400000001011", name: "Paistinpannu 24 cm", price: null },
    {
      ean: "6400000001028",
      name: "Paistinpannu 28 cm",
      price: 17.9,
      available: null,
      availability: null,
    },
  ],
  "AA paristo": [
    { ean: "6400000002001", name: "Alkaliparisto AA 4 kpl", price: 3.99 },
    { ean: "6400000002018", name: "Alkaliparisto AAA 4 kpl", price: 3.99 },
    {
      ean: "6400000002025",
      name: "Alkaliparisto AA 10 kpl",
      price: 7.49,
      availability: { store: true, web: false },
    },
  ],
};
