import { expect, test } from "vitest";
import { multiDishCases } from "./fixtures/ai-shopping/multidish";
import { coordinatorAcceptanceReport } from "./fixtures/ai-shopping/acceptance";
import { evaluateShoppingCase } from "./fixtures/ai-shopping/runner";

test("coordinator acceptance rejects missing, duplicated and miscounted executions", async () => {
  const fixture = multiDishCases.find(
    (value) => value.id === "multidish-2-fi",
  )!;
  const results = await Promise.all(
    (["k-ruoka", "s-kaupat"] as const).map((chain) =>
      evaluateShoppingCase(fixture, chain, "coordinator"),
    ),
  );
  const report = coordinatorAcceptanceReport([fixture], results);
  expect(report.gate.passed).toBe(true);
  expect(report.operations).toMatchObject({
    count: 2,
    aiCalls: 2,
    repairCalls: 0,
    searches: 4,
  });
  expect(report.chains["k-ruoka"].executions).toBe(1);
  expect(report.chains["s-kaupat"].executions).toBe(1);
  expect(
    coordinatorAcceptanceReport([fixture], results.slice(0, 1)).gate.failures,
  ).toContain("invalid-case-roster");
  expect(
    coordinatorAcceptanceReport([fixture], [...results, results[0]]).gate
      .failures,
  ).toContain("invalid-case-roster");
  expect(
    coordinatorAcceptanceReport(
      [fixture],
      [{ ...results[0], aiRequests: 0 }, results[1]],
    ).gate.failures,
  ).toContain("inconsistent-operation-metrics");
  expect(
    coordinatorAcceptanceReport(
      [fixture],
      [{ ...results[0], requested: 1 }, results[1]],
    ).gate.failures,
  ).toContain("invalid-case-roster");
});

test("a fully priced coordinator meal cannot hide an omitted independently requested yoghurt", async () => {
  const original = multiDishCases.find(
    (fixture) => fixture.id === "multidish-8-fi",
  )!;
  const reply = JSON.parse(original.planningReplies![0]);
  reply.items = [];
  reply.intents = reply.intents.filter(
    (intent: { kind: string }) => intent.kind === "meal",
  );
  const omitted = { ...original, planningReplies: [JSON.stringify(reply)] };
  const results = [];
  for (const chain of ["k-ruoka", "s-kaupat"] as const) {
    const result = await evaluateShoppingCase(omitted, chain, "coordinator");
    expect(result.safePriced).toBe(2);
    expect(result.wrongQuantity).toEqual([]);
    expect(result.unsuitable).toEqual([]);
    expect(result.missingRequests).toEqual(["requested-yoghurt"]);
    results.push(result);
  }
  const report = coordinatorAcceptanceReport([original], results);
  expect(report.rosterErrors).toEqual([]);
  expect(report.metricErrors).toEqual([]);
  expect(report.gate.passed).toBe(false);
  expect(report.gate.failures).toContain("missing-request");
});
