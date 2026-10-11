import { expect, test } from "vitest";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import type { StoreContext } from "../src/domain/model";
import { weighedSearch, weighedReadback } from "./fixtures/weighed-contract";
import sPublic from "./fixtures/weighed-public-s-search.json";
import kPublic from "./fixtures/weighed-public-k-search.json";

test("public piece estimates retain explicit weights and never derive weights from rounded prices", async () => {
  expect(kPublic.detail.explicitAveragePieceWeightGrams).toBe(175);
  expect(kPublic.detail.publicProductFields.weight).toEqual({
    value: 0.175,
    unitText: "kg",
  });
  const raw = sPublic.detail.publicProductFields;
  expect(raw.measurement.pceApproxWeight * 1000).toBe(163);
  expect(sPublic.detail.explicitAveragePieceWeightGrams).toBe(163);
  expect(Math.round((raw.price / raw.comparisonPrice) * 1000)).not.toBe(163);
  expect(raw.pricing).toMatchObject({
    salesUnit: "PCE",
    quantityMultiplier: 1,
  });

  // Independently authored worker-shaped boundary from its audited mapping of
  // the public raw fields. This is not a captured MCP response or stock check.
  const calls: string[] = [];
  const provider = new SKaupatProvider(async (tool) => {
    calls.push(tool);
    if (tool === "search_products")
      return {
        products: [
          {
            id: sPublic.product.ean,
            name: sPublic.product.name,
            price: raw.price,
            approximatePrice: raw.approxPrice,
            priceBasis: "per_item",
            quantityUnit: raw.priceUnit,
          },
        ],
      };
    if (tool === "check_basket")
      return { items: [{ productId: sPublic.product.ean, status: "ok" }] };
    throw new Error("Unexpected mutation");
  });
  const [product] = await provider.searchProducts(
    {
      providerId: "s-kaupat",
      storeId: "fixture-store",
      storeName: "Synthetic store",
      fulfillment: "pickup",
    },
    "banaani",
    "banana",
  );
  expect(product.cataloguePricing).toMatchObject({
    amount: 28,
    unit: "KPL",
    basis: "per_item",
    approximate: true,
  });
  expect(product).toMatchObject({
    price: null,
    nativeUnit: "kpl",
    increment: 0,
  });
  expect(calls).toEqual(["search_products", "check_basket"]);
});

test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s: weighed wire facts survive, fractional readback stays exact and writes remain disabled",
  async (chain) => {
    const calls: string[] = [];
    const call = async (tool: string) => {
      calls.push(tool);
      if (tool === "search_products")
        return chain === "k-ruoka" ? weighedSearch.k : weighedSearch.s;
      if (tool === "check_basket")
        return { items: [{ productId: "synthetic-weighed", status: "ok" }] };
      if (tool === "get_cart") return weighedReadback.k;
      if (tool === "login_status")
        return { status: "logged_in", accountId: "synthetic-account" };
      if (tool === "get_shopping_lists") return weighedReadback.s;
      throw new Error("Unexpected mutation");
    };
    const provider =
      chain === "k-ruoka"
        ? new KRuokaProvider(call)
        : new SKaupatProvider(call);
    const context: StoreContext = {
      providerId: chain,
      storeId: "fixture-store",
      storeName: "Synthetic store",
      fulfillment: "pickup",
    };
    const [product] = await provider.searchProducts(context, "omena", "apple");
    expect(product.cataloguePricing).toMatchObject({
      amount: 249,
      unit: chain === "k-ruoka" ? "kg" : "KG",
      approximate: true,
    });
    expect(product).toMatchObject({
      price: null,
      nativeUnit: "kg",
      increment: 0,
      packAmount: 0,
    });
    const cart = await provider.getCart(context);
    expect(cart.lines[0]).toMatchObject({ quantity: 0.333, unit: "kg" });
    const before = calls.length;
    await expect(
      provider.setQuantity(context, {
        ...cart.lines[0],
        quantity: 0.5,
        before: 0.333,
        price: 125,
        accountId: cart.accountId,
      }),
    ).rejects.toThrow("unitMismatch");
    expect(calls).toHaveLength(before);
  },
);
