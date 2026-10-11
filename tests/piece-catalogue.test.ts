import { expect, test } from "vitest";
import {
  sKaupatPieceCatalogue,
  pieceCatalogueQuery,
} from "../src/stores/s-kaupat-pieces";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { KRuokaSite } from "../src/stores/k-ruoka-site";
import type { StoreContext } from "../src/domain/model";
import { matchRequirement } from "../src/domain/matching";
import { createReview, transfer } from "../src/application/transfer";
import {
  pieceQuote,
  applyPackSizes,
  transferableLine,
} from "../src/domain/planner";

const context: StoreContext = {
  providerId: "s-kaupat",
  storeId: "fixture-store",
  storeName: "Synthetic store",
  fulfillment: "pickup",
};
const id = "2000000000002";
// Independently authored raw responses; actual public field names are documented
// by weighed-public-s-search.json. No captured account, stock or cart data.
const raw = {
  ean: id,
  price: 0.4,
  priceUnit: "KPL",
  approxPrice: true,
  measurement: { pceApproxWeight: 0.175 },
  pricing: {
    currentPrice: 0.4,
    isApproximatePrice: true,
    salesUnit: "PCE",
    quantityMultiplier: 1,
  },
};
const envelope = (products: unknown[] = [raw], storeId = context.storeId) => ({
  data: {
    store: {
      id: storeId,
      products: { productListItems: products.map((product) => ({ product })) },
    },
  },
});
const reply = (body: unknown, status = 200) => ({
  ok: true,
  status,
  body: JSON.stringify(body),
});

test("S piece metadata uses a bounded fixed read with selected store and explicit measurement", async () => {
  const sent: unknown[] = [];
  const read = sKaupatPieceCatalogue(async (request) => {
    sent.push(request);
    return reply(envelope());
  });
  expect(await read(context, [id])).toEqual([
    {
      id,
      price: 0.4,
      unit: "KPL",
      approximate: true,
      weightKg: 0.175,
      salesUnit: "PCE",
      multiplier: 1,
    },
  ]);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    method: "POST",
    url: "https://api.s-kaupat.fi/",
    timeoutMs: 30000,
  });
  const body = JSON.parse((sent[0] as { body: string }).body);
  expect(body).toEqual({
    operationName: "KorikonePieceCatalogue",
    query: pieceCatalogueQuery,
    variables: { storeId: context.storeId, eans: [id] },
  });
  expect(body.query).not.toMatch(/mutation|checkout|shoppingList/);
  await expect(read(context, [id, id])).rejects.toThrow("storeUnavailable");
  await expect(read(context, ["arbitrary"])).rejects.toThrow(
    "storeUnavailable",
  );
  await expect(read(context, Array(21).fill(id))).rejects.toThrow(
    "storeUnavailable",
  );
  expect(await read(context, [])).toEqual([]);
  expect(sent).toHaveLength(1);
});

test("S metadata rejects refused, malformed, duplicate, foreign and wrong-store answers", async () => {
  for (const body of [
    envelope([raw, raw]),
    envelope([{ ...raw, ean: "2000000000003" }]),
    envelope([{ ...raw, measurement: { pceApproxWeight: "0.175" } }]),
    { ...envelope(), errors: [{}] },
    {},
  ]) {
    await expect(
      sKaupatPieceCatalogue(async () => reply(body))(context, [id]),
    ).rejects.toThrow("storeUnavailable");
  }
  await expect(
    sKaupatPieceCatalogue(async () => reply(envelope(), 403))(context, [id]),
  ).rejects.toThrow("storeUnavailable");
  await expect(
    sKaupatPieceCatalogue(async () => reply(envelope([raw], "other")))(
      context,
      [id],
    ),
  ).rejects.toThrow("contextChanged");
  expect(
    await sKaupatPieceCatalogue(async () => reply(envelope([])))(context, [id]),
  ).toEqual([]);
});

