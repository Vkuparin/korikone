import { expect, test } from "vitest";
import {
  buildResolutionBatch,
  resolutionLimits,
  resolutionRequestSchema,
  resolutionResultSchema,
  validateResolutionResult,
} from "../src/domain/resolution";
import { matchRequirement, type MatchingOptions } from "../src/domain/matching";
import { inferredClassification } from "../src/domain/categories";
import type { BasketLine, Product, Requirement } from "../src/domain/model";
import { retailerEvidence } from "../src/stores/candidates";
import { createFixtureService } from "./fixtures/ai-shopping/environment";

const source = {
  revision: 7,
  context: {
    providerId: "k-ruoka",
    storeId: "private-store",
    storeName: "Private account location",
    fulfillment: "pickup" as const,
  },
};
function req(name = "Kerma", id = "private-requirement"): Requirement {
  return { id, name, amount: 200, unit: "ml", sources: ["private-recipe"] };
}
function product(name: string, overrides: Partial<Product> = {}): Product {
  return {
    id: `private-sku-${name}`,
    ingredientId: "private-requirement",
    providerId: "k-ruoka",
    storeId: "private-store",
    name,
    price: 100,
    deposit: 0,
    available: true,
    packAmount: 200,
    unit: "ml",
    nativeUnit: "kpl",
    increment: 1,
    observedAt: "2026-01-01",
    evidence: retailerEvidence(name),
    ...overrides,
  };
}
function cream(): BasketLine {
  return matchRequirement(
    req(),
    [
      product("Ruokakerma 200 ml"),
      product("Kuohukerma 200 ml", { price: 200 }),
    ],
    { context: source.context },
  );
}
const choice = {
  version: 1,
  choices: [
    {
      rowId: "row-0",
      candidateId: "candidate-0",
      status: "approval-required",
      reason: "type-alternative",
    },
  ],
};

test.each([
  ["Maito", "Kevytmaito 1 l", "Täysmaito 1 l", "ml"],
  ["Kananmuna", "Kananmunat 6 kpl", "Kananmunat 10 kpl", "pcs"],
  [
    "Kahvi",
    "Kahvi suodatinjauhatus 500 g",
    "Kahvi suodatinjauhatus 250 g",
    "g",
  ],
] as const)("clear %s uses no resolver batch", (name, a, b, unit) => {
  const requirement = { ...req(name), unit };
  const line = matchRequirement(requirement, [
    product(a, { unit }),
    product(b, { unit, price: 200 }),
  ]);
  const batch = buildResolutionBatch([line], source);
  expect(batch.plannedCalls).toBe(0);
  expect(batch.request).toBeNull();
  expect(batch.coverage[0].reason).toBe("clear");
});

test("one batch binds meaningful alternatives without accepting, writing or leaking account identifiers", () => {
  const lines = [cream()];
  const before = structuredClone(lines);
  const batch = buildResolutionBatch(lines, source);
  expect(batch.plannedCalls).toBe(1);
  expect(batch.request?.rows[0].candidates.map((p) => p.family)).toEqual([
    "dairy-cream",
    "dairy-cream",
  ]);
  expect(
    batch.request?.rows[0].candidates.map((p) => p.qualifiers[0].value),
  ).toEqual(["cooking", "whipping"]);
  expect(JSON.stringify(batch.request)).not.toMatch(
    /private-|storeId|providerId|observedAt|sources/,
  );
  const suggestions = validateResolutionResult(batch, choice, lines, source);
  expect(suggestions).toEqual([
    {
      requirementKey: "private-requirement:ml",
      productId: lines[0].candidates[0].id,
      status: "approval-required",
      reason: "type-alternative",
    },
  ]);
  expect(lines).toEqual(before);
  expect(lines[0].product).toBeNull();
  expect(Object.isFrozen(batch.request?.rows[0].candidates)).toBe(true);
  expect(Object.isFrozen(lines[0].candidates)).toBe(false);
});

test("empty, same-type, invalid stock/price/pack and hard conflicts do not trigger reasoning", () => {
  const cases = [
    [],
    [product("Ruokakerma 200 ml"), product("Brand ruokakerma 200 ml")],
    [
      product("Ruokakerma 200 ml", { available: null }),
      product("Kuohukerma 200 ml", { price: null }),
    ],
    [
      product("Ruokakerma 200 ml", { packAmount: 0 }),
      product("Kuohukerma 200 ml", { unit: "g" }),
    ],
    [product("Kaura kerma 200 ml"), product("Soija kerma 200 ml")],
  ];
  for (const products of cases)
    expect(
      buildResolutionBatch([matchRequirement(req(), products)], source)
        .plannedCalls,
    ).toBe(0);
  const constrained = {
    ...req(),
    classification: inferredClassification("Ruokakerma", "recipe-inferred")!,
  };
  expect(
    buildResolutionBatch(
      [
        matchRequirement(constrained, [
          product("Kuohukerma 200 ml"),
          product("Kerma 200 ml"),
        ]),
      ],
      source,
    ).request,
  ).toBeNull();
  const excluded: MatchingOptions = { exclusions: ["milk"] };
  expect(buildResolutionBatch([cream()], source, excluded).request).toBeNull();
});

