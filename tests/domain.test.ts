import { describe, it, expect, test } from "vitest";
import { packFromName } from "../src/stores/k-ruoka";
import {
  initialState,
  parseAmount,
  stateSchema,
  type Journal,
  type Product,
  type Requirement,
} from "../src/domain/model";
import {
  requirements,
  match,
  exclusionTerms,
  relevant,
  applyPackSizes,
  approximateCost,
  priceBreakdown,
} from "../src/domain/planner";
import { DemoProvider } from "../src/stores/demo";
import {
  createReview,
  transfer,
  resumeReview,
} from "../src/application/transfer";
import { en, fi } from "../src/ui/i18n";
import { matchRequirement, purchasable } from "../src/domain/matching";
import { compareBaskets } from "../src/domain/compare";
import { cheaperThanUsual, currentOffer } from "../src/domain/prices";

test("price badges require four earlier observations and an inclusive ten percent reduction", async () => {
  const provider = new DemoProvider("demo-s");
  const context = {
    providerId: "demo-s",
    storeId: "store",
    storeName: "Fixture",
    fulfillment: "pickup" as const,
  };
  const [original] = await provider.searchProducts(context, "maito", "milk");
  const product = {
    ...original,
    providerId: "s-kaupat",
    price: 900,
    packAmount: 1,
  };
  const now = new Date("2026-10-11T12:00:00Z");
  const history = Array.from({ length: 4 }, (_, index) => ({
    productId: product.id,
    providerId: product.providerId,
    storeId: product.storeId,
    date: `2026-10-0${index + 1}`,
    price: 1000,
    unitPrice: 1000,
  }));
  expect(cheaperThanUsual(product, history, now)).toBe(true);
  expect(cheaperThanUsual({ ...product, price: 901 }, history, now)).toBe(
    false,
  );
  expect(cheaperThanUsual(product, history.slice(1), now)).toBe(false);
  expect(cheaperThanUsual({ ...product, packAmount: 0 }, history, now)).toBe(
    false,
  );
  expect(
    cheaperThanUsual(
      product,
      history.map((entry) => ({ ...entry, unitPrice: 0 })),
      now,
    ),
  ).toBe(false);
  expect(
    cheaperThanUsual(
      product,
      [
        ...history,
        ...Array.from({ length: 8 }, (_, index) => ({
          ...history[0],
          date: `2026-10-${String(index + 2).padStart(2, "0")}`,
          unitPrice: null,
        })),
      ],
      now,
    ),
  ).toBe(false);
  expect(
    cheaperThanUsual(
      product,
      history.map((entry) => ({ ...entry, storeId: "other" })),
      now,
    ),
  ).toBe(false);
  expect(
    cheaperThanUsual(
      product,
      history.map((entry) => ({ ...entry, date: "2026-10-11" })),
      now,
    ),
  ).toBe(false);
  expect(
    cheaperThanUsual(
      product,
      [
        ...history.map((entry) => ({
          ...entry,
          date: entry.date.replace("10", "09"),
          unitPrice: 100_000,
        })),
        ...Array.from({ length: 8 }, (_, index) => ({
          ...history[0],
          date: `2026-10-0${index + 1}`,
          unitPrice: 500,
        })),
      ],
      now,
    ),
  ).toBe(false);
  const campaign = {
    ...product,
    cataloguePricing: {
      amount: 900,
      unit: "KPL",
      basis: "per_item",
      approximate: false,
      deposit: 0,
      campaignPrice: 900,
    },
  };
  expect(currentOffer(campaign, now)).toBe(true);
  expect(currentOffer({ ...campaign, providerId: "k-ruoka" }, now)).toBe(false);
  expect(
    currentOffer(
      {
        ...campaign,
        cataloguePricing: { ...campaign.cataloguePricing, campaignPrice: 800 },
      },
      now,
    ),
  ).toBe(false);
  expect(
    currentOffer(
      {
        ...campaign,
        cataloguePricing: {
          ...campaign.cataloguePricing,
          campaignValidUntil: "2026-10-10",
        },
      },
      now,
    ),
  ).toBe(false);
});

