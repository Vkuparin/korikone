import { expect, test } from "vitest";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { KRuokaSite } from "../src/stores/k-ruoka-site";
import {
  candidateQueries,
  retailerEvidence,
  searchCandidates,
  MAX_CANDIDATES,
} from "../src/stores/candidates";
import { productEvidenceSchema } from "../src/domain/product-evidence";
import type { Requirement, StoreContext } from "../src/domain/model";
import { Service } from "../src/application/service";
import { createFixtureService } from "./fixtures/ai-shopping/environment";

const context = (providerId: string): StoreContext => ({
  providerId,
  storeId: "synthetic-store",
  storeName: "Synthetic store",
  fulfillment: "pickup",
});
const milk: Requirement = {
  id: "milk",
  name: "Maitoa",
  amount: 1000,
  unit: "ml",
  sources: ["extra"],
};
const kProduct = (overrides: object = {}) => ({
  ean: "cow",
  name: "Laktoositon kevytmaito 1 l",
  price: 1.2,
  priceUnit: "kpl",
  priceIsApproximate: false,
  isAvailable: true,
  ...overrides,
});
const sProduct = (overrides: object = {}) => ({
  id: "cow",
  name: "Laktoositon kevytmaito 1 l",
  price: 1.2,
  depositPrice: null,
  approximatePrice: false,
  priceBasis: "per_item",
  packSize: null,
  quantityUnit: "KPL",
  ...overrides,
});

test.each([
  [
    "Kotimaista laktoositon kevytmaito 1 l",
    "milk",
    "plain-milk",
    [
      { kind: "fat", value: "semi-skimmed" },
      { kind: "lactose", value: "free" },
    ],
  ],
  ["Manteli maito 1 l", "milk", "plant-drink", []],
  ["Vaniljamaito 1 l", "milk", "flavoured-milk", []],
  ["Maitojuoma 1 l", "milk", null, []],
  ["Ruisleipä 500 g", "bread", "bread", [{ kind: "grain", value: "rye" }]],
  ["Vehnäsämpylä 500 g", "bread", "bread", [{ kind: "grain", value: "wheat" }]],
  [
    "Ruisnäkkileipä 300 g",
    "bread",
    "crispbread",
    [{ kind: "grain", value: "rye" }],
  ],
  ["Kanan munat M10", "eggs", "hen-egg", []],
  ["Viiriäisen munat 12 kpl", "eggs", "other-egg", []],
  ["Munamassa 500 g", "eggs", "egg-product", []],
  [
    "Naudan jauheliha 400 g",
    "mince",
    "meat-mince",
    [{ kind: "meat", value: "beef" }],
  ],
  [
    "Sika-nauta jauheliha 400 g",
    "mince",
    "meat-mince",
    [{ kind: "meat", value: "beef-pork" }],
  ],
  ["Soija jauheliha 400 g", "mince", "plant-mince", []],
  ["Punasipuli 500 g", "onion", "onion", [{ kind: "onion", value: "red" }]],
  ["Valkosipuli 100 g", null, "garlic", []],
  [
    "Basmati riisi 1 kg",
    "rice",
    "dry-rice",
    [{ kind: "rice", value: "basmati" }],
  ],
  [
    "Valmis basmati riisi 250 g",
    "rice",
    "prepared-rice",
    [{ kind: "rice", value: "basmati" }],
  ],
  [
    "Laktoositon ruokakerma 2 dl",
    "cream",
    "dairy-cream",
    [
      { kind: "cream", value: "cooking" },
      { kind: "lactose", value: "free" },
    ],
  ],
  ["Kaura kerma 2 dl", "cream", "plant-cream", []],
  [
    "Kahvipapu 500 g",
    "coffee",
    "coffee-beans",
    [{ kind: "coffee", value: "beans" }],
  ],
  [
    "Suodatinjauhatus 500 g",
    "coffee",
    "ground-coffee",
    [{ kind: "coffee", value: "ground" }],
  ],
  [
    "Pikakahvi 200 g",
    "coffee",
    "instant-coffee",
    [{ kind: "coffee", value: "instant" }],
  ],
  ["Jauhelihamauste 30 g", null, "seasoning", []],
  ["Sipulikeitto 300 g", null, "prepared-food", []],
  ["Kananmunaleikkuri", null, "equipment", []],
  ["Kahvinkeitin", null, "equipment", []],
  ["Leipäjuusto 200 g", null, "other-food", []],
  ["Kananmunakas 250 g", null, "other-food", []],
  ["Kananmunajauhe 100 g", "eggs", "egg-product", []],
] as const)("retailer evidence: %s", (name, category, family, qualifiers) => {
  expect(retailerEvidence(name)).toMatchObject({
    source: "retailer-name",
    quote: name,
    category,
    family,
    qualifiers,
  });
});

