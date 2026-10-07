import { describe, it, expect } from "vitest";
import { initialState, parseAmount, type Journal } from "../src/domain/model";
import { requirements, match } from "../src/domain/planner";
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