describe("weighed estimates", () => {
  const requirement: Requirement = {
    id: "apple",
    name: "Omena",
    amount: 500,
    unit: "g",
    sources: [],
  };
  const product: Product = {
    id: "apple",
    ingredientId: "apple",
    name: "Omena",
    providerId: "demo-k",
    storeId: "store",
    available: true,
    price: null,
    deposit: 0,
    unit: "g",
    packAmount: 0,
    increment: 0,
    nativeUnit: "kg",
    observedAt: "2026-10-11T00:00:00Z",
    cataloguePricing: {
      amount: 249,
      unit: "kg",
      basis: "per_weight",
      approximate: true,
      deposit: 0,
    },
  };
  test("rounds kg and litre estimates to cents without invented packs or write authority", () => {
    const line = matchRequirement(requirement, [product]);
    expect(line).toMatchObject({
      approximate: true,
      packs: 0,
      total: 125,
      product,
    });
    expect(approximateCost({ ...requirement, amount: 333 }, product)).toBe(83);
    expect(
      approximateCost(
        { ...requirement, amount: 333, unit: "ml" },
        {
          ...product,
          unit: "ml",
          cataloguePricing: {
            ...product.cataloguePricing!,
            amount: 120,
            unit: "l",
            basis: "per_volume",
          },
        },
      ),
    ).toBe(40);
    expect(purchasable(requirement, product)).toBe(false);
    expect(
      purchasable(requirement, {
        ...product,
        price: 249,
        packAmount: 1000,
        increment: 1,
      }),
    ).toBe(false);
  });
  test.each([
    { amount: null },
    { unit: null },
    { unit: "pcs" },
    { basis: "unknown" },
    { amount: -1 },
    { amount: Number.MAX_SAFE_INTEGER },
    { deposit: 15 },
  ])("rejects unsupported/unsafe source facts %j", (override) => {
    expect(
      approximateCost(requirement, {
        ...product,
        cataloguePricing: { ...product.cataloguePricing!, ...override },
      }),
    ).toBeNull();
  });
  test("does not estimate incompatible units, stock or forbidden matches", () => {
    expect(approximateCost({ ...requirement, unit: "ml" }, product)).toBeNull();
    expect(
      approximateCost(requirement, { ...product, available: null }),
    ).toBeNull();
    expect(
      matchRequirement(requirement, [product], { exclusions: ["omena"] })
        .product,
    ).toBeNull();
    expect(
      matchRequirement(requirement, [product], {
        context: { ...initialState().context, storeId: "other" },
      }).product,
    ).toBeNull();
  });
  test("splits exact/approximate/unknown totals and marks common comparison as approximate", () => {
    const estimated = matchRequirement(requirement, [product]);
    const exact = {
      ...estimated,
      approximate: false,
      total: 300,
      packs: 1,
      requirement: { ...requirement, id: "pack" },
    };
    expect(
      priceBreakdown([
        estimated,
        exact,
        { ...exact, product: null, total: null },
      ]),
    ).toEqual({ exact: 300, approximate: 125, unknown: 1 });
    const result = compareBaskets([estimated], [{ ...estimated, total: 150 }]);
    expect(result.common).toEqual({
      rows: 1,
      a: 125,
      b: 150,
      approximate: true,
    });
    expect(result.a.missing).toBe(0);
    expect(result.a.approximate).toBe(125);
    expect(result.largest[0]).toMatchObject({
      difference: 25,
      approximate: true,
    });
  });
  test("estimated selections cannot enter transfer review", async () => {
    const provider = new DemoProvider("demo-k");
    await expect(
      createReview(provider, initialState().context, 0, [
        matchRequirement(requirement, [product]),
      ]),
    ).rejects.toThrow("unresolved");
    expect(provider.writes).toBe(0);
  });
});
describe("planning", () => {
  it("scales portions, merges ingredients and excludes leftovers and pantry items", () => {
    const state = initialState();
    state.staples = [];
    state.meals = [
      { id: "1", day: 0, recipeId: "pasta", servings: 2, leftovers: false },
      { id: "2", day: 1, recipeId: "pasta", servings: 4, leftovers: false },
      { id: "3", day: 2, recipeId: "pasta", servings: 4, leftovers: true },
    ];
    state.skipped = ["tomato:g"];
    expect(requirements(state)).toEqual([
      {
        id: "pasta",
        name: "Pasta",
        amount: 600,
        unit: "g",
        sources: ["Tomaattipasta", "Tomaattipasta"],
      },
    ]);
  });
  it("parses decimal commas without floating point conversion errors", () => {
    expect(parseAmount("0,125", "kg")).toBe(125);
    expect(parseAmount("1.001", "l")).toBe(1001);
    expect(() => parseAmount("1,5", "pcs")).toThrow();
  });
  it("minimizes purchase cost rather than unit price", async () => {
    const state = initialState();
    const provider = new DemoProvider("demo-k");
    const [small] = await provider.searchProducts(
      state.context,
      "pasta",
      "pasta",
    );
    small.price = 200;
    const large = { ...small, id: "large", packAmount: 1000, price: 300 };
    const requirement = {
      id: "pasta",
      name: "Pasta",
      amount: 500,
      unit: "g" as const,
      sources: [],
    };
    expect(
      match(requirement, [large, small], ["pasta", "large"]).product?.id,
    ).toBe("pasta");
    expect(
      match(
        { ...requirement, amount: 1000 },
        [large, small],
        ["pasta", "large"],
      ).product?.id,
    ).toBe("large");
    expect(match(requirement, [small], []).product).toBeNull();
  });
  it("has complete translation catalogues", () =>
    expect(Object.keys(fi).sort()).toEqual(Object.keys(en).sort()));
});
async function setup() {
  const state = initialState();
  const provider = new DemoProvider("demo-k");
  const products = await provider.searchProducts(
    state.context,
    "pasta",
    "pasta",
  );
  const line = match(
    { id: "pasta", name: "Pasta", amount: 500, unit: "g", sources: [] },
    products,
    ["pasta"],
  );
  const review = await createReview(provider, state.context, 0, [line]);
  const journal: Journal = {
    review,
    status: "ready",
    verified: [],
    uncertain: null,
    error: null,
  };
  return { state, provider, line, review, journal };
}
describe("reviewed cart transfers", () => {
  it("rejects price changes after approval before any write", async () => {
    const { provider, journal } = await setup();
    provider.priceChange = true;
    await transfer(provider, journal, () => {});
    expect(journal.error).toBe("priceChanged");
    expect(provider.writes).toBe(0);
  });
  it("rejects a changed pack unit before approval, transfer and recovery", async () => {
    const { provider, journal, state } = await setup();
    const search = provider.searchProducts.bind(provider);
    provider.searchProducts = async (...args) =>
      (await search(...args)).map((p) => ({ ...p, unit: "ml" }));
    await expect(
      createReview(provider, state.context, 0, journal.review.quotes),
    ).rejects.toThrow("priceChanged");
    await transfer(provider, journal, () => {});
    expect(journal.error).toBe("priceChanged");
    expect(provider.writes).toBe(0);
    await expect(resumeReview(provider, journal)).rejects.toThrow(
      "priceChanged",
    );
  });
  it("stops on cancellation without starting a write", async () => {
    const { provider, journal } = await setup();
    const controller = new AbortController();
    controller.abort();
    await transfer(provider, journal, () => {}, controller.signal);
    expect(journal.error).toBe("cancelled");
    expect(provider.writes).toBe(0);
  });
  it("adds to the baseline, retains unrelated items, and waits for durable intent", async () => {
    const { provider, journal, state } = await setup();
    let persisted = false;
    const original = provider.setQuantity.bind(provider);
    provider.setQuantity = async (c, t) => {
      expect(persisted).toBe(true);
      await original(c, t);
    };
    await transfer(provider, journal, async (j) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (j.uncertain) persisted = true;
    });
    expect(journal.status).toBe("verified");
    expect(
      (await provider.getCart(state.context)).lines.map((l) => [
        l.productId,
        l.quantity,
      ]),
    ).toEqual([
      ["bread", 1],
      ["pasta", 2],
    ]);
  });
  it("reconciles timeout after successful write without adding twice", async () => {
    const { provider, journal, state } = await setup();
    provider.failAfter = 1;
    await transfer(provider, journal, () => {});
    expect(journal.status).toBe("partial");
    expect(journal.uncertain).toBe("pasta");
    const review = await resumeReview(provider, journal);
    expect(review.targets).toHaveLength(0);
    await transfer(
      provider,
      { review, status: "ready", verified: [], uncertain: null, error: null },
      () => {},
    );
    expect(provider.writes).toBe(1);
    expect(
      (await provider.getCart(state.context)).lines.find(
        (l) => l.productId === "pasta",
      )?.quantity,
    ).toBe(2);
  });
  it("stops when the cart changes after review", async () => {
    const { provider, journal, state } = await setup();
    await provider.setQuantity(state.context, {
      productId: "bread",
      name: "Bread",
      unit: "kpl",
      before: 1,
      quantity: 3,
      price: 100,
    });
    await transfer(provider, journal, () => {});
    expect(journal.error).toBe("cartChanged");
    expect(provider.writes).toBe(1);
  });
  it("rejects price changes before review", async () => {
    const { provider, state, line } = await setup();
    provider.priceChange = true;
    await expect(
      createReview(provider, state.context, 0, [line]),
    ).rejects.toThrow("priceChanged");
  });
  it("detects apparent success without a cart change", async () => {
    const { provider, journal } = await setup();
    provider.setQuantity = async () => {};
    await transfer(provider, journal, () => {});
    expect(journal.status).toBe("partial");
    expect(journal.error).toBe("verificationFailed");
  });
});