test("hard rejected and unpurchasable products never enter a meaningful batch", () => {
  const line = cream();
  line.candidates.push(
    product("Kaura kerma 200 ml", { price: 1 }),
    product("Kerma 200 ml", { price: null }),
    product("Kerma 200 ml", { id: "wrong-context", storeId: "wrong" }),
  );
  const batch = buildResolutionBatch([line], source);
  expect(batch.request?.rows[0].candidates.map((p) => p.name)).toEqual([
    "Ruokakerma 200 ml",
    "Kuohukerma 200 ml",
  ]);
});

test("same-type representatives use domain whole-pack cost including deposits", () => {
  const line = cream();
  line.candidates.push(
    product("Cheap ruokakerma 100 ml", { packAmount: 100, price: 60 }),
    product("Deposit ruokakerma 200 ml", { price: 1, deposit: 150 }),
  );
  const batch = buildResolutionBatch([line], source);
  expect(batch.request?.rows[0].candidates[0]).toMatchObject({
    name: "Ruokakerma 200 ml",
    packs: 1,
    total: 100,
  });
});

test("partial output keeps omitted rows explicitly unresolved; unknown/duplicate IDs and fabricated facts reject", () => {
  const lines = [cream()];
  const batch = buildResolutionBatch(lines, source);
  expect(
    validateResolutionResult(
      batch,
      { version: 1, choices: [] },
      lines,
      source,
    )[0],
  ).toMatchObject({
    productId: null,
    status: "unresolved",
    reason: "no-response",
  });
  for (const choices of [
    [{ ...choice.choices[0], rowId: "row-1" }],
    [{ ...choice.choices[0], candidateId: "candidate-4" }],
    [choice.choices[0], choice.choices[0]],
    [{ ...choice.choices[0], price: 1 }],
    [{ ...choice.choices[0], status: "resolved" }],
  ])
    expect(() =>
      validateResolutionResult(batch, { version: 1, choices }, lines, source),
    ).toThrow();
  expect(
    resolutionResultSchema.safeParse({
      version: 1,
      choices: [
        {
          rowId: "row-0",
          candidateId: null,
          status: "unresolved",
          reason: "insufficient-evidence",
        },
      ],
    }).success,
  ).toBe(true);
});

test("changed revision, store, quantity, product evidence, consent or preference invalidate the batch", () => {
  const lines = [cream()];
  const batch = buildResolutionBatch(lines, source);
  expect(() =>
    validateResolutionResult(batch, choice, lines, { ...source, revision: 8 }),
  ).toThrow("resolutionStale");
  expect(() =>
    validateResolutionResult(batch, choice, lines, {
      ...source,
      context: { ...source.context, storeId: "other" },
    }),
  ).toThrow("resolutionStale");
  for (const mutate of [
    (copy: BasketLine[]) => {
      copy[0].requirement.amount++;
    },
    (copy: BasketLine[]) => {
      copy[0].candidates[0].price = 1;
    },
    (copy: BasketLine[]) => {
      copy[0].candidates[0].evidence!.family = "plant-cream";
    },
    (copy: BasketLine[]) => {
      copy[0].product = copy[0].candidates[0];
    },
  ]) {
    const copy = structuredClone(lines);
    mutate(copy);
    expect(() => validateResolutionResult(batch, choice, copy, source)).toThrow(
      "resolutionStale",
    );
  }
  expect(() =>
    validateResolutionResult(batch, choice, lines, source, {
      accepted: [lines[0].candidates[0].id],
    }),
  ).toThrow("resolutionStale");
  expect(() =>
    validateResolutionResult({ ...batch }, choice, lines, source),
  ).toThrow("resolutionStale");
  const copy = structuredClone(lines);
  copy[0].candidates[0].observedAt = "later";
  expect(validateResolutionResult(batch, choice, copy, source)[0].status).toBe(
    "approval-required",
  );
});

