import { expect, test } from "vitest";
import {
  pizzaPackageContent,
  packageAmount,
} from "../src/domain/package-content";
import { matchRequirement } from "../src/domain/matching";
import { priceMetrics } from "../src/domain/price-ranking";
import { transferableLine } from "../src/domain/planner";
import { createReview } from "../src/application/transfer";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { Service } from "../src/application/service";
import type { StoreProvider } from "../src/stores/provider";
import type { Product, Requirement } from "../src/domain/model";
const req: Requirement = {
  id: "pizza",
  name: "Pakastepizza",
  amount: 5,
  unit: "pcs",
  sources: ["extra"],
};
const product = (name: string, price = 400): Product => {
  const content = pizzaPackageContent(name);
  return {
    id: name,
    providerId: "s-kaupat",
    storeId: "synthetic-store",
    ingredientId: "pizza",
    name,
    packAmount: content?.weightGrams ?? 350,
    unit: "g",
    price,
    deposit: 0,
    available: true,
    nativeUnit: "kpl",
    increment: 1,
    observedAt: "2026-10-13T00:00:00Z",
    ...(content ? { packageContent: content } : {}),
  };
};
test.each([
  ["Pakastepizza 350 g", 1, 350, 5, 2000],
  ["Pakastepizza 2 x 350 g", 2, 700, 3, 1200],
  ["Pakastepizza 3 kpl 900 g", 3, 900, 2, 800],
  ["Pakastepizzat 2 kpl 700 g", 2, 700, 3, 1200],
] as const)(
  "verified fixed content %s rounds enough whole packages",
  (name, count, grams, packs, total) => {
    const p = product(name),
      line = matchRequirement(req, [p]);
    expect(p.packageContent).toMatchObject({ count, weightGrams: grams });
    expect(line).toMatchObject({ packs, total, product: { id: name } });
    expect(transferableLine(line)).toBe(true);
    expect(priceMetrics(req, p)).toMatchObject({
      packs,
      payable: total,
      surplus: packs * count - 5,
      estimated: false,
      unitValue: { unit: "pcs" },
    });
    expect(priceMetrics({ ...req, unit: "g", amount: 701 }, p)?.packs).toBe(
      Math.ceil(701 / grams),
    );
  },
);
test.each([
  "Pakastepizza",
  "Pakastepizza mini 350 g",
  "Pakastepizza 2 pack 700 g",
  "Pakastepizza 2.5 kpl 700 g",
  "Pakastepizza 2 x 350 g 1 kpl",
  "Pakastepizza 350 g 400 g",
  "Pizzapohja 350 g",
  "Pizzat 700 g",
])("ambiguous or other content never invents a pizza count: %s", (name) => {
  const p = product(name);
  expect(p.packageContent).toBeUndefined();
  expect(matchRequirement(req, [p]).product).toBeNull();
});
test("split catalogue labels, forged counts, incompatible units, stock, brand/variety and chosen price basis stay guarded", () => {
  expect(
    pizzaPackageContent("Grandiosa Pakastepizza", "2 x 350 g"),
  ).toMatchObject({ count: 2, weightGrams: 700 });
  expect(
    pizzaPackageContent("Grandiosa Pakastepizza 2 kpl", "700 g"),
  ).toMatchObject({ count: 2, weightGrams: 700 });
  expect(pizzaPackageContent("Pakastepizza 350 g", "400 g")).toBeUndefined();
  expect(pizzaPackageContent("Pakastepizza 2 x 350 g", "700 g")).toMatchObject({
    count: 2,
    weightGrams: 700,
  });
  expect(pizzaPackageContent("Pakastepizza 700 g", "2 x 350 g")).toMatchObject({
    count: 2,
    weightGrams: 700,
  });
  expect(
    pizzaPackageContent("Pakastepizza 2 kpl 700 g", "3 kpl 700 g"),
  ).toBeUndefined();
  const p = product("Pakastepizza 350 g");
  expect(
    packageAmount(
      { ...p, packageContent: { ...p.packageContent!, count: 2 } },
      "pcs",
    ),
  ).toBeNull();
  expect(matchRequirement({ ...req, unit: "ml" }, [p]).product).toBeNull();
  expect(
    matchRequirement(req, [{ ...p, available: false }]).product,
  ).toBeNull();
  expect(
    matchRequirement({ ...req, name: "Grandiosa Pakastepizza Meat Lover" }, [
      product("Other Pakastepizza Margherita 350 g"),
    ]).product,
  ).toBeNull();
  const three = product("Pakastepizza 3 x 350 g", 1100);
  expect(
    matchRequirement(req, [p, three], { priceBasis: "unit" }).product?.id,
  ).toBe(three.id);
  expect(
    matchRequirement(req, [p, three], { priceBasis: "total" }).product?.id,
  ).toBe(p.id);
  expect(packageAmount({ ...p, nativeUnit: "kg" }, "pcs")).toBeNull();
  expect(pizzaPackageContent("Xtra Pakastepizza 350 g")).toMatchObject({
    count: 1,
  });
  expect(
    transferableLine({ ...matchRequirement(req, [p]), packs: 4, total: 1600 }),
  ).toBe(false);
});
test.each([
  ["k-ruoka", "Pakastepizza 350 g", 1, 350, 5],
  ["s-kaupat", "Pakastepizza 350 g", 1, 350, 5],
  ["k-ruoka", "Pakastepizza 2 x 350 g", 2, 700, 3],
  ["s-kaupat", "Pakastepizza 2 x 350 g", 2, 700, 3],
] as const)(
  "%s %s passes actual adapter, retained quote and reviewed transfer validation",
  async (chain, name, count, weightGrams, packs) => {
    const rawProduct = { id: "pizza-one", name: name as string, price: 4 };
    const env = await createFixtureService(chain, {
      Pakastepizza: [rawProduct],
    });
    await env.service.save({
      ...env.service.state,
      extras: [{ ...req, sources: undefined }],
    });
    await env.service.buildBasket();
    const line = env.service.basket[0];
    expect(line).toMatchObject({
      packs,
      total: packs * 400,
      product: { packageContent: { count, weightGrams } },
    });
    const adapter = env.service.registry.get(chain);
    const restarted = new Service(env.storage);
    restarted.developmentMode = true;
    restarted.registry.register(adapter);
    await restarted.init();
    expect(restarted.basket[0]).toMatchObject({ packs, total: packs * 400 });
    // Actual search/normalization stays in use; only the read-only cart boundary is supplied locally.
    const reviewProvider: StoreProvider = new Proxy(adapter, {
      get(target, key) {
        if (key === "getCart")
          return async () => ({
            accountId: "synthetic-account",
            context: env.service.state.context,
            lines: [],
          });
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const review = await createReview(
      reviewProvider,
      env.service.state.context,
      1,
      [line],
    );
    expect(review.targets[0]).toMatchObject({
      productId: "pizza-one",
      quantity: packs,
      unit: "kpl",
      price: packs * 400,
    });
    rawProduct.name = `Pakastepizza ${count + 1} kpl ${weightGrams} g`;
    await expect(
      createReview(reviewProvider, env.service.state.context, 1, [line]),
    ).rejects.toThrow("priceChanged");
    expect(
      env.tools.every((tool) =>
        ["search_products", "check_basket", "get_delivery_options"].includes(
          tool,
        ),
      ),
    ).toBe(true);
  },
);