it("keeps home rows visible separately from removed rows and applies quantity overrides", () => {
  const state = initialState();
  state.staples = [];
  state.meals = [
    { id: "one", day: 0, recipeId: "pasta", servings: 4, leftovers: false },
  ];
  state.extras = [{ id: "pasta", name: "Pasta", amount: 100, unit: "g" }];
  expect(requirements(state).find((r) => r.id === "pasta")?.amount).toBe(500);
  state.quantities = { "pasta:g": 1000 };
  state.skipped = ["pasta:g"];
  state.removed = ["tomato:g"];
  expect(requirements(state)).toEqual([]);
  expect(
    requirements(state, new Date(), true).map((r) => [r.id, r.amount]),
  ).toEqual([["pasta", 1000]]);
  state.skipped = [];
  expect(requirements(state).map((r) => r.id)).toEqual(["pasta"]);
});
test("household exclusions remove products before ranking and acceptance", () => {
  const requirement = {
    id: "meat",
    name: "Jauheliha",
    amount: 400,
    unit: "g" as const,
    sources: [],
  };
  const product = (id: string, name: string, price: number) => ({
    id,
    providerId: "demo-k",
    storeId: "s",
    name,
    ingredientId: "meat",
    packAmount: 400,
    unit: "g" as const,
    price,
    available: true,
    deposit: 0,
    nativeUnit: "kpl",
    increment: 1,
    observedAt: "",
  });
  const line = match(
    requirement,
    [
      product("1", "Sika-nauta jauheliha 400 g", 300),
      product("2", "Naudan jauheliha 400 g", 450),
    ],
    ["1", "2"],
    exclusionTerms("sika, ok"),
  );
  expect(exclusionTerms("Sika, ok\nPähkinä")).toEqual(["sika", "pähkinä"]);
  expect(line.product?.id).toBe("2");
  expect(line.candidates.map((p) => p.id)).toEqual(["2"]);
  expect(line.excluded).toBe(1);
});

