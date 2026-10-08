import { test, expect } from "vitest";
import { KRuokaProvider, packFromName } from "../src/stores/k-ruoka";
import type { StoreContext } from "../src/domain/model";
const context: StoreContext = {
  providerId: "k-ruoka",
  storeId: "N137",
  storeName: "Synthetic store",
  fulfillment: "pickup",
};
test("normalizes supported pack labels and rejects ambiguous multipacks", () => {
  expect(packFromName("Pasta 0,5 kg")).toEqual({ amount: 500, unit: "g" });
  expect(packFromName("Kerma 2 dl")).toEqual({ amount: 200, unit: "ml" });
  expect(packFromName("Milk 6 x 1 l")).toBeNull();
  expect(packFromName("Product with no pack")).toBeNull();
});
test("does not turn weight pricing or missing prices into fixed-price packs", async () => {
  const provider = new KRuokaProvider(async () => ({
    results: [
      {
        ean: "1",
        name: "Apple 1 kg",
        price: 2,
        priceUnit: "kg",
        priceIsApproximate: true,
        isAvailable: true,
      },
      {
        ean: "2",
        name: "Pasta 500 g",
        priceUnit: "kpl",
        priceIsApproximate: false,
        isAvailable: true,
      },
    ],
  }));
  const products = await provider.searchProducts(context, "test", "test");
  expect(products.map((p) => p.price)).toEqual([null, null]);
});
test("rejects anonymous and wrong-store carts", async () => {
  const cart = {
    basketId: "cart",
    account: null,
    store: { id: "N137", name: "test" },
    items: [],
  };
  const provider = new KRuokaProvider(async () => cart);
  await expect(provider.getCart(context)).rejects.toThrow("loginRequired");
  await expect(
    new KRuokaProvider(async () => ({
      ...cart,
      account: "synthetic",
      store: { id: "other", name: "other" },
    })).getCart(context),
  ).rejects.toThrow("contextChanged");
});
test("writes absolute quantity using cart item ID and explicit native unit", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const provider = new KRuokaProvider(async (name, args) => {
    calls.push([name, args]);
    return {
      basketId: "cart",
      account: "synthetic",
      store: { id: "N137", name: "test" },
      items: [
        {
          itemId: "cart-line-7",
          ean: "123",
          name: "Pasta",
          amount: 2,
          unit: "kpl",
        },
      ],
    };
  });
  await provider.setQuantity(context, {
    productId: "123",
    accountId: "synthetic",
    name: "Pasta",
    quantity: 4,
    before: 2,
    price: 200,
    unit: "kpl",
  });
  expect(calls[1]).toEqual([
    "update_cart_item",
    { store_id: "N137", item_id: "cart-line-7", quantity: 4, unit: "kpl" },
  ]);
  await expect(
    provider.setQuantity(context, {
      productId: "123",
      accountId: "synthetic",
      name: "Pasta",
      quantity: 4,
      before: 1,
      price: 200,
      unit: "kpl",
    }),
  ).rejects.toThrow("cartChanged");
});
test("new cart lines prohibit substitutions", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const provider = new KRuokaProvider(async (name, args) => {
    calls.push([name, args]);
    return {
      basketId: "cart",
      account: "synthetic",
      store: { id: "N137", name: "test" },
      items: [],
    };
  });
  await provider.setQuantity(context, {
    productId: "123",
    accountId: "synthetic",
    name: "Pasta",
    quantity: 1,
    before: 0,
    price: 200,
    unit: "kpl",
  });
  expect(calls[1]).toEqual([
    "add_to_cart",
    {
      store_id: "N137",
      ean: "123",
      quantity: 1,
      unit: "kpl",
      allow_substitutes: false,
    },
  ]);
});
