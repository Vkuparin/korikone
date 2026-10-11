import { expect, test } from "vitest";
import { failureCases } from "./fixtures/ai-shopping/failures";
import { multiDishCases } from "./fixtures/ai-shopping/multidish";
import { contextCases } from "./fixtures/ai-shopping/context";
import {
  evaluateShoppingCase,
  evaluationGate,
} from "./fixtures/ai-shopping/runner";

test("failure corpus preserves boundary reasons and unsupported lifecycle claims on both chains", async () => {
  expect(failureCases).toHaveLength(20);
  for (const chain of ["k-ruoka", "s-kaupat"] as const)
    for (const fixture of failureCases) {
      const result = await evaluateShoppingCase(fixture, chain);
      expect(result.retailerWrites).toBe(0);
      expect(result.aiRequests).toBe(
        fixture.id === "failure-invalid-eggs" ? 2 : 1,
      );
      expect(result.unsupported).toEqual(fixture.requiredCapabilities);
      const reason =
        fixture.boundaryFailure === "search-error"
          ? "search-error"
          : fixture.boundaryFailure === "malformed"
            ? "normalization"
            : fixture.completion === "incomplete"
              ? "incomplete"
              : fixture.id === "failure-invalid-eggs"
                ? "invalid-output"
                : fixture.id.includes("empty-")
                  ? "empty-search"
                  : fixture.id.includes("stock-")
                    ? "stock"
                    : fixture.id.includes("unknown-price")
                      ? "price"
                      : fixture.id.includes("unknown-pack")
                        ? "pack"
                        : undefined;
      if (reason) expect(result.reasons).toHaveProperty(reason, 1);
      if (fixture.id === "failure-unknown-milk-amount")
        expect(result.wrongQuantity).toEqual(["requested-grocery"]);
      else expect(result.wrongQuantity).toEqual([]);
    }
});

test("sixty independent cases produce an honest both-chain gate report", async () => {
  const cases = [...multiDishCases, ...contextCases, ...failureCases];
  expect(new Set(cases.map((c) => c.id)).size).toBe(60);
  const results = [];
  for (const chain of ["k-ruoka", "s-kaupat"] as const)
    for (const fixture of cases)
      results.push(await evaluateShoppingCase(fixture, chain));
  const gate = evaluationGate(results);
  console.log("60-case shopping gate", JSON.stringify(gate));
  expect(gate.passed).toBe(false);
  expect(gate.failures).not.toContain("insufficient-cases");
  expect(gate.failures).not.toContain("missing-chain");
  expect(gate.failures).toContain("wrong-quantity");
  expect(gate.failures).toContain("unsupported-required-capability");
  expect(gate.metrics.retailerWrites).toBe(0);
});

test("failure corpus coordinator execution reports real contract gaps without invented unknown quantities", async () => {
  const results = [];
  for (const chain of ["k-ruoka", "s-kaupat"] as const)
    for (const fixture of failureCases)
      results.push(await evaluateShoppingCase(fixture, chain, "coordinator"));
  const gate = evaluationGate(results, 20);
  console.log("Coordinator failure corpus gate", JSON.stringify(gate));
  expect(results).toHaveLength(40);
  expect(gate.metrics.retailerWrites).toBe(0);
  expect(gate.failures).not.toContain("request-cap");
  expect(gate.failures).not.toContain("missing-chain");
  for (const result of results.filter(
    (result) => result.id === "failure-unknown-milk-amount",
  ))
    expect(result).toMatchObject({
      missingRequests: [],
      wrongQuantity: [],
      unresolved: 1,
      unsupported: [],
    });
  expect(gate.failures).toContain("unsupported-required-capability");
  for (const result of results.filter((result) =>
    ["failure-stock-milk", "failure-search-error-eggs"].includes(result.id),
  )) {
    expect(result.missingRequests).toEqual(["requested-grocery"]);
    expect(result.searches).toBe(0);
    expect(result.reasons).toEqual({ "invalid-output": 1 });
  }
});