test("row and payload bounds report every omitted requirement without truncating names", () => {
  const lines = Array.from({ length: 20 }, (_, i) => {
    const line = cream();
    line.requirement.id = `food-${i}`;
    line.candidates.forEach((p) => (p.ingredientId = `food-${i}`));
    return line;
  });
  const batch = buildResolutionBatch(lines, source);
  expect(batch.request?.rows).toHaveLength(resolutionLimits.rows);
  expect(batch.coverage).toHaveLength(20);
  expect(batch.coverage.filter((c) => c.reason === "bounded-out")).toHaveLength(
    8,
  );
  expect(JSON.stringify(batch.request).length).toBeLessThanOrEqual(
    resolutionLimits.characters,
  );
  expect(
    resolutionRequestSchema.safeParse({ ...batch.request, account: "secret" })
      .success,
  ).toBe(false);
  expect(() => buildResolutionBatch([lines[0], lines[0]], source)).toThrow(
    "invalidResolutionSource",
  );
});

test("payload limit leaves whole rows bounded out and includes no raw note evidence", () => {
  const names = [
    "Laktoositon ruokakerma",
    "Vähälaktoosinen ruokakerma",
    "Laktoositon kuohukerma",
    "Vähälaktoosinen kuohukerma",
    "Kerma",
  ];
  const lines = Array.from({ length: 12 }, (_, i) => {
    const requirement = req("Kerma", `large-${i}`);
    const products = names.map((name, j) =>
      product(`${"Brand ".repeat(70)}${name} 200 ml`, {
        id: `sku-${i}-${j}`,
        ingredientId: requirement.id,
      }),
    );
    return matchRequirement(requirement, products);
  });
  const batch = buildResolutionBatch(lines, source, {
    sourceNote: "Private note never serialized",
  });
  expect(batch.request!.rows.length).toBeGreaterThan(0);
  expect(batch.request!.rows.length).toBeLessThan(12);
  expect(
    batch.coverage.filter((row) => row.reason === "bounded-out").length,
  ).toBeGreaterThan(0);
  expect(JSON.stringify(batch.request).length).toBeLessThanOrEqual(
    resolutionLimits.characters,
  );
  expect(JSON.stringify(batch.request)).not.toContain("Private note");
  expect(batch.request!.rows[0].candidates).toHaveLength(5);
  for (const candidate of batch.request!.rows[0].candidates)
    expect(lines[0].candidates.map((product) => product.name)).toContain(
      candidate.name,
    );
});

test("effective Required and Preferred constraints and model provenance retain their distinct meaning", () => {
  const line = cream();
  line.requirement.classification = inferredClassification(
    "Ruokakerma",
    "model-assumed",
  )!;
  const batch = buildResolutionBatch([line], source);
  expect(batch.request!.rows[0].requirement).toMatchObject({
    provenance: "model-assumed",
    required: [],
    qualifiers: [
      { kind: "cream", value: "cooking", provenance: "model-assumed" },
    ],
  });
  const preferred: MatchingOptions = {
    preferences: [
      {
        category: "cream",
        qualifiers: [{ kind: "lactose", value: "free" }],
        strength: "preferred",
      },
    ],
  };
  expect(
    buildResolutionBatch([line], source, preferred).request!.rows[0].requirement
      .preferred,
  ).toEqual([{ kind: "lactose", value: "free" }]);
  expect(() =>
    validateResolutionResult(batch, choice, [line], source, preferred),
  ).toThrow("resolutionStale");
  const required: MatchingOptions = {
    preferences: [
      {
        category: "cream",
        qualifiers: [{ kind: "lactose", value: "free" }],
        strength: "required",
      },
    ],
  };
  expect(buildResolutionBatch([line], source, required).plannedCalls).toBe(0);
});

test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s real adapter and Service feed the same read-only contract",
  async (chain) => {
    const fixture = await createFixtureService(chain, {
      "*": [
        { id: "cooking", name: "Ruokakerma 200 ml", price: 1 },
        { id: "whipping", name: "Kuohukerma 200 ml", price: 2 },
        { id: "plant", name: "Kaura kerma 200 ml", price: 0.1 },
      ],
    });
    const { service, tools } = fixture;
    await service.save({ ...service.state, extras: [req()] });
    await service.buildBasket();
    const priced = service.basket;
    const current = {
      revision: service.state.revision,
      context: service.state.context,
    };
    const batch = buildResolutionBatch(priced, current);
    const before = structuredClone(service.state);
    const reads = tools.length;
    expect(batch.plannedCalls).toBe(1);
    expect(batch.request?.rows[0].candidates.map((p) => p.name)).toEqual([
      "Ruokakerma 200 ml",
      "Kuohukerma 200 ml",
    ]);
    expect(
      validateResolutionResult(batch, choice, priced, current)[0].productId,
    ).toBe("cooking");
    expect(service.state).toEqual(before);
    expect(tools).toHaveLength(reads);
    expect(
      tools.every((name) =>
        ["search_products", "check_basket", "get_delivery_options"].includes(
          name,
        ),
      ),
    ).toBe(true);
  },
);