test("absent facts remain unknown and arbitrary retailer labels cannot certify dietary attributes", () => {
  const evidence = retailerEvidence("Synthetic food 500 g", "Dairy", [
    "UNKNOWN_DIET_LABEL",
  ]);
  expect(evidence).toMatchObject({
    category: null,
    family: null,
    qualifiers: [],
    retailerCategory: "Dairy",
    labels: ["UNKNOWN_DIET_LABEL"],
  });
  expect(evidence).not.toHaveProperty("allergenFree");
  expect(
    productEvidenceSchema.safeParse({
      ...evidence,
      category: "eggs",
      qualifiers: [{ kind: "meat", value: "beef" }],
    }).success,
  ).toBe(false);
});

test("both adapters normalize the same label facts and keep missing approximate/stock data unknown", async () => {
  const k = new KRuokaProvider(async () => ({
    results: [kProduct({ priceIsApproximate: null, isAvailable: null })],
  }));
  const s = new SKaupatProvider(async (name) =>
    name === "search_products"
      ? { products: [sProduct({ approximatePrice: null })] }
      : { items: [] },
  );
  const [kp] = await k.searchProducts(context(k.id), "maito", "milk");
  const [sp] = await s.searchProducts(context(s.id), "maito", "milk");
  expect(kp.evidence).toEqual(sp.evidence);
  expect([kp.price, sp.price, kp.available, sp.available]).toEqual([
    null,
    null,
    null,
    null,
  ]);
  expect(kp.cataloguePricing).toMatchObject({
    amount: 120,
    approximate: null,
    deposit: null,
  });
  expect(sp.cataloguePricing).toMatchObject({
    amount: 120,
    approximate: null,
    deposit: null,
  });
  expect([kp.packAmount, sp.packAmount, kp.unit, sp.unit]).toEqual([
    1000,
    1000,
    "ml",
    "ml",
  ]);
});

test("K-Ruoka site bridge preserves absent stock instead of manufacturing unavailable", async () => {
  const site = new KRuokaSite(
    async () => ({
      status: 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify({
        result: [
          {
            type: "product",
            product: {
              ean: "unknown",
              localizedName: { finnish: "Maito 1 l" },
            },
          },
        ],
      }),
    }),
    0,
  );
  const provider = new KRuokaProvider(site.call);
  const [product] = await provider.searchProducts(
    context(provider.id),
    "maito",
    "milk",
  );
  expect(product.available).toBeNull();
  expect(product.price).toBeNull();
  expect(product.cataloguePricing).toEqual({
    amount: null,
    unit: null,
    basis: null,
    approximate: null,
    deposit: null,
  });
  expect(product.nativeUnit).toBe("unknown");
  expect(product.increment).toBe(0);
});

