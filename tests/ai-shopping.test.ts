import { expect, test } from "vitest";
import {
  baselineShoppingCases,
  coverageShoppingCase,
} from "./fixtures/ai-shopping/cases";
import {
  evaluateShoppingCase,
  evaluationGate,
  evaluationSummary,
} from "./fixtures/ai-shopping/runner";
import { shoppingCaseSchema } from "./fixtures/ai-shopping/schema";

test("one evaluator measures the released selection corpus through current validation, adapters and service", async () => {
  const results = [];
  for (const chain of ["k-ruoka", "s-kaupat"] as const)
    for (const fixture of baselineShoppingCases)
      results.push(await evaluateShoppingCase(fixture, chain));
  expect(evaluationSummary(results)).toMatchObject({
    executions: 32,
    requested: 32,
    missing: 0,
    wrongCategory: 0,
    unsuitable: 2,
    wrongQuantity: 0,
    safePriced: 8,
    unresolved: 22,
    aiRequests: 32,
    searches: 54,
    retailerWrites: 0,
    unsupported: ["weighed-pricing"],
    reasons: {
      suitability: 10,
      "empty-search": 2,
      stock: 2,
      pack: 2,
      price: 4,
      unit: 2,
    },
  });
  expect(evaluationGate(results)).toMatchObject({
    passed: false,
    failures: [
      "insufficient-cases",
      "forbidden-selection",
      "unsupported-required-capability",
    ],
  });
  expect(results.every((r) => r.editCorrectness === "unsupported")).toBe(true);
});

test("independent note expectations detect an omitted grocery even when model output is internally valid", async () => {
  const fixture = structuredClone(coverageShoppingCase);
  fixture.replies = [
    '{"items":[{"id":"milk","name":"Maito","amount":1000,"unit":"ml"}]}',
  ];
  const result = await evaluateShoppingCase(fixture, "k-ruoka");
  expect(result.missingRequests).toEqual(["requested-eggs"]);
  expect(result.reasons).toEqual({ "missing-request": 1 });
  expect(result.safePriced).toBe(1);
  expect(evaluationGate([result], 1).failures).toContain("missing-request");
});

test("wrong quantity remains a failure independently of successful SKU pricing", async () => {
  const fixture = structuredClone(coverageShoppingCase);
  fixture.replies = [
    '{"items":[{"id":"milk","name":"Maito","amount":500,"unit":"ml"},{"id":"eggs","name":"Kananmuna","amount":6,"unit":"pcs"}]}',
  ];
  const result = await evaluateShoppingCase(fixture, "s-kaupat");
  expect(result.wrongQuantity).toEqual(["requested-milk"]);
  expect(result.safePriced).toBe(2);
  expect(result.missingRequests).toEqual([]);
  expect(evaluationGate([result], 1).passed).toBe(false);
});

test("category mismatch and a missing dish are visible failures against independently authored expectations", async () => {
  const wrong = structuredClone(coverageShoppingCase);
  wrong.replies = [
    '{"items":[{"id":"milk","name":"Maito","amount":1000,"unit":"ml","classification":{"category":"mince","provenance":"model-assumed","qualifiers":[]}},{"id":"eggs","name":"Kananmuna","amount":6,"unit":"pcs"}]}',
  ];
  const result = await evaluateShoppingCase(wrong, "k-ruoka");
  expect(result.wrongCategory).toEqual(["requested-milk"]);
  expect(evaluationGate([result], 1).failures).toContain("wrong-category");
  const missingDish = shoppingCaseSchema.parse({
    ...coverageShoppingCase,
    note: "Maitoa 1 l, kananmunia 6 ja nakkikeitto",
    expected: [
      ...coverageShoppingCase.expected,
      { id: "requested-soup", kind: "dish", names: ["Nakkikeitto"] },
    ],
    requiredCapabilities: ["visible-unsearchable-request"],
  });
  expect(await evaluateShoppingCase(missingDish, "s-kaupat")).toMatchObject({
    missingRequests: ["requested-soup"],
    unsupported: ["visible-unsearchable-request"],
    searches: 2,
  });
});

test("invalid output repairs once while incomplete output consumes one request and zero searches", async () => {
  const repaired = {
    ...coverageShoppingCase,
    replies: ["invalid", ...coverageShoppingCase.replies],
  };
  expect(await evaluateShoppingCase(repaired, "k-ruoka")).toMatchObject({
    aiRequests: 2,
    searches: 2,
    safePriced: 2,
    missingRequests: [],
  });
  const invalid = { ...coverageShoppingCase, replies: ["invalid"] };
  expect(await evaluateShoppingCase(invalid, "k-ruoka")).toMatchObject({
    aiRequests: 2,
    searches: 0,
    reasons: { "invalid-output": 2 },
  });
  expect(
    await evaluateShoppingCase(
      { ...coverageShoppingCase, completion: "incomplete" },
      "s-kaupat",
    ),
  ).toMatchObject({ aiRequests: 1, searches: 0, reasons: { incomplete: 2 } });
});

test("adapter failures remain separate from empty searches", async () => {
  for (const chain of ["k-ruoka", "s-kaupat"] as const) {
    expect(
      await evaluateShoppingCase(
        { ...coverageShoppingCase, boundaryFailure: "search-error" },
        chain,
      ),
    ).toMatchObject({
      aiRequests: 1,
      searches: 1,
      reasons: { "search-error": 2 },
      retailerWrites: 0,
      missingRequests: [],
    });
    expect(
      await evaluateShoppingCase(
        { ...coverageShoppingCase, boundaryFailure: "malformed" },
        chain,
      ),
    ).toMatchObject({
      aiRequests: 1,
      searches: 1,
      reasons: { normalization: 2 },
      retailerWrites: 0,
    });
  }
});

test("case schema rejects duplicate requests, contradictory SKU expectations and unknown capability claims", () => {
  expect(
    shoppingCaseSchema.safeParse({
      ...coverageShoppingCase,
      expected: [
        coverageShoppingCase.expected[0],
        coverageShoppingCase.expected[0],
      ],
    }).success,
  ).toBe(false);
  expect(
    shoppingCaseSchema.safeParse({
      ...coverageShoppingCase,
      expected: [{ ...coverageShoppingCase.expected[0], forbidden: ["milk"] }],
    }).success,
  ).toBe(false);
  expect(
    shoppingCaseSchema.safeParse({
      ...coverageShoppingCase,
      requiredCapabilities: ["live-ai"],
    }).success,
  ).toBe(false);
});
