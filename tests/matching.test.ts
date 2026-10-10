import { expect, test } from "vitest";
import {
  candidateSuitability,
  matchRequirement,
  categoryPreferenceSchema,
  type MatchingOptions,
} from "../src/domain/matching";
import { retailerEvidence } from "../src/stores/candidates";
import {
  inferredClassification,
  type Classification,
} from "../src/domain/categories";
import type { Product, Requirement } from "../src/domain/model";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { Service } from "../src/application/service";
import { pricingKey } from "../src/application/quotes";
import { createReview, transfer } from "../src/application/transfer";
import { DemoProvider } from "../src/stores/demo";

const request = (
  name: string,
  classification?: Classification,
): Requirement => ({
  id: "food",
  name,
  amount: 500,
  unit: "g",
  sources: ["extra"],
  ...(classification ? { classification } : {}),
});
const product = (name: string, overrides: Partial<Product> = {}): Product => ({
  id: name,
  ingredientId: "food",
  providerId: "k-ruoka",
  storeId: "synthetic-store",
  name,
  price: 100,
  deposit: 0,
  available: true,
  packAmount: 500,
  unit: "g",
  nativeUnit: "kpl",
  increment: 1,
  observedAt: "2026-01-01T00:00:00.000Z",
  evidence: retailerEvidence(name),
  ...overrides,
});

test.each([
  ["Maito", "Kevytmaito 1 l", "Kaura maito 1 l"],
  ["Leipä", "Ruisleipä 500 g", "Ruisnäkkileipä 300 g"],
  ["Kananmuna", "Kananmunat 10 kpl", "Viiriäisen munat 12 kpl"],
  ["Jauheliha", "Naudan jauheliha 400 g", "Soija jauheliha 400 g"],
  ["Sipuli", "Keltasipuli 500 g", "Valkosipuli 100 g"],
  ["Riisi", "Basmati riisi 1 kg", "Valmis riisi 250 g"],
  ["Ruokakerma", "Ruokakerma 200 ml", "Kaura kerma 200 ml"],
  ["Kahvi", "Kahvi suodatinjauhatus 500 g", "Kahvi kapseli 100 g"],
])(
  "approved default for %s rejects the cheaper look-alike",
  (name, safe, unsafe) => {
    const line = matchRequirement(request(name), [
      product(unsafe, { price: 1 }),
      product(safe),
    ]);
    expect(line.product?.name).toBe(safe);
    expect(line.candidates.map((p) => p.name)).not.toContain(unsafe);
    expect(
      matchRequirement(request(name), [product(unsafe)], { accepted: [unsafe] })
        .product,
    ).toBeNull();
  },
);

test.each([
  ["Jauheliha", "Broilerin jauheliha 400 g"],
  ["Sipuli", "Punasipuli 500 g"],
  ["Kerma", "Kuohukerma 200 ml"],
  ["Kahvi", "Kahvipavut 500 g"],
  ["Kahvi", "Kahvi 500 g"],
])("%s alternative needs approval: %s", (name, alternative) => {
  const req = request(name),
    p = product(alternative);
  expect(candidateSuitability(req, p).status).toBe("approval-required");
  expect(matchRequirement(req, [p]).product).toBeNull();
  expect(matchRequirement(req, [p], { accepted: [p.id] }).product?.id).toBe(
    p.id,
  );
});

test("explicit and recipe qualifiers bind; model assumptions do not", () => {
  const skimmed = product("Rasvaton maito 1 l"),
    whole = product("Täysmaito 1 l", { price: 1 });
  const inferred = inferredClassification("Rasvaton maito", "recipe-inferred")!;
  expect(
    matchRequirement(request("Maito", inferred), [whole, skimmed]).product?.id,
  ).toBe(skimmed.id);
  const assumed = inferredClassification("Rasvaton maito", "model-assumed")!;
  expect(
    matchRequirement(request("Maito", assumed), [whole, skimmed]).product?.id,
  ).toBe(whole.id);
  const note = "rasvaton maito";
  const explicit: Classification = {
    category: "milk",
    provenance: "explicit-note",
    evidence: { start: 0, end: note.length, quote: note },
    qualifiers: [
      {
        kind: "fat",
        value: "skimmed",
        provenance: "explicit-note",
        evidence: { start: 0, end: note.length, quote: note },
      },
    ],
  };
  const preference = categoryPreferenceSchema.parse({
    category: "milk",
    qualifiers: [{ kind: "fat", value: "whole" }],
    strength: "required",
  });
  const options: MatchingOptions = {
    preference,
    sourceNote: note,
    accepted: [whole.id],
  };
  expect(
    matchRequirement(request("Maito", explicit), [whole, skimmed], options)
      .product?.id,
  ).toBe(skimmed.id);
  expect(preference.qualifiers[0].value).toBe("whole");
  expect(() =>
    matchRequirement(request("Maito", explicit), [skimmed], {
      sourceNote: "maito",
    }),
  ).toThrow();
});