const worker = async (tool: string) => {
  if (tool === "search_products")
    return {
      products: [
        {
          id,
          name: "Synteettinen banaani",
          price: 0.4,
          approximatePrice: true,
          priceBasis: "per_item",
          quantityUnit: "KPL",
        },
      ],
    };
  if (tool === "check_basket")
    return { items: [{ productId: id, status: "ok" }] };
  throw new Error("Unexpected mutation");
};
test("piece arithmetic distinguishes mass rounding, piece requests and unsupported authority", async () => {
  const provider = new SKaupatProvider(
    worker,
    sKaupatPieceCatalogue(async () => reply(envelope())),
  );
  const [product] = await provider.searchProducts(context, "banaani", "banana");
  const req = {
    id: "banana",
    name: "Banaani",
    amount: 350,
    unit: "g" as const,
    sources: [],
  };
  expect(pieceQuote(req, product)).toEqual({
    pieces: 2,
    total: 80,
    weightGrams: 350,
  });
  expect(pieceQuote({ ...req, amount: 351 }, product)).toEqual({
    pieces: 3,
    total: 120,
    weightGrams: 525,
  });
  expect(pieceQuote({ ...req, unit: "pcs", amount: 2 }, product)?.pieces).toBe(
    2,
  );
  expect(pieceQuote({ ...req, unit: "ml" }, product)).toBeNull();
  expect(pieceQuote({ ...req, amount: 100_000 }, product)).toBeNull();
  for (const changed of [
    { ...product, pieceOrdering: undefined },
    {
      ...product,
      pieceOrdering: { ...product.pieceOrdering!, estimatedWeightGrams: 0 },
    },
    { ...product, nativeUnit: "kg" },
    { ...product, increment: 0 },
    { ...product, available: null },
    { ...product, deposit: 10 },
    {
      ...product,
      cataloguePricing: {
        ...product.cataloguePricing!,
        unit: "KG",
        basis: "per_weight",
      },
    },
    {
      ...product,
      cataloguePricing: { ...product.cataloguePricing!, approximate: false },
    },
    {
      ...product,
      cataloguePricing: { ...product.cataloguePricing!, amount: null },
    },
  ])
    expect(pieceQuote(req, changed)).toBeNull();
  expect(
    applyPackSizes([product], { [id]: { amount: 1000, unit: "g" } })[0],
  ).toEqual(product);
  const line = matchRequirement(req, [product], { context });
  expect(transferableLine(line)).toBe(true);
  expect(transferableLine({ ...line, approximate: false })).toBe(false);
  expect(transferableLine({ ...line, packs: 3 })).toBe(false);
});
test("real S adapter attaches only explicit piece weight with agreeing current price and unit", async () => {
  const provider = new SKaupatProvider(
    worker,
    sKaupatPieceCatalogue(async () => reply(envelope())),
  );
  const [product] = await provider.searchProducts(context, "banaani", "banana");
  expect(product.pieceOrdering).toEqual({
    unit: "kpl",
    increment: 1,
    estimatedWeightGrams: 175,
  });
  expect(product).toMatchObject({
    price: null,
    increment: 1,
    packAmount: 0,
    nativeUnit: "kpl",
  });
  for (const changed of [
    { ...raw, measurement: null },
    { ...raw, measurement: { pceApproxWeight: 0 } },
    { ...raw, pricing: { ...raw.pricing, salesUnit: "KGM" } },
    { ...raw, pricing: { ...raw.pricing, quantityMultiplier: 2 } },
  ]) {
    const [unknown] = await new SKaupatProvider(
      worker,
      sKaupatPieceCatalogue(async () => reply(envelope([changed]))),
    ).searchProducts(context, "banaani", "banana");
    expect(unknown.pieceOrdering).toBeUndefined();
  }
  for (const changed of [
    { ...raw, priceUnit: "KG" },
    { ...raw, pricing: { ...raw.pricing, currentPrice: 0.41 } },
    { ...raw, pricing: { ...raw.pricing, isApproximatePrice: false } },
  ]) {
    await expect(
      new SKaupatProvider(
        worker,
        sKaupatPieceCatalogue(async () => reply(envelope([changed]))),
      ).searchProducts(context, "banaani", "banana"),
    ).rejects.toThrow("priceChanged");
  }
});

