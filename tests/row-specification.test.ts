import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { applyEdits } from "../src/domain/edits";
import { matchRequirement } from "../src/domain/matching";
import { initialState, type Product } from "../src/domain/model";
import { requirements } from "../src/domain/planner";
import {
  createFixtureService,
  type FixtureChain,
} from "./fixtures/ai-shopping/environment";
import type { BaselineProduct } from "./fixtures/matching-baseline";
import { editInference } from "./helpers/edit-inference";

const grandiosa: BaselineProduct = {
  id: "grandiosa",
  name: "Grandiosa Pakastepizza Meat Lovers 550 g",
  price: 3.99,
};
const plainPizza: BaselineProduct = {
  id: "plain-pizza",
  name: "Rainbow Pakastepizza Kinkku 350 g",
  price: 1.49,
};
const knorr: BaselineProduct = {
  id: "knorr",
  name: "Knorr Lihaliemikuutio 12 x 10 g",
  price: 1.89,
};
const pirkka: BaselineProduct = {
  id: "pirkka-cube",
  name: "Pirkka Lihaliemikuutio 12 x 10 g",
  price: 0.99,
};
const onion: BaselineProduct = {
  id: "onion",
  name: "Sipuli Suomi 1 kg",
  price: 1.29,
};
const red: BaselineProduct = {
  id: "red",
  name: "Punasipuli 500 g",
  price: 0.99,
};
const milk: BaselineProduct = {
  id: "milk",
  name: "Kevytmaito 1 l",
  price: 1.09,
};
const catalogue = (): Record<string, BaselineProduct[]> => ({
  Pakastepizza: [plainPizza],
  "Pakastepizza Grandiosa Meat Lover's": [plainPizza, grandiosa],
  Lihaliemikuutio: [pirkka, knorr],
  "Knorr Lihaliemikuutio": [knorr, pirkka],
  Punasipuli: [red],
  Sipuli: [onion, red],
  sipuli: [onion, red],
  Maito: [milk],
  "*": [],
});
async function playtest(chain: FixtureChain, exclusions = "") {
  const env = await createFixtureService(chain, catalogue());
  await env.service.save({
    ...env.service.state,
    household: { ...env.service.state.household, exclusions },
    extras: [
      { id: "pizza", name: "Pakastepizza", amount: 5, unit: "pcs" },
      { id: "cube", name: "Lihaliemikuutio", amount: 2, unit: "pcs" },
      { id: "onion", name: "Punasipuli", amount: 125, unit: "g" },
      { id: "milk", name: "Maito", amount: 2000, unit: "ml" },
    ],
  });
  await env.service.buildBasket();
  const searches = () =>
    env.tools.filter((t) => t === "search_products").length;
  return { ...env, searches, ai: await editInference() };
}
const line = (service: Service, id: string) =>
  service.basket.find((l) => l.requirement.id === id)!;
const specify = (service: Service, instruction: string, row: string) => ({
  revision: service.state.revision,
  instruction,
  consent: true as const,
  focusTargetId: `row:${row}`,
});

