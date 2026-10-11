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
