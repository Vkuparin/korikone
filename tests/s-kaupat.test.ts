import { test, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  SKaupatProvider,
  sKaupatError,
  sKaupatWorker,
} from "../src/stores/s-kaupat";
import { createReview, transfer } from "../src/application/transfer";
import type { BasketLine, StoreContext } from "../src/domain/model";
const context: StoreContext = {
  providerId: "s-kaupat",
  storeId: "store-1",
  storeName: "Synthetic store",
  fulfillment: "pickup",
};
const product = (overrides: Record<string, unknown> = {}) => ({
  id: "1",
  name: "Kevytmaito 1 l",
  price: 1.09,
  depositPrice: null,
  approximatePrice: false,
  priceBasis: "per_item",
  packSize: "1 l",
  quantityUnit: "KPL",
  ...overrides,
});
test("maps server error codes to message keys and hides unknown ones", () => {
  const error = (code: string) =>
    sKaupatError({ schemaVersion: "1.0", error: { code } }).message;
  expect(error("session_expired")).toBe("loginRequired");
  expect(error("browser_unavailable")).toBe("browserRequired");
  expect(error("store_not_found")).toBe("chooseStore");
  expect(error("something_new")).toBe("storeUnavailable");
  expect(sKaupatError("not json").message).toBe("storeUnavailable");
});
test("prices only fixed packs and takes stock from the basket check", async () => {
  const provider = new SKaupatProvider(async (name) =>
    name === "search_products"
      ? {
          products: [
            product(),
            product({ id: "2", priceBasis: "per_kg", approximatePrice: true }),
            product({ id: "3", packSize: null, name: "Pasta" }),
            product({ id: "4", depositPrice: 0.15 }),
          ],
        }
      : {
          items: [
            { productId: "1", status: "ok" },
            { productId: "2", status: "ok" },
            { productId: "3", status: "unknown" },
            { productId: "4", status: "unavailable" },
          ],
        },
  );
  const products = await provider.searchProducts(context, "maito", "milk");
  expect(products.map((p) => [p.price, p.available, p.deposit])).toEqual([
    [109, true, 0],
    [null, true, 0],
    [null, null, 0],
    [109, false, 15],
  ]);
  expect(products[0]).toMatchObject({ packAmount: 1000, unit: "ml" });
});
test("requires a login and a single Korikone list", async () => {
  const signedOut = new SKaupatProvider(async () => ({
    status: "logged_out",
    displayName: null,
  }));
  await expect(signedOut.getCart(context)).rejects.toThrow("loginRequired");
  const list = { id: "l", name: "Korikone", items: [] };
  const twoLists = new SKaupatProvider(async (name) =>
    name === "login_status"
      ? { status: "logged_in", displayName: "Testi", accountId: "sk_1" }
      : { lists: [list, { ...list, id: "m" }] },
  );
  await expect(twoLists.getCart(context)).rejects.toThrow("unsupportedCart");
  const noAccountId = new SKaupatProvider(async () => ({
    status: "logged_in",
    displayName: "Testi",
  }));
  await expect(noAccountId.getCart(context)).rejects.toThrow(
    "workerIncompatible",
  );
});
test("writes absolute quantities without substitutes and reports uncertainty", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  let status = "updated";
  const provider = new SKaupatProvider(async (name, args) => {
    calls.push([name, args]);
    if (name === "login_status")
      return { status: "logged_in", displayName: "Testi", accountId: "sk_1" };
    if (name === "get_shopping_lists")
      return {
        lists: [
          {
            id: "list-1",
            name: "Korikone",
            items: [
              {
                productId: "1",
                name: "Maito",
                quantity: 2,
                product: { priceBasis: "per_item" },
              },
            ],
          },
          { id: "other", name: "Viikonloppu", items: [] },
        ],
      };
    return { results: [{ productId: "1", status }] };
  });
  const target = {
    productId: "1",
    accountId: "s-kaupat:sk_1",
    name: "Maito",
    quantity: 4,
    before: 2,
    unit: "kpl",
    price: 218,
  };
  await provider.setQuantity(context, target);
  expect(calls.at(-1)).toEqual([
    "add_to_shopping_list",
    {
      listId: "list-1",
      storeId: "store-1",
      items: [{ productId: "1", quantity: 4, allowSubstitutes: false }],
    },
  ]);
  status = "uncertain";
  await expect(provider.setQuantity(context, target)).rejects.toThrow(
    "writeUncertain",
  );
  await expect(
    provider.setQuantity(context, { ...target, before: 1 }),
  ).rejects.toThrow("cartChanged");
  await expect(
    provider.setQuantity(context, { ...target, accountId: "s-kaupat:sk_2" }),
  ).rejects.toThrow("accountChanged");
  await expect(
    provider.setQuantity(context, { ...target, quantity: 100 }),
  ).rejects.toThrow("unitMismatch");
});

// Runs the pinned release itself in its offline demo mode, over a real stdio connection.
const data = mkdtempSync(join(tmpdir(), "korikone-s-kaupat-"));
const worker = sKaupatWorker({
  script: resolve("vendor/s-kaupat/s-kaupat-mcp.cjs"),
  dataDir: data,
  demo: true,
});
afterAll(async () => {
  await worker.close();
  rmSync(data, { recursive: true, force: true });
});
test("transfers a reviewed basket to the pinned server's shopping list", async () => {
  const provider = new SKaupatProvider((name, args) => worker.call(name, args));
  await expect(worker.call("place_order", {})).rejects.toThrow("unsupported");
  const [store] = await provider.searchStores("Helsinki");
  expect(store.providerId).toBe("s-kaupat");
  await provider.selectStore(store);
  await expect(provider.getCart(store)).rejects.toThrow("loginRequired");
  await worker.call("start_login", {});
  const milk = (await provider.searchProducts(store, "maito", "milk"))[0];
  expect(milk).toMatchObject({ available: true, packAmount: 1000 });
  expect(milk.price).toBeGreaterThan(0);
  const line: BasketLine = {
    requirement: {
      id: "milk",
      name: "maito",
      amount: 2000,
      unit: "ml",
      sources: [],
    },
    product: milk,
    packs: 2,
    total: 2 * milk.price!,
    candidates: [milk],
  };
  const review = await createReview(provider, store, 1, [line]);
  expect(review.baseline.lines).toEqual([]);
  const journal = await transfer(
    provider,
    { review, status: "ready", verified: [], uncertain: null, error: null },
    () => {},
  );
  expect(journal).toMatchObject({ status: "verified", error: null });
  expect(review.baseline.accountId).toMatch(/^s-kaupat:sk_/);
  expect(review.baseline.accountName).toBeTruthy();
  expect(review.baseline.accountName).not.toContain("sk_");
  expect((await provider.getCart(store)).lines).toEqual([
    { productId: milk.id, name: milk.name, quantity: 2, unit: "kpl" },
  ]);
}, 30000);