test("real embedded K adapter exposes source kg per piece without using a kg price as ordering authority", async () => {
  const sent: unknown[] = [];
  let unit = "kpl",
    weight: number | null = 0.175;
  const site = new KRuokaSite(async (request) => {
    sent.push(request);
    return {
      status: 200,
      build: "fixture",
      cfMitigated: null,
      body: JSON.stringify({
        result: [
          {
            type: "product",
            product: {
              ean: id,
              localizedName: { finnish: "Synteettinen banaani" },
              isAvailable: true,
              productAttributes: { measurements: { averageWeight: weight } },
              mobilescan: {
                pricing: { normal: { price: 0.4, unit, isApproximate: true } },
              },
            },
          },
        ],
      }),
    };
  }, 0);
  const provider = new KRuokaProvider(site.call);
  const kContext = { ...context, providerId: "k-ruoka" };
  const [product] = await provider.searchProducts(
    kContext,
    "banaani",
    "banana",
  );
  expect(product.pieceOrdering).toEqual({
    unit: "kpl",
    increment: 1,
    estimatedWeightGrams: 175,
  });
  expect(product).toMatchObject({ price: null, increment: 1, packAmount: 0 });
  unit = "kg";
  expect(
    (await provider.searchProducts(kContext, "banaani", "banana"))[0]
      .pieceOrdering,
  ).toBeUndefined();
  unit = "kpl";
  weight = null;
  expect(
    (await provider.searchProducts(kContext, "banaani", "banana"))[0]
      .pieceOrdering,
  ).toBeUndefined();
  expect(sent).toHaveLength(3);
  expect(
    sent.every((request) =>
      (request as { path: string }).path.startsWith(
        "/kr-api/v2/product-search/",
      ),
    ),
  ).toBe(true);
});

test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s real adapter transfers explicit estimated pieces through normal review and exact readback",
  async (chain) => {
    const ctx = { ...context, providerId: chain };
    let quantity = 0;
    const mutations: Record<string, unknown>[] = [];
    const call = async (tool: string, args: Record<string, unknown>) => {
      if (tool === "search_products")
        return chain === "s-kaupat"
          ? worker(tool)
          : {
              results: [
                {
                  ean: id,
                  name: "Synteettinen banaani",
                  price: 0.4,
                  priceUnit: "kpl",
                  priceIsApproximate: true,
                  averagePieceWeightKg: 0.175,
                  isAvailable: true,
                },
              ],
            };
      if (tool === "check_basket") return worker(tool);
      if (tool === "login_status")
        return { status: "logged_in", accountId: "fixture-account" };
      if (tool === "get_cart")
        return {
          basketId: "fixture",
          account: "fixture-account",
          store: { id: ctx.storeId, name: ctx.storeName },
          items: quantity
            ? [
                {
                  itemId: "fixture-row",
                  ean: id,
                  name: "Synteettinen banaani",
                  amount: quantity,
                  unit: "kpl",
                },
              ]
            : [],
        };
      if (tool === "get_shopping_lists")
        return {
          lists: quantity
            ? [
                {
                  id: "fixture-list",
                  name: "Korikone",
                  items: [
                    {
                      productId: id,
                      name: "Synteettinen banaani",
                      quantity,
                      product: { priceBasis: "per_item" },
                    },
                  ],
                },
              ]
            : [],
        };
      if (tool === "add_to_cart" || tool === "create_shopping_list") {
        mutations.push(args);
        quantity =
          chain === "k-ruoka"
            ? Number(args.quantity)
            : (args.items as { quantity: number }[])[0].quantity;
        return { results: [{ productId: id, status: "added" }] };
      }
      throw new Error(`Unexpected tool ${tool}`);
    };
    const provider =
      chain === "k-ruoka"
        ? new KRuokaProvider(call)
        : new SKaupatProvider(
            call,
            sKaupatPieceCatalogue(async () => reply(envelope())),
          );
    const req = {
      id: "banana",
      name: "Banaani",
      amount: 500,
      unit: "g" as const,
      sources: ["fixture"],
    };
    const line = matchRequirement(
      req,
      await provider.searchProducts(ctx, "banaani", "banana"),
      { context: ctx },
    );
    expect(line).toMatchObject({ approximate: true, packs: 3, total: 120 });
    const review = await createReview(provider, ctx, 1, [line]);
    const result = await transfer(
      provider,
      { review, status: "ready", verified: [], uncertain: null, error: null },
      () => {},
    );
    expect(result.status).toBe("verified");
    expect(quantity).toBe(3);
    expect(mutations).toHaveLength(1);
    expect(
      chain === "k-ruoka"
        ? mutations[0].unit
        : (mutations[0].items as unknown[])[0],
    ).toEqual(
      chain === "k-ruoka"
        ? "kpl"
        : { productId: id, quantity: 3, allowSubstitutes: false },
    );
  },
);
