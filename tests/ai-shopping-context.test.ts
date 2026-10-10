import { expect, test } from "vitest";
import { contextCases } from "./fixtures/ai-shopping/context";
import {
  evaluateShoppingCase,
  evaluationGate,
  evaluationSummary,
} from "./fixtures/ai-shopping/runner";

test("twenty boundary cases measure safety independently on both chains", async () => {
  expect(contextCases).toHaveLength(20);
  expect(new Set(contextCases.map((c) => c.id)).size).toBe(20);
  const results = [];
  for (const chain of ["k-ruoka", "s-kaupat"] as const)
    for (const fixture of contextCases) {
      const result = await evaluateShoppingCase(fixture, chain);
      expect(result).toMatchObject({
        missingRequests: [],
        wrongCategory: [],
        wrongQuantity: [],
        aiRequests: 1,
        retailerWrites: 0,
      });
      expect(result.contextCharacters).toBeLessThanOrEqual(24000);
      results.push(result);
    }
  const summary = evaluationSummary(results);
  console.log("F16.3 boundary report", JSON.stringify(summary));
  // Current gaps are release failures, never counted as safe selections.
  expect(evaluationGate(results, 20).passed).toBe(false);
  expect(evaluationGate(results, 20).failures).toContain(
    "unsupported-required-capability",
  );
  expect(summary.unsupported).toEqual(["dietary-evidence"]);
});

test("wrong selection remains a gate failure even with no unresolved rows", async () => {
  const fixture = structuredClone(contextCases[0]);
  // Measurement control: a deliberately forbidden expected SKU, outside the corpus.
  fixture.catalogue = { "*": [{ id: "control", name: "Maito 1 l", price: 1 }] };
  fixture.expected[0].admissible = [];
  fixture.expected[0].forbidden = ["control"];
  const result = await evaluateShoppingCase(fixture, "k-ruoka");
  expect(result.unsuitable).toEqual(["requested-grocery"]);
  expect(result.unresolved).toBe(0);
  expect(result.safePriced).toBe(0);
  expect(evaluationGate([result], 1).failures).toContain("forbidden-selection");
});