test("profiles with earlier-week history remain compatible with shopping-list history", () => {
  const saved = {
    ...initialState(),
    history: [
      {
        savedAt: "2026-10-08T12:00:00Z",
        meals: [
          {
            id: "old",
            day: 0,
            recipeId: "pasta",
            servings: 4,
            leftovers: false,
          },
        ],
      },
    ],
  } as Record<string, unknown>;
  for (const key of [
    "listHistory",
    "note",
    "extras",
    "quantities",
    "removed",
    "receiptText",
    "productPreference",
  ])
    delete saved[key];
  const restored = stateSchema.parse(saved);
  expect(restored.history[0].meals[0].recipeId).toBe("pasta");
  expect(restored.listHistory).toEqual([]);
  expect(restored.extras).toEqual([]);
});
test("treats compounds and ready meals as different products", () => {
  expect(relevant("Coop valkosipuli 100 g", "Sipuli")).toBe(false);
  expect(relevant("Santa Maria 33G Sitruunapippuri", "Mustapippuri")).toBe(
    false,
  );
  expect(relevant("Santa Maria Jauhelihamauste 28g", "Jauheliha")).toBe(false);
  expect(relevant("Kokkikartano Lihamakaronilaatikko 400g", "Makaroni")).toBe(
    false,
  );
  expect(relevant("Rainbow keltasipuli 1 kg", "Keltasipuli")).toBe(true);
  expect(relevant("Kotimaista kananmunat M10 630 g", "Kananmuna")).toBe(true);
  expect(relevant("Myllyn Paras Makaroni 400g", "makaroni")).toBe(true);
  expect(
    relevant("Kotimaista kanan jauheliha 4% 400 g", "Naudan jauheliha"),
  ).toBe(false);
  expect(
    relevant("Atria Sika-nauta jauheliha 23% 400g", "Sika-nauta jauheliha"),
  ).toBe(true);
});
test("reads egg pack counts and plain-ingredient variants from live S-kaupat names", () => {
  expect(packFromName("Kotimaista vapaan kanan munat M10")).toEqual({
    amount: 10,
    unit: "pcs",
  });
  expect(packFromName("Kultamuna vapaa kananmuna M/L15 945g")).toEqual({
    amount: 15,
    unit: "pcs",
  });
  expect(
    packFromName("Kotimaista vapaan kanan munat omega-3 M6 348 g"),
  ).toEqual({ amount: 6, unit: "pcs" });
  expect(packFromName("Myllyn Paras Makaroni 400g")).toEqual({
    amount: 400,
    unit: "g",
  });
  expect(relevant("Kotimaista vapaan kanan munat M10", "Kananmuna")).toBe(true);
  expect(
    relevant("Coop Lasagne pasta, sisältää kananmunaa 500 g", "Kananmuna"),
  ).toBe(true);
  expect(relevant("Kotimaista sipuli 500 g", "Sipuli")).toBe(true);
  expect(relevant("Kotimaista sipulimix 1 kg", "Sipuli")).toBe(false);
  expect(relevant("Kotimaista kanan jauheliha 4% 400 g", "Jauheliha")).toBe(
    false,
  );
  expect(relevant("Atria Nauta-Kana Jauheliha 10% 400g", "Jauheliha")).toBe(
    false,
  );
  expect(
    relevant("Kotimaista sika-nauta jauheliha 23 % 400 g", "Jauheliha"),
  ).toBe(true);
  expect(
    relevant("Kotimaista kanan jauheliha 4% 400 g", "Kanan jauheliha"),
  ).toBe(true);
  expect(relevant("Meira Mustapippuri jauhettu 25g", "Mustapippuri")).toBe(
    true,
  );
});
test("remembers one store per chain and migrates profiles that have only the active store", () => {
  const old = { ...initialState() } as Record<string, unknown>;
  delete old.stores;
  const migrated = stateSchema.parse(old);
  expect(migrated.stores).toEqual({
    [migrated.context.providerId]: migrated.context,
  });
  const sStore = {
    providerId: "s-kaupat",
    storeId: "631940293",
    storeName: "S-market Herttoniemi",
    fulfillment: "pickup" as const,
  };
  const switched = stateSchema.parse({ ...migrated, context: sStore });
  expect(switched.context).toEqual(sStore);
  expect(switched.stores[migrated.context.providerId]).toEqual(
    migrated.context,
  );
  expect(switched.stores["s-kaupat"]).toEqual(sStore);
  // A saved state from this release still carries the active store where earlier releases read it.
  expect(JSON.parse(JSON.stringify(switched)).context).toEqual(sStore);
  // Entries filed under the wrong chain are dropped rather than trusted.
  const tampered = stateSchema.parse({
    ...switched,
    stores: { ...switched.stores, "k-ruoka": sStore },
  });
  expect(tampered.stores["k-ruoka"]).toBeUndefined();
});