for (const chain of ["k-ruoka", "s-kaupat"] as const)
  test(`${chain}: a product, type or brand named for the selected row corrects that row only`, async () => {
    const { service, searches, ai, storage } = await playtest(chain);
    expect(line(service, "pizza").product?.id).toBe("plain-pizza");
    expect(line(service, "cube").product?.id).toBe("pirkka-cube");
    expect(line(service, "onion").product?.id).toBe("red");
    const milkLine = structuredClone(line(service, "milk"));

    let before = searches();
    const pizza = await service.editList(
      specify(service, "Pakastepizza Grandiosa Meat Lover's", "pizza:pcs"),
      ai.session,
    );
    expect(pizza.edit).toMatchObject({
      status: "applied",
      applied: [
        {
          op: "specifyItem",
          targetId: "row:pizza:pcs",
          name: "Pakastepizza",
          to: "Pakastepizza Grandiosa Meat Lover's",
        },
      ],
    });
    // The row keeps its identity and amount; only its wording and product changed.
    expect(line(service, "pizza")).toMatchObject({
      requirement: {
        id: "pizza",
        name: "Pakastepizza Grandiosa Meat Lover's",
        specifiedFrom: "Pakastepizza",
        amount: 5,
        unit: "pcs",
      },
      product: { id: "grandiosa", providerId: chain },
      packs: 5,
    });
    expect(service.state.extras[0].name).toBe("Pakastepizza");
    expect(service.state.recipes).toHaveLength(initialState().recipes.length);
    expect(service.state.meals).toEqual([]);
    // One row was read again, within its three-query limit; the others were not.
    expect(searches() - before).toBeGreaterThan(0);
    expect(searches() - before).toBeLessThanOrEqual(3);
    expect(line(service, "milk")).toEqual(milkLine);
    expect(line(service, "cube").product?.id).toBe("pirkka-cube");

    before = searches();
    await service.editList(
      specify(service, "Knorr Lihaliemikuutio", "cube:pcs"),
      ai.session,
    );
    expect(line(service, "cube")).toMatchObject({
      requirement: { name: "Knorr Lihaliemikuutio", amount: 2 },
      product: { id: "knorr" },
      packs: 1,
    });
    expect(searches() - before).toBeLessThanOrEqual(3);

    await service.editList(specify(service, "Sipuli", "onion:g"), ai.session);
    expect(line(service, "onion")).toMatchObject({
      requirement: { name: "Sipuli", specifiedFrom: "Punasipuli", amount: 125 },
      product: { id: "onion" },
    });
    expect(service.state.specifications).toEqual({
      "pizza:pcs": "Pakastepizza Grandiosa Meat Lover's",
      "cube:pcs": "Knorr Lihaliemikuutio",
      "onion:g": "Sipuli",
    });
    expect(ai.sessions.map((s) => s.callCount)).toEqual([1, 1, 1]);
    expect(line(service, "milk")).toEqual(milkLine);

    // The corrections and their products survive a restart without a read.
    const restarted = new Service(storage);
    restarted.developmentMode = true;
    restarted.registry.register(service.registry.get(chain));
    before = searches();
    await restarted.init();
    expect(restarted.basket).toEqual(service.basket);
    expect(searches()).toBe(before);

    // Undo puts the last row back as it was; naming the row's own name removes the wording.
    await service.undoEdit({ revision: service.state.revision });
    expect(line(service, "onion")).toMatchObject({
      requirement: { name: "Punasipuli" },
      product: { id: "red" },
    });
    await service.editList(
      specify(service, "lihaliemikuutio", "cube:pcs"),
      ai.session,
    );
    expect(service.state.specifications["cube:pcs"]).toBeUndefined();
    expect(line(service, "cube").product?.id).toBe("pirkka-cube");
  });

test("a brand alone keeps the row's grocery, and an excluded brand is never substituted", async () => {
  const { service, ai } = await playtest("s-kaupat");
  await service.editList(specify(service, "Knorr", "cube:pcs"), ai.session);
  expect(line(service, "cube")).toMatchObject({
    requirement: { name: "Knorr Lihaliemikuutio" },
    product: { id: "knorr" },
  });

  const excluded = await playtest("s-kaupat", "knorr");
  const snapshot = await excluded.service.editList(
    specify(excluded.service, "Knorr Lihaliemikuutio", "cube:pcs"),
    excluded.ai.session,
  );
  // The household exclusion still applies, and the cheaper other brand is not chosen instead.
  expect(line(excluded.service, "cube")).toMatchObject({
    product: null,
    total: null,
  });
  expect(snapshot.state.household.exclusions).toBe("knorr");
});

test("invalid output, cancellation and a stale revision change nothing", async () => {
  const { service, searches } = await playtest("k-ruoka");
  const state = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  const before = searches();
  for (const operation of [
    { op: "specifyItem", target: "row:saffron:g", name: "Sahrami" },
    { op: "specifyItem", target: "row:pizza:pcs" },
    { op: "specifyItem", target: "row:pizza:pcs", name: " " },
    { op: "specifyItem", target: "meal:nope", name: "Pizza" },
    { op: "specifyItem", name: "Pizza" },
  ]) {
    const invalid = await editInference(
      Array(2).fill(JSON.stringify({ version: 1, operations: [operation] })),
    );
    await expect(
      service.editList(
        specify(service, "Grandiosa", "pizza:pcs"),
        invalid.session,
      ),
    ).rejects.toThrow("invalidDraft");
    expect(invalid.sessions[0].callCount).toBe(2);
  }
  const cancelled = await editInference();
  cancelled.controller.abort();
  await expect(
    service.editList(
      specify(service, "Grandiosa", "pizza:pcs"),
      cancelled.session,
    ),
  ).rejects.toThrow("cancelled");
  const stale = await editInference();
  await expect(
    service.editList(
      { ...specify(service, "Grandiosa", "pizza:pcs"), revision: 0 },
      stale.session,
    ),
  ).rejects.toThrow();
  expect(service.state).toEqual(state);
  expect(service.basket).toEqual(basket);
  expect(searches()).toBe(before);
});

