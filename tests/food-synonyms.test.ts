import { expect, test } from "vitest";
import { synonymQuery } from "../src/domain/food-synonyms";
import { relevant } from "../src/domain/planner";
import { candidateQueries, MAX_SEARCH_QUERIES } from "../src/stores/candidates";
import {
  createFixtureService,
  type FixtureChain,
} from "./fixtures/ai-shopping/environment";
import type { BaselineProduct } from "./fixtures/matching-baseline";

const strips = (name: string) => ({
  id: "strips",
  name,
  amount: 300,
  unit: "g" as const,
  sources: ["extra"],
});

test("kana and broileri name the same bird; the cut, state and animal still have to match", () => {
  for (const [product, ingredient] of [
    ["Pirkka broilerin fileesuikale 300 g", "Kanan fileesuikale"],
    ["Atria Perhetilan Kanan Fileesuikale 300 g", "Broilerin fileesuikale"],
    ["Kariniemen Kananpojan fileesuikale 300 g", "Broilerin fileesuikale"],
    ["Kariniemen Kananpojan fileesuikale 300 g", "Kanan fileesuikale"],
    ["Broilerin fileesuikaleet 450 g", "kana fileesuikale"],
    ["Broilerin jauheliha 400 g", "Kanan jauheliha"],
    // A state the shopper named is kept across the synonym.
    ["Broilerin fileesuikale marinoitu 300 g", "Marinoitu kanan fileesuikale"],
  ])
    expect([product, ingredient, relevant(product, ingredient)]).toEqual([
      product,
      ingredient,
      true,
    ]);
  for (const [product, ingredient] of [
    // Another cut, a whole bird or another animal is never the same purchase.
    ["Broilerin jauheliha 400 g", "Kanan fileesuikale"],
    ["Kokonainen broileri n. 1,3 kg", "Kanan fileesuikale"],
    ["Broilerin rintafilee 400 g", "Kanan fileesuikale"],
    ["Kalkkunan fileesuikale 300 g", "Kanan fileesuikale"],
    ["Kalkkunan fileesuikale 300 g", "Broilerin fileesuikale"],
    ["Kanan fileesuikale 300 g", "Kalkkunan fileesuikale"],
    // A synonym does not loosen the state: cooked, marinated or frozen is another product.
    ["Broilerin fileesuikale hunajamarinoitu 300 g", "Kanan fileesuikale"],
    ["Kypsä broilerin fileesuikale 250 g", "Kanan fileesuikale"],
    ["Grillattu kanan fileesuikale 250 g", "Broilerin fileesuikale"],
    ["Broilerin fileesuikale pakaste 1 kg", "Kanan fileesuikale"],
    // Eggs are one word and unrelated.
    ["Broilerin fileesuikale 300 g", "Kananmuna"],
    ["Kananmunat M10", "Broileri"],
  ])
    expect([product, ingredient, relevant(product, ingredient)]).toEqual([
      product,
      ingredient,
      false,
    ]);
});

test("one synonym query follows the original name and the three-query limit holds", () => {
  expect(synonymQuery("Kanan fileesuikale")).toBe("Broilerin fileesuikale");
  expect(synonymQuery("broilerin fileesuikale")).toBe("kanan fileesuikale");
  expect(synonymQuery("Kananpojan rintafilee")).toBe("Broilerin rintafilee");
  expect(synonymQuery("Kana")).toBe("Broileri");
  for (const name of ["Kananmuna", "Kalkkunan fileesuikale", "Maito", ""])
    expect(synonymQuery(name)).toBeNull();
  expect(candidateQueries(strips("Kanan fileesuikale"))).toEqual([
    "Kanan fileesuikale",
    "Broilerin fileesuikale",
  ]);
  // Chicken mince keeps its three queries: the synonym equals the existing type hint.
  const mince = candidateQueries(
    {
      id: "mince",
      name: "Kanan jauheliha",
      amount: 400,
      unit: "g",
      sources: ["extra"],
    },
    ["broilerin jauheliha"],
  );
  expect(mince).toEqual([
    "Kanan jauheliha",
    "Broilerin jauheliha",
    "jauheliha",
  ]);
  expect(mince.length).toBeLessThanOrEqual(MAX_SEARCH_QUERIES);
  expect(
    candidateQueries(strips("Kanan fileesuikale"), ["a", "b"]),
  ).toHaveLength(MAX_SEARCH_QUERIES);
});