test("weighed source prices and native units are retained without inventing priced packs or write increments", async () => {
  const k = new KRuokaProvider(async () => ({
    results: [
      kProduct({ price: 3.5, priceUnit: "kg", priceIsApproximate: true }),
    ],
  }));
  const s = new SKaupatProvider(async (name) =>
    name === "search_products"
      ? {
          products: [
            sProduct({
              price: 3.5,
              quantityUnit: "KG",
              priceBasis: "per_weight",
              approximatePrice: true,
            }),
          ],
        }
      : { items: [{ productId: "cow", status: "ok" }] },
  );
  for (const provider of [k, s]) {
    const [p] = await provider.searchProducts(
      context(provider.id),
      "maito",
      "milk",
    );
    expect(p).toMatchObject({ price: null, nativeUnit: "kg", increment: 0 });
    expect(p.cataloguePricing).toMatchObject({
      amount: 350,
      approximate: true,
    });
  }
});

test("unsafe normalized price arithmetic is rejected at both retailer boundaries", async () => {
  const k = new KRuokaProvider(async () => ({
    results: [kProduct({ price: Number.MAX_SAFE_INTEGER })],
  }));
  const s = new SKaupatProvider(async (name) =>
    name === "search_products"
      ? { products: [sProduct({ price: Number.MAX_SAFE_INTEGER })] }
      : { items: [{ productId: "cow", status: "ok" }] },
  );
  for (const provider of [k, s])
    await expect(
      provider.searchProducts(context(provider.id), "maito", "milk"),
    ).rejects.toThrow();
});

test("both adapters reject a retailer store echo that differs from the requested store", async () => {
  const k = new KRuokaProvider(async () => ({
    results: [kProduct({ storeId: "other-store" })],
  }));
  const s = new SKaupatProvider(async () => ({
    products: [sProduct({ storeId: "other-store" })],
  }));
  for (const provider of [k, s])
    await expect(
      provider.searchProducts(context(provider.id), "maito", "milk"),
    ).rejects.toThrow("contextChanged");
  const site = new KRuokaSite(
    async () => ({
      status: 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify({
        result: [
          {
            product: {
              ean: "cow",
              localizedName: { finnish: "Maito 1 l" },
              store: { id: "other-store" },
            },
          },
        ],
      }),
    }),
    0,
  );
  await expect(
    new KRuokaProvider(site.call).searchProducts(
      context(k.id),
      "maito",
      "milk",
    ),
  ).rejects.toThrow("contextChanged");
});

test("search expansion stops on a useful original hit and deduplicates Finnish query aliases", async () => {
  const calls: string[] = [];
  const provider = new KRuokaProvider(async (_name, args) => {
    calls.push(String(args.query));
    return { results: [kProduct({ name: "Maito 1 l" })] };
  });
  await searchCandidates(provider, context(provider.id), {
    ...milk,
    name: "Maito",
  });
  expect(calls).toEqual(["Maito"]);
  expect(candidateQueries({ ...milk, name: " MAITO " })).toEqual([
    " MAITO ",
    "kevytmaito",
  ]);
  expect(candidateQueries({ ...milk, name: "Unrecognized food" })).toEqual([
    "Unrecognized food",
  ]);
});

test("three bounded miss queries merge verified IDs and never change the original ingredient or unit", async () => {
  const calls: string[] = [];
  const provider = new KRuokaProvider(async (_name, args) => {
    calls.push(String(args.query));
    return {
      results: Array.from({ length: 20 }, (_, i) =>
        kProduct({ ean: `${calls.length}-${i}`, name: "Kahvi 500 g" }),
      ),
    };
  });
  const products = await searchCandidates(provider, context(provider.id), milk);
  expect(calls).toEqual(["Maitoa", "maito", "kevytmaito"]);
  expect(products).toHaveLength(MAX_CANDIDATES);
  expect(
    products.every((p) => p.ingredientId === "milk" && p.unit === "g"),
  ).toBe(true);
  expect(products.every((p) => p.evidence?.category === "coffee")).toBe(true);
});

test("success on the first alias stops expansion and duplicate IDs retain the latest verified fields", async () => {
  let calls = 0;
  const provider = new KRuokaProvider(async () => ({
    results: [
      kProduct({
        name: "Maito 1 l",
        isAvailable: ++calls === 2,
        price: calls === 1 ? 1.2 : 1.3,
      }),
    ],
  }));
  const products = await searchCandidates(provider, context(provider.id), milk);
  expect(calls).toBe(2);
  expect(products).toHaveLength(1);
  expect(products[0]).toMatchObject({ id: "cow", price: 130, available: true });
});