test("a confirmed pack size makes a product without a readable label eligible and priced per pack", () => {
  const requirement = {
    id: "meat",
    name: "Jauheliha",
    amount: 600,
    unit: "g" as const,
    sources: [],
  };
  const unlabelled = {
    id: "u",
    providerId: "demo-k",
    storeId: "s",
    name: "Luomujauheliha",
    ingredientId: "meat",
    packAmount: 0,
    unit: "pcs" as const,
    price: 300,
    available: true,
    deposit: 0,
    nativeUnit: "kpl",
    increment: 1,
    observedAt: "",
  };
  const before = match(requirement, [unlabelled], ["u"]);
  expect(before.candidates.map((p) => p.id)).toEqual(["u"]);
  expect(before.product).toBeNull();
  const sized = applyPackSizes([unlabelled], { u: { amount: 300, unit: "g" } });
  expect(sized[0]).toMatchObject({ packAmount: 300, unit: "g" });
  const after = match(requirement, sized, ["u"]);
  expect([after.product?.id, after.packs, after.total]).toEqual(["u", 2, 600]);
  // A size the store states itself is never overridden.
  const stated = { ...unlabelled, packAmount: 400, unit: "g" as const };
  expect(
    applyPackSizes([stated], { u: { amount: 300, unit: "g" } })[0].packAmount,
  ).toBe(400);
});