const plain: BaselineProduct = {
  id: "plain-strips",
  name: "Pirkka broilerin fileesuikale 300 g",
  price: 3.49,
};
const kana: BaselineProduct = {
  id: "kana-strips",
  name: "Atria Perhetilan Kanan Fileesuikale 300 g",
  price: 3.99,
};
const others: BaselineProduct[] = [
  {
    id: "honey",
    name: "Broilerin fileesuikale hunajamarinoitu 300 g",
    price: 2.49,
  },
  { id: "cooked", name: "Kypsä broilerin fileesuikale 250 g", price: 2.29 },
  { id: "mince", name: "Broilerin jauheliha 300 g", price: 1.99 },
  { id: "turkey", name: "Kalkkunan fileesuikale 300 g", price: 1.89 },
  { id: "whole", name: "Kokonainen broileri 300 g", price: 1.49 },
];
async function priced(
  chain: FixtureChain,
  name: string,
  catalogue: Record<string, BaselineProduct[]>,
  options: { failure?: "search-error"; exclusions?: string } = {},
) {
  const env = await createFixtureService(chain, catalogue, options.failure);
  await env.service.save({
    ...env.service.state,
    household: {
      ...env.service.state.household,
      exclusions: options.exclusions ?? "",
    },
    extras: [{ id: "strips", name, amount: 300, unit: "g" }],
  });
  const result = await env.service.buildBasket().catch((error: Error) => error);
  const searches = env.tools.filter((t) => t === "search_products").length;
  return { ...env, result, searches, line: env.service.basket[0] };
}

for (const chain of ["k-ruoka", "s-kaupat"] as const) {
  test(`${chain}: strips sold under the other name are found and the retailer's own product is kept`, async () => {
    // The shopper's wording finds nothing useful; the other wording finds the strips.
    const asKana = await priced(chain, "Kanan fileesuikale", {
      "Kanan fileesuikale": [others[2]],
      "Broilerin fileesuikale": [...others, plain],
    });
    expect(asKana.searches).toBe(2);
    expect(asKana.line.product).toMatchObject({
      id: "plain-strips",
      name: "Pirkka broilerin fileesuikale 300 g",
      providerId: chain,
    });
    expect(asKana.line.total).toBe(349);
    expect(asKana.line.requirement.name).toBe("Kanan fileesuikale");

    const asBroileri = await priced(chain, "Broilerin fileesuikale", {
      "Broilerin fileesuikale": [],
      "Kanan fileesuikale": [others[3], kana],
    });
    expect(asBroileri.searches).toBe(2);
    expect(asBroileri.line.product).toMatchObject({
      id: "kana-strips",
      name: "Atria Perhetilan Kanan Fileesuikale 300 g",
    });

    // A retailer whose own search already returns the other wording needs one read.
    const direct = await priced(chain, "Kanan fileesuikale", {
      "Kanan fileesuikale": [plain, ...others],
    });
    expect(direct.searches).toBe(1);
    expect(direct.line.product?.id).toBe("plain-strips");
    // After a restart the same selected product is restored without a read.
    const quote = await direct.storage.get("last-quote");
    expect(JSON.stringify(quote)).toContain("plain-strips");
  });

  test(`${chain}: conflicting, unavailable, excluded and failed reads stay unselected`, async () => {
    // Only other cuts, states and animals are sold: nothing is chosen, however cheap.
    const conflict = await priced(chain, "Kanan fileesuikale", {
      "*": [...others],
    });
    expect(conflict.searches).toBe(2);
    expect(conflict.line.product).toBeNull();
    expect(conflict.line.total).toBeNull();

    const unavailable = await priced(chain, "Kanan fileesuikale", {
      "*": [{ ...plain, available: false }, ...others],
    });
    expect(unavailable.line.product).toBeNull();

    // An explicit household exclusion still removes the synonym-named product.
    const excluded = await priced(
      chain,
      "Kanan fileesuikale",
      { "*": [plain] },
      { exclusions: "pirkka" },
    );
    expect(excluded.line.product).toBeNull();

    // A retailer error is terminal: the other wording is not tried.
    const failed = await priced(
      chain,
      "Kanan fileesuikale",
      { "*": [plain] },
      { failure: "search-error" },
    );
    expect(failed.result).toBeInstanceOf(Error);
    expect(failed.searches).toBe(1);
    expect(failed.service.basket).toEqual([]);
  });
}
