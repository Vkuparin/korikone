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
    unsuitable: 0,
    wrongQuantity: 0,
    safePriced: 15,
    unresolved: 17,
    aiRequests: 32,
    searches: 49,
    retailerWrites: 0,
    unsupported: ["weighed-pricing"],
    reasons: {
      suitability: 6,
      "empty-search": 2,
      stock: 2,
      pack: 2,
      price: 3,
      unit: 2,
    },
  });
  expect(evaluationGate(results)).toMatchObject({
    passed: false,
    failures: ["insufficient-cases", "unsupported-required-capability"],
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
      searches: 2,
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
      searches: 2,
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

test("coordinator evaluator preserves unknown quantities and detects omitted ledger requests on both chains", async () => {
  const note = "1 l maitoa ja kahvia";
  const milkIntent = {
    id: "milk-request",
    kind: "grocery",
    label: "1 l maitoa",
    evidence: { start: 0, end: 10, quote: "1 l maitoa" },
    provenance: "explicit-note",
    quantity: { amount: 1000, unit: "ml", provenance: "explicit-note" },
    mealIndex: null,
    itemIndex: 0,
    unresolvedReason: null,
  };
  const coffeeIntent = {
    id: "coffee-request",
    kind: "grocery",
    label: "kahvia",
    evidence: { start: 14, end: 20, quote: "kahvia" },
    provenance: "explicit-note",
    quantity: { amount: null, unit: null, provenance: "unknown" },
    mealIndex: null,
    itemIndex: null,
    unresolvedReason: "unknown-quantity",
  };
  const reply = {
    items: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    intents: [milkIntent, coffeeIntent],
  };
  const fixture = shoppingCaseSchema.parse({
    id: "coordinator-ledger-measurement",
    note,
    expected: [
      {
        id: "milk",
        kind: "grocery",
        names: ["Maito"],
        category: "milk",
        amount: 1000,
        unit: "ml",
        admissible: ["milk"],
      },
      {
        id: "coffee",
        kind: "grocery",
        names: ["Kahvi"],
        intentLabels: ["kahvia"],
        category: "coffee",
        amount: null,
        unit: "g",
      },
    ],
    replies: [JSON.stringify({ items: reply.items })],
    planningReplies: [JSON.stringify(reply)],
    catalogue: { "*": [{ id: "milk", name: "Maito 1 l", price: 1.2 }] },
    requiredCapabilities: ["unknown-quantity", "visible-unsearchable-request"],
  });
  for (const chain of ["k-ruoka", "s-kaupat"] as const) {
    const result = await evaluateShoppingCase(fixture, chain, "coordinator");
    expect(result).toMatchObject({
      missingRequests: [],
      wrongQuantity: [],
      safePriced: 1,
      unresolved: 1,
      unsupported: [],
      aiRequests: 1,
      retailerWrites: 0,
    });
    const omitted = await evaluateShoppingCase(
      {
        ...fixture,
        planningReplies: [JSON.stringify({ ...reply, intents: [milkIntent] })],
      },
      chain,
      "coordinator",
    );
    expect(omitted.missingRequests).toEqual(["coffee"]);
    expect(evaluationGate([omitted], 1).failures).toContain("missing-request");
  }
  await expect(
    evaluateShoppingCase(
      { ...fixture, planningReplies: undefined },
      "k-ruoka",
      "coordinator",
    ),
  ).rejects.toThrow("Missing explicit planning replies");
});

test("coordinator expected failure requires matching outcome and unchanged durable data", async () => {
  const { failureCases } = await import("./fixtures/ai-shopping/failures");
  for (const chain of ["k-ruoka", "s-kaupat"] as const) {
    const invalid = failureCases.find(
      (fixture) => fixture.id === "failure-invalid-eggs",
    )!;
    const retained = await evaluateShoppingCase(invalid, chain, "coordinator");
    expect(retained).toMatchObject({
      missingRequests: [],
      outcomeErrors: [],
      safePriced: 0,
      unresolved: 1,
      reasons: { "invalid-output": 1 },
    });
    const empty = failureCases.find(
      (fixture) => fixture.id === "failure-empty-onion",
    )!;
    const wrongOutcome = await evaluateShoppingCase(
      { ...empty, expectedFailure: "invalid-output" },
      chain,
      "coordinator",
    );
    expect(wrongOutcome.outcomeErrors).toEqual([
      "unexpected-terminal-outcome",
      "failed-run-changed-saved-data",
    ]);
    expect(evaluationGate([wrongOutcome], 1).failures).toContain(
      "unexpected-outcome",
    );
    const wordQuantity = failureCases.find(
      (fixture) => fixture.id === "failure-search-error-eggs",
    )!;
    const wrongFailure = await evaluateShoppingCase(
      wordQuantity,
      chain,
      "coordinator",
    );
    expect(wrongFailure.outcomeErrors).toEqual([]);
    expect(wrongFailure.missingRequests).toEqual([]);
    expect(wrongFailure.reasons).toEqual({ "search-error": 1 });
  }
});
