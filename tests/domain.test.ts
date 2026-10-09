import { describe, it, expect, test } from "vitest";
import { packFromName } from "../src/stores/k-ruoka";
import {
  initialState,
  parseAmount,
  stateSchema,
  type Journal,
} from "../src/domain/model";
import {
  requirements,
  match,
  exclusionTerms,
  relevant,
} from "../src/domain/planner";
import { DemoProvider } from "../src/stores/demo";
import {
  createReview,
  transfer,
  resumeReview,
} from "../src/application/transfer";
import { en, fi } from "../src/ui/i18n";
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
