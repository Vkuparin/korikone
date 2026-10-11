import { expect, test } from "vitest";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import type { StoreContext } from "../src/domain/model";
import { weighedSearch, weighedReadback } from "./fixtures/weighed-contract";

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
