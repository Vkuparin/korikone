import { expect, test } from "vitest";
import { multiDishCases } from "./fixtures/ai-shopping/multidish";
import { evaluateShoppingCase } from "./fixtures/ai-shopping/runner";

test("clear corpus has twenty distinct FI/EN notes and no required resolver", () => {
  expect(multiDishCases).toHaveLength(20);
  expect(new Set(multiDishCases.map((c) => c.note)).size).toBe(20);
  expect(new Set(multiDishCases.map((c) => c.id)).size).toBe(20);
  expect(
    multiDishCases.every((c) => !c.requiredCapabilities.includes("resolver")),
  ).toBe(true);
});
for (const chain of ["k-ruoka", "s-kaupat"] as const)
  test.each(multiDishCases)(
    `${chain} preserves every clear request: $id`,
    async (fixture) => {
      const result = await evaluateShoppingCase(fixture, chain);
      expect(result).toMatchObject({
        missingRequests: [],
        wrongCategory: [],
        wrongQuantity: [],
        unsuitable: [],
        unresolved: 0,
        aiRequests: 1,
        retailerWrites: 0,
        unsupported: [],
      });
      expect(result.safePriced).toBe(
        fixture.expected.filter((r) => r.kind === "grocery").length,
      );
    },
  );

test("meal plus yoghurt omission fails independent coverage despite a priced meal", async () => {
  const fixture = structuredClone(multiDishCases[14]);
  const reply = JSON.parse(fixture.replies[0]);
  reply.items = [];
  fixture.replies = [JSON.stringify(reply)];
  const result = await evaluateShoppingCase(fixture, "s-kaupat");
  expect(result.missingRequests).toEqual(["requested-yoghurt"]);
  expect(result.safePriced).toBe(2);
});

test("an explicit outside-category expectation still rejects an invented category", async () => {
  const fixture = structuredClone(multiDishCases[8]);
  const reply = JSON.parse(fixture.replies[0]);
  reply.items[1].classification = {
    category: "milk",
    provenance: "model-assumed",
    qualifiers: [],
  };
  fixture.replies = [JSON.stringify(reply)];
  const result = await evaluateShoppingCase(fixture, "k-ruoka");
  expect(result.wrongCategory).toEqual(["requested-yoghurt"]);
});