test("retailer errors and malformed/overflow/duplicate responses are terminal with no alias retry", async () => {
  for (const results of [
    null,
    Array.from({ length: 21 }, (_, i) => kProduct({ ean: String(i) })),
    [kProduct(), kProduct()],
  ]) {
    let calls = 0;
    const provider = new KRuokaProvider(async () => {
      calls++;
      return { results };
    });
    await expect(
      searchCandidates(provider, context(provider.id), milk),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  }
  let calls = 0;
  const provider = new KRuokaProvider(async () => {
    calls++;
    throw new Error("storeUnavailable");
  });
  await expect(
    searchCandidates(provider, context(provider.id), milk),
  ).rejects.toThrow("storeUnavailable");
  expect(calls).toBe(1);
});

test("S-kaupat stock readback rejects duplicate or unrequested IDs instead of accepting invented stock", async () => {
  for (const items of [
    [{ productId: "other", status: "ok" }],
    [
      { productId: "cow", status: "ok" },
      { productId: "cow", status: "unavailable" },
    ],
  ]) {
    const provider = new SKaupatProvider(async (name) =>
      name === "search_products" ? { products: [sProduct()] } : { items },
    );
    await expect(
      provider.searchProducts(context(provider.id), "maito", "milk"),
    ).rejects.toThrow("storeUnavailable");
  }
});

test("cancelled reads cannot issue another alias and cross-store candidates are rejected", async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = new KRuokaProvider(async () => {
    calls++;
    controller.abort();
    return { results: [] };
  });
  await expect(
    searchCandidates(provider, context(provider.id), milk, {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
  await expect(
    searchCandidates(provider, context("s-kaupat"), milk),
  ).rejects.toThrow("contextChanged");
});

test("pending retailer reads cancel promptly and their late output cannot trigger aliases", async () => {
  let release!: () => void;
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const provider = new KRuokaProvider(async () => {
    calls++;
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { results: [] };
  });
  const controller = new AbortController();
  const read = searchCandidates(provider, context(provider.id), milk, {
    signal: controller.signal,
  });
  const cancelled = expect(read).rejects.toMatchObject({ name: "AbortError" });
  await dispatched;
  controller.abort();
  await cancelled;
  release();
  await Promise.resolve();
  expect(calls).toBe(1);
});

for (const chain of ["k-ruoka", "s-kaupat"] as const) {
  test(`${chain}: alias success follows real Service quote, persistence and restart without writes`, async () => {
    const { service, tools, storage } = await createFixtureService(chain, {
      Sipulia: [],
      sipuli: [{ id: "onion", name: "Keltasipuli 500 g", price: 0.9 }],
    });
    await service.save({
      ...service.state,
      extras: [{ id: "onion", name: "Sipulia", amount: 400, unit: "g" }],
    });
    const before = structuredClone(service.state);
    await service.buildBasket();
    expect(service.basket[0].product?.id).toBe("onion");
    expect(service.basket[0].total).toBe(90);
    expect(service.basket[0].product?.evidence).toMatchObject({
      category: "onion",
      family: "onion",
    });
    expect(service.state).toEqual(before);
    expect(tools.filter((name) => name === "search_products")).toHaveLength(2);
    expect(tools.some((name) => /add|set|create|execute/.test(name))).toBe(
      false,
    );
    const quote = {
      state: service.state,
      basket: service.basket,
      quotedAt: service.quotedAt,
    };
    const exported = await service.exportBackup();
    expect(exported).not.toHaveProperty("basket");
    const restarted = new Service(storage);
    restarted.developmentMode = true;
    await restarted.init();
    expect(restarted.state).toEqual(quote.state);
    expect(restarted.basket).toEqual(quote.basket);
    expect(restarted.quotedAt).toBe(quote.quotedAt);
  });
}