test("the domain operation keeps amount, unit and sources and is not a local edit", async () => {
  const state = initialState();
  state.staples = [];
  state.revision = 3;
  state.meals = [
    { id: "m", recipeId: "soup", day: 0, servings: 4, leftovers: false },
  ];
  state.quantities = { "potato:g": 1500 };
  const before = requirements(state).find((r) => r.id === "potato")!;
  const {
    state: next,
    changedKeys,
    applied,
  } = applyEdits(state, {
    version: 1,
    revision: 3,
    operations: [
      { op: "specifyItem", rowKey: "potato:g", name: "Rosamunda peruna" },
    ],
  });
  expect(changedKeys).toEqual(["potato:g"]);
  expect(applied).toEqual([
    {
      op: "specifyItem",
      targetId: "row:potato:g",
      name: before.name,
      to: "Rosamunda peruna",
      unit: "g",
    },
  ]);
  expect(requirements(next).find((r) => r.id === "potato")).toEqual({
    ...before,
    name: "Rosamunda peruna",
    specifiedFrom: before.name,
    classification: undefined,
  });
  expect(next.recipes).toEqual(state.recipes);
  for (const operations of [
    [{ op: "specifyItem", rowKey: "saffron:g", name: "Sahrami" }],
    [{ op: "specifyItem", rowKey: "potato:g", name: "" }],
    [{ op: "specifyItem", rowKey: "potato:g", name: before.name }],
  ])
    expect(() =>
      applyEdits(state, { version: 1, revision: 3, operations }),
    ).toThrow();
  const service = new Service({
    get: async () => undefined,
    set: async () => {},
    setMany: async () => {},
  });
  await expect(
    service.editLocally({
      revision: 0,
      operations: [{ op: "specifyItem", rowKey: "potato:g", name: "Peruna" }],
    }),
  ).rejects.toThrow();
});

test("a product with the named brand but not the generic word is offered, never chosen silently", () => {
  const requirement = {
    id: "cheese",
    name: "Juusto Oltermanni",
    specifiedFrom: "Juusto",
    amount: 500,
    unit: "g" as const,
    sources: ["extra"],
  };
  const product = (id: string, name: string, price: number): Product => ({
    id,
    providerId: "demo-k",
    storeId: "demo-helsinki",
    ingredientId: "cheese",
    name,
    packAmount: 500,
    unit: "g",
    price,
    deposit: 0,
    available: true,
    nativeUnit: "kpl",
    increment: 1,
    observedAt: "2026-10-13T00:00:00Z",
  });
  const brandOnly = product("brand", "Valio Oltermanni 500 g", 599);
  const edam = product("edam", "Juusto Edam 500 g", 399);
  const full = product("full", "Valio Oltermanni juusto 500 g", 649);
  const offered = matchRequirement(requirement, [brandOnly, edam]);
  expect(offered.product).toBeNull();
  expect(offered.matching).toMatchObject({ status: "approval-required" });
  expect(offered.candidates.map((p) => p.id)).toContain("brand");
  expect(offered.matching!.decisions.find((d) => d.id === "edam")?.status).toBe(
    "rejected",
  );
  // The shopper's approval selects it, and a product with every word wins without asking.
  expect(
    matchRequirement(requirement, [brandOnly, edam], { accepted: ["brand"] })
      .product?.id,
  ).toBe("brand");
  expect(
    matchRequirement(requirement, [brandOnly, edam, full]).product?.id,
  ).toBe("full");
  // Without a specification the brand-only product is not the ingredient at all.
  expect(
    matchRequirement({ ...requirement, specifiedFrom: undefined }, [brandOnly])
      .matching?.status,
  ).toBe("unresolved");
});
