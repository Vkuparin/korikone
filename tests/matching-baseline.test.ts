import { test, expect } from "vitest";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { KRuokaProvider, type ToolCall } from "../src/stores/k-ruoka";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { matchingBaseline } from "./fixtures/matching-baseline";
import { draftPrompt, validateDraft } from "../src/ai/draft";
import { initialState } from "../src/domain/model";

// Current expectations are separate from the immutable released audit observations.
const currentSelections: Record<string, string | null> = {
  "milk-compound": "cow",
  "bread-compound": "bread",
  "onion-compound": "onion",
  "rice-compound": "rice",
  "coffee-plain": null,
  "milk-name-only-unsafe": "cow",
  "coffee-whole-pack-cost": null,
};

for (const chain of ["k-ruoka", "s-kaupat"] as const) {
  for (const fixture of matchingBaseline) {
    test(`released selection reference with current ${chain}: ${fixture.id} (${fixture.cause})`, async () => {
      const { service, tools } = await createFixtureService(chain, {
        "*": fixture.products,
      });
      await service.save({
        ...service.state,
        staples: [],
        context: {
          providerId: chain,
          storeId: "synthetic-store",
          storeName: "Synthetic store",
          fulfillment: "pickup",
        },
        extras: [
          {
            id: fixture.id,
            name: fixture.name,
            amount: fixture.amount,
            unit: fixture.unit,
          },
        ],
      });
      await service.buildBasket();
      expect(service.basket).toHaveLength(1);
      const line = service.basket[0];
      const expected =
        fixture.id in currentSelections
          ? currentSelections[fixture.id]
          : fixture.baselineSelected;
      expect(line.product?.id ?? null).toBe(expected);
      expect(line.total === null).toBe(expected === null);
      expect(tools.filter((name) => name === "search_products")).toHaveLength(
        expected === null ? 2 : 1,
      );
      expect(tools.some((name) => /add|set|create|execute/.test(name))).toBe(
        false,
      );
      expect(service.developmentRequests).toBe(0);
      if (line.product) expect(fixture.admissible).toContain(line.product.id);
    });
  }
}

for (const chain of ["k-ruoka", "s-kaupat"] as const) {
  test(`released adapter baseline ${chain}: malformed normalization is rejected`, async () => {
    const call: ToolCall = async () =>
      chain === "k-ruoka"
        ? {
            results: [
              {
                ean: "synthetic",
                name: "Maito 1 l",
                price: "unknown",
                priceIsApproximate: false,
                isAvailable: true,
                priceUnit: "kpl",
              },
            ],
          }
        : {
            products: [
              {
                id: "synthetic",
                name: "Maito 1 l",
                price: "unknown",
                depositPrice: null,
                approximatePrice: false,
                priceBasis: "per_item",
                packSize: null,
                quantityUnit: "KPL",
              },
            ],
          };
    const adapter =
      chain === "k-ruoka"
        ? new KRuokaProvider(call)
        : new SKaupatProvider(call);
    await expect(
      adapter.searchProducts(
        {
          providerId: chain,
          storeId: "synthetic",
          storeName: "Synthetic",
          fulfillment: "pickup",
        },
        "Maito",
        "milk",
      ),
    ).rejects.toThrow();
  });
  test(`released adapter baseline ${chain}: search errors remain errors instead of empty results`, async () => {
    const call: ToolCall = async () => {
      throw new Error("storeUnavailable");
    };
    const adapter =
      chain === "k-ruoka"
        ? new KRuokaProvider(call)
        : new SKaupatProvider(call);
    await expect(
      adapter.searchProducts(
        {
          providerId: chain,
          storeId: "synthetic",
          storeName: "Synthetic",
          fulfillment: "pickup",
        },
        "Maito",
        "milk",
      ),
    ).rejects.toThrow("storeUnavailable");
  });
}

test("provenance fix distinguishes generic mince from model-added beef specificity", () => {
  const state = initialState();
  const note = "Jauhelihaa 400 g";
  expect(draftPrompt(note, state)).toContain("Keep generic groceries generic");
  const draft = validateDraft(
    JSON.stringify({
      items: [
        {
          id: "mince",
          name: "Naudan jauheliha",
          amount: 400,
          unit: "g",
          provenance: "model-assumed",
        },
      ],
    }),
    state,
  );
  expect(draft.items[0].name).toBe("Naudan jauheliha");
  expect(draft.items[0]).not.toHaveProperty("provenance");
  expect(draft.items[0]).not.toHaveProperty("category");
  expect(draft.items[0].classification).toMatchObject({
    category: "mince",
    provenance: "model-assumed",
    qualifiers: [{ kind: "meat", value: "beef", provenance: "model-assumed" }],
  });
});