test("Required stays unresolved; Preferred alternatives require approval", () => {
  const req = request("Maito"),
    p = product("Täysmaito 1 l");
  const preference = categoryPreferenceSchema.parse({
    category: "milk",
    qualifiers: [{ kind: "fat", value: "skimmed" }],
    strength: "required",
  });
  expect(
    matchRequirement(req, [p], { preference, accepted: [p.id] }).product,
  ).toBeNull();
  const preferred = { ...preference, strength: "preferred" as const };
  expect(
    matchRequirement(req, [p], { preference: preferred }).matching?.reason,
  ).toBe("preference-missing");
  expect(
    matchRequirement(req, [p], { preference: preferred, accepted: [p.id] })
      .product?.id,
  ).toBe(p.id);
  expect(
    matchRequirement(request("Täysmaito"), [p], { preference }).matching
      ?.reason,
  ).toBe("constraint-conflict");
});

test("unknown facts, household exclusions and invalid catalogue identity stay hard", () => {
  const req = request("Laktoositon maito");
  for (const p of [
    product("Maito 1 l"),
    product("Laktoositon kevytmaito 1 l", { ingredientId: "other" }),
    product("Laktoositon kevytmaito 1 l", {
      evidence: retailerEvidence("Täysmaito 1 l"),
    }),
  ]) {
    expect(matchRequirement(req, [p], { accepted: [p.id] }).product).toBeNull();
  }
  const p = product("Laktoositon kevytmaito 1 l");
  expect(
    matchRequirement(req, [p], { exclusions: ["kevyt"], accepted: [p.id] })
      .product,
  ).toBeNull();
  expect(
    matchRequirement(req, [p], { exclusions: ["gluten"], accepted: [p.id] })
      .matching?.reason,
  ).toBe("dietary-evidence");
});

test("whole-pack cost ranks after category and brand preference", () => {
  const req = { ...request("Kahvi"), amount: 600 };
  const small = product("Kahvi suodatinjauhatus 250 g", {
    price: 200,
    packAmount: 250,
  });
  const large = product("Kahvi suodatinjauhatus 500 g", { price: 250 });
  const branded = product("Pirkka kahvi suodatinjauhatus 500 g", {
    price: 300,
  });
  expect(matchRequirement(req, [small, large]).total).toBe(500);
  expect(
    matchRequirement(req, [small, large], { productPreference: "price" })
      .product?.id,
  ).toBe(large.id);
  expect(
    matchRequirement(req, [large, branded], { productPreference: "storeBrand" })
      .product?.id,
  ).toBe(branded.id);
  for (const bad of [
    product("Kahvi 500 g", { price: -1 }),
    product("Kahvi 500 g", { deposit: -1 }),
    product("Kahvi 500 g", { increment: Infinity }),
  ])
    expect(
      matchRequirement(req, [bad], { accepted: [bad.id] }).product,
    ).toBeNull();
});

test.each(["Kondensoitu maito 400 ml", "Maustettu basmati riisi 250 g"])(
  "prepared product %s cannot satisfy the plain category",
  (name) => {
    const req = request(name.includes("maito") ? "Maito" : "Riisi");
    const p = product(name);
    expect(matchRequirement(req, [p], { accepted: [p.id] }).product).toBeNull();
  },
);

test.each([
  [
    "Naudan jauheliha",
    "Naudan jauheliha 400 g",
    "Sika-nauta jauheliha 400 g",
    "Jauheliha 400 g",
  ],
  [
    "Kahvipavut",
    "Kahvipavut 500 g",
    "Kahvi suodatinjauhatus 500 g",
    "Kahvi 500 g",
  ],
  ["Rasvaton maito", "Rasvaton maito 1 l", "Täysmaito 1 l", "Maito 1 l"],
])(
  "specific legacy request %s keeps unknown and conflicting types rejected",
  (name, safe, wrong, unknown) => {
    const req = request(name);
    expect(
      matchRequirement(req, [product(safe), product(wrong, { price: 1 })])
        .product?.name,
    ).toBe(safe);
    for (const label of [wrong, unknown])
      expect(
        matchRequirement(req, [product(label)], { accepted: [label] }).product,
      ).toBeNull();
  },
);

