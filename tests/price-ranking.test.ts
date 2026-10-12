import { expect, test, vi } from "vitest";
import {
  priceMetrics,
  compareUnitValues,
  rankProductPrices,
  comparePriceAlternative,
} from "../src/domain/price-ranking";
import { matchRequirement, priceAlternatives } from "../src/domain/matching";
import {
  stateSchema,
  initialState,
  type Product,
  type Requirement,
} from "../src/domain/model";
import { retailerEvidence } from "../src/stores/candidates";
import { Service } from "../src/application/service";
import { memoryStorage } from "./helpers/purchase-fixtures";
import { DemoProvider } from "../src/stores/demo";
import { pricingKey, restoredQuote } from "../src/application/quotes";
const required: Requirement = {
  id: "rice",
  name: "Riisi",
  amount: 500,
  unit: "g",
  sources: ["extra"],
};
const product = (
  id: string,
  size: number,
  price: number,
  extra: Partial<Product> = {},
): Product => ({
  id,
  name: `Basmati riisi ${size} g`,
  ingredientId: "rice",
  providerId: "demo-k",
  storeId: "demo-helsinki",
  packAmount: size,
  price,
  unit: "g",
  available: true,
  deposit: 0,
  nativeUnit: "kpl",
  increment: 1,
  observedAt: "2026-10-13T00:00:00Z",
  evidence: retailerEvidence(`Basmati riisi ${size} g`),
  ...extra,
});
test("unit mode selects the larger better-value pack; total mode buys the cheaper sufficient pack", () => {
  const products = [product("small", 500, 200), product("large", 1000, 300)];
  expect(matchRequirement(required, products).product?.id).toBe("large");
  expect(
    matchRequirement(required, products, { priceBasis: "total" }).product?.id,
  ).toBe("small");
  expect(priceMetrics(required, products[1])).toMatchObject({
    packs: 1,
    payable: 300,
    surplus: 500,
    estimated: false,
  });
  expect(
    rankProductPrices(required, products, "unit").map((p) => p.id),
  ).toEqual(["large", "small"]);
  expect(products.map((p) => p.id)).toEqual(["small", "large"]);
});
test("shared eligible alternatives distinguish unit value from actual checkout savings", () => {
  const small = product("small", 500, 200),
    large = product("large", 1000, 300);
  expect(comparePriceAlternative(required, small, large, "unit")).toMatchObject(
    {
      improves: true,
      benefit: "lower-unit",
      payableDelta: 100,
      unitComparison: -1,
    },
  );
  expect(
    priceAlternatives(required, small, [small, large], {
      priceBasis: "unit",
    }).map((p) => p.id),
  ).toEqual(["large"]);
  expect(
    priceAlternatives(required, small, [small, large], { priceBasis: "total" }),
  ).toEqual([]);
  expect(
    comparePriceAlternative(required, large, small, "total"),
  ).toMatchObject({
    improves: true,
    benefit: "lower-total",
    payableDelta: -100,
  });
  expect(
    priceAlternatives(required, small, [small, large], {
      exclusions: ["1000"],
    }),
  ).toEqual([]);
  const brand = product("brand", 500, 200, {
    name: "Pirkka basmati riisi 500 g",
    evidence: retailerEvidence("Pirkka basmati riisi 500 g"),
  });
  expect(
    priceAlternatives(required, brand, [brand, large], {
      productPreference: "storeBrand",
    }),
  ).toEqual([]);
});
test("volume and individual multipacks use compatible normalized content, with exact ratio ties", () => {
  for (const unit of ["ml", "pcs"] as const) {
    const requirement = { ...required, unit, amount: unit === "pcs" ? 5 : 500 };
    const amount = unit === "pcs" ? 10 : 1000;
    const p = product("p", amount, 300, { unit });
    const metrics = priceMetrics(requirement, p)!;
    expect(metrics.unitValue?.unit).toBe(unit === "ml" ? "l" : "pcs");
    expect(metrics.packs).toBe(1);
    expect(
      compareUnitValues(
        metrics.unitValue!,
        priceMetrics(requirement, { ...p, packAmount: amount / 2, price: 150 })!
          .unitValue!,
      ),
    ).toBe(0);
  }
  const almost = [product("one", 1000, 300), product("two", 999, 300)];
  expect(rankProductPrices(required, almost.reverse(), "unit")[0].id).toBe(
    "one",
  );
});
test("older saved quotes retain total-cost selection when the migrated setting defaults to unit price", () => {
  const state = stateSchema.parse({
    ...initialState(),
    staples: [],
    extras: [{ ...required, sources: undefined }],
  });
  const line = matchRequirement(
    required,
    [product("small", 500, 200), product("large", 1000, 300)],
    { priceBasis: "total" },
  );
  delete line.priceBasis;
  const cached = {
    key: pricingKey(state),
    context: state.context,
    quotedAt: "2026-10-13T00:00:00Z",
    pickupFee: null,
    basket: [line],
  };
  const restored = restoredQuote(cached, state);
  expect(state.priceBasis).toBe("unit");
  expect(restored?.basket[0].product?.id).toBe("small");
  expect(restored?.basket[0].priceBasis).toBe("total");
  expect(
    priceMetrics(
      { ...required, unit: "pcs", amount: 2 },
      product("fraction", 0.5, 200, { unit: "pcs" }),
    ),
  ).toBeNull();
  expect(
    priceMetrics(required, product("fraction", 500, 200, { increment: 0.5 })),
  ).toBeNull();
});
test("whole-pack increments and refundable deposits affect payable totals, not product-value ratios", () => {
  const small = product("small", 500, 200, { deposit: 50, increment: 2 });
  expect(priceMetrics(required, small)).toMatchObject({
    packs: 2,
    payable: 500,
    surplus: 500,
  });
  expect(
    compareUnitValues(
      priceMetrics(required, small)!.unitValue!,
      priceMetrics(required, { ...small, deposit: 0 })!.unitValue!,
    ),
  ).toBe(0);
  expect(
    rankProductPrices(
      required,
      [small, product("large", 1000, 300)],
      "total",
    )[0].id,
  ).toBe("large");
});
test("explicit and brand restrictions and accepted choices remain ahead of price", () => {
  const products = [product("small", 500, 200), product("large", 1000, 300)];
  expect(
    matchRequirement(required, products, { accepted: ["small"] }).product?.id,
  ).toBe("small");
  expect(
    matchRequirement(required, products, { exclusions: ["1000"] }).product?.id,
  ).toBe("small");
  const storeBrand = product("brand", 500, 500, {
    name: "Pirkka basmati riisi 500 g",
    evidence: retailerEvidence("Pirkka basmati riisi 500 g"),
  });
  expect(
    matchRequirement(required, [...products, storeBrand], {
      productPreference: "storeBrand",
    }).product?.id,
  ).toBe("brand");
});
test("unknown/conflicting unit, unavailable and unsafe money evidence never gains a best-value claim", () => {
  for (const extra of [
    { packAmount: 0 },
    { unit: "pcs" as const },
    { available: false },
    { price: null },
    { deposit: -1 },
    { increment: 0 },
  ])
    expect(priceMetrics(required, product("p", 500, 200, extra))).toBeNull();
  const source = {
    amount: 300,
    unit: "kg",
    basis: "per_weight",
    approximate: true,
    deposit: 0,
  };
  expect(
    priceMetrics(
      required,
      product("weighted", 0, 300, { cataloguePricing: source, increment: 0 }),
    ),
  ).toMatchObject({ payable: 150, packs: 0, estimated: true });
  const piece = product("piece", 0, 0, {
    nativeUnit: "kpl",
    unit: "pcs",
    pieceOrdering: { unit: "kpl", increment: 1, estimatedWeightGrams: 175 },
    cataloguePricing: {
      amount: 33,
      unit: "kpl",
      basis: "per_item",
      approximate: true,
      deposit: 0,
    },
  });
  expect(priceMetrics(required, piece)).toMatchObject({
    packs: 3,
    payable: 99,
    surplus: 25,
    estimated: true,
  });
});
test("optional conditional/expired campaign claims cannot establish eligibility or override the source price", () => {
  const p = product("p", 500, 200, {
    cataloguePricing: {
      amount: 200,
      unit: "kpl",
      basis: "per_item",
      approximate: false,
      deposit: 0,
      campaignPrice: 1,
      regularPrice: 200,
      campaignValidUntil: "2020-01-01",
    },
  });
  expect(priceMetrics(required, p)?.payable).toBe(200);
  expect(
    priceMetrics(required, {
      ...p,
      cataloguePricing: { ...p.cataloguePricing!, amount: 1 },
    }),
  ).toBeNull();
  expect(
    priceMetrics(required, {
      ...p,
      cataloguePricing: { ...p.cataloguePricing!, deposit: 50 },
    }),
  ).toBeNull();
  // An already quoted applicable catalogue price remains the source price; no extra discount is inferred.
  const applicable = {
    ...p,
    price: 150,
    cataloguePricing: {
      ...p.cataloguePricing!,
      amount: 150,
      campaignPrice: 150,
      campaignValidUntil: "2099-12-31",
    },
  };
  expect(priceMetrics(required, applicable)?.payable).toBe(150);
  for (const amount of [500, 1000, 1500])
    expect(priceMetrics({ ...required, amount }, p)?.payable).toBe(
      Math.ceil(amount / 500) * 200,
    );
});
test("ties use enough-pack payable, surplus and stable identity; unknown precision is labelled", () => {
  const a = product("a", 500, 200),
    b = product("b", 1000, 400);
  expect(rankProductPrices(required, [b, a], "unit")[0].id).toBe("a");
  expect(
    rankProductPrices(required, [{ ...a, id: "z" }, a], "unit")[0].id,
  ).toBe("a");
  expect(
    priceMetrics(required, product("imprecise", 700.123456789, 300))?.fallback,
  ).toBe("unknown-unit");
  expect(
    compareUnitValues(
      priceMetrics(required, product("g", 500, 200))!.unitValue!,
      priceMetrics(
        { ...required, unit: "ml" },
        product("ml", 500, 200, { unit: "ml" }),
      )!.unitValue!,
    ),
  ).toBeNull();
});
test("failed setting persistence leaves the saved quote unchanged; changing basis obsoletes a provisional run", async () => {
  const { storage } = memoryStorage();
  const service = new Service(storage);
  await service.init();
  const state = structuredClone(service.state);
  vi.spyOn(storage, "set").mockRejectedValueOnce(new Error("storageFailed"));
  await expect(service.setPriceBasis({ priceBasis: "total" })).rejects.toThrow(
    "storageFailed",
  );
  expect(service.state).toEqual(state);
  const run = service.planning.start("Riisi");
  await service.setPriceBasis({ priceBasis: "total" });
  expect(run.snapshot().phase).toBe("obsolete");
  expect(service.state.revision).toBe(state.revision);
});
test.each(["demo-k", "demo-s"])(
  "%s mode changes preserve saved selections, cached quote and manual choice through restart",
  async (providerId) => {
    const { storage } = memoryStorage();
    const service = new Service(storage);
    await service.init();
    await service.save({
      ...service.state,
      context: { ...service.state.context, providerId },
      staples: [],
      meals: [],
      extras: [{ ...required, sources: undefined }],
      note: "Riisi",
    });
    const provider = service.registry.get(providerId) as DemoProvider;
    const products = [
      product("small", 500, 200),
      product("large", 1000, 300),
    ].map((p) => ({
      ...p,
      providerId,
      storeId: service.state.context.storeId,
    }));
    const search = vi
      .spyOn(provider, "searchProducts")
      .mockResolvedValue(products);
    await service.buildBasket();
    expect(service.basket[0].product?.id).toBe("large");
    const revision = service.state.revision,
      quotedAt = service.quotedAt,
      calls = search.mock.calls.length;
    await service.setPriceBasis({ priceBasis: "total" });
    expect(service.state.revision).toBe(revision);
    expect(service.quotedAt).toBe(quotedAt);
    expect(service.basket[0].product?.id).toBe("large");
    expect(service.basket[0].candidates.map((p) => p.id)).toEqual([
      "small",
      "large",
    ]);
    expect(search.mock.calls).toHaveLength(calls);
    const restarted = new Service(storage);
    await restarted.init();
    expect(restarted.state.priceBasis).toBe("total");
    expect(restarted.basket[0].product?.id).toBe("large");
    expect(
      (restarted.registry.get(providerId) as DemoProvider).searchRequests,
    ).toBe(0);
    await service.buildBasket();
    expect(service.basket[0].product?.id).toBe("small");
    await service.accept({ ingredientId: "rice", productId: "large" });
    await service.setPriceBasis({ priceBasis: "unit" });
    await service.setPriceBasis({ priceBasis: "total" });
    await service.buildBasket();
    expect(service.basket[0].product?.id).toBe("large");
    expect((await service.exportBackup()).priceBasis).toBe("total");
    const legacy = initialState() as Partial<ReturnType<typeof initialState>>;
    delete legacy.priceBasis;
    expect(stateSchema.parse(legacy).priceBasis).toBe("unit");
  },
);