test("alias-found quote is freshly verified and changed type stops before writes", async () => {
  const provider = new DemoProvider("k-ruoka");
  const context = {
    providerId: provider.id,
    storeId: "synthetic-store",
    storeName: "Synthetic",
    fulfillment: "pickup" as const,
  };
  const req = request("Sipulia");
  let current = product("Keltasipuli 500 g", { id: "onion" });
  const reads: string[] = [];
  provider.searchProducts = async (_context, query) => {
    reads.push(query);
    return query === "sipuli" ? [current] : [];
  };
  const line = matchRequirement(req, [current], { context });
  const review = await createReview(provider, context, 0, [line]);
  expect(reads).toEqual(["Sipulia", "sipuli"]);
  current = product("Punasipuli 500 g", { id: "onion" });
  await expect(createReview(provider, context, 0, [line])).rejects.toThrow(
    "priceChanged",
  );
  const journal = await transfer(
    provider,
    { review, status: "ready", verified: [], uncertain: null, error: null },
    () => {},
  );
  expect(journal.error).toBe("priceChanged");
  expect(provider.writes).toBe(0);
});

test("fresh review and transfer read the saved type alias and reject a changed Required type", async () => {
  const provider = new DemoProvider("k-ruoka");
  const context = {
    providerId: provider.id,
    storeId: "synthetic-store",
    storeName: "Synthetic",
    fulfillment: "pickup" as const,
  };
  const req = { ...request("Maito"), amount: 1000, unit: "ml" as const };
  const options = {
    preferences: [
      categoryPreferenceSchema.parse({
        category: "milk",
        qualifiers: [{ kind: "fat", value: "skimmed" }],
        strength: "required",
      }),
    ],
  };
  let current = product("Rasvaton maito 1 l", {
    id: "skim",
    unit: "ml",
    packAmount: 1000,
  });
  const reads: string[] = [];
  provider.searchProducts = async (_context, query) => {
    reads.push(query);
    return query === "rasvaton maito" ? [current] : [];
  };
  const line = matchRequirement(req, [current], { context, ...options });
  const review = await createReview(provider, context, 0, [line], {}, options);
  expect(reads).toEqual(["Maito", "rasvaton maito"]);
  current = product("Täysmaito 1 l", {
    id: "skim",
    unit: "ml",
    packAmount: 1000,
  });
  const journal = await transfer(
    provider,
    { review, status: "ready", verified: [], uncertain: null, error: null },
    () => {},
    undefined,
    {},
    options,
  );
  expect(journal.error).toBe("priceChanged");
  expect(provider.writes).toBe(0);
});

test.each(["k-ruoka", "s-kaupat"] as const)(
  "real %s adapter, Service acceptance and quote restart enforce suitability",
  async (chain) => {
    const { service, storage, tools } = await createFixtureService(chain, {
      "*": [
        { id: "plant", name: "Kaura maito 1 l", price: 0.1 },
        { id: "cow", name: "Laktoositon kevytmaito 1 l", price: 1.2 },
      ],
    });
    await service.save({
      ...service.state,
      extras: [
        { id: "food", name: "Laktoositon maito", amount: 1000, unit: "ml" },
      ],
    });
    await service.buildBasket();
    expect(service.basket[0].product?.id).toBe("cow");
    await expect(
      service.accept({ ingredientId: "food", productId: "plant" }),
    ).rejects.toThrow("unresolved");
    expect(tools.filter((t) => t === "search_products")).toHaveLength(1);
    expect(tools.some((t) => /add|update|write/.test(t))).toBe(false);
    const restored = new Service(storage);
    await restored.init();
    expect(restored.basket[0].product?.id).toBe("cow");
    expect(restored.basket[0].matching?.category).toBe("milk");
    expect(
      pricingKey({
        ...service.state,
        extras: [
          {
            ...service.state.extras[0],
            classification: inferredClassification(
              "Täysmaito",
              "recipe-inferred",
            )!,
          },
        ],
      }),
    ).not.toBe(pricingKey(service.state));
  },
);
