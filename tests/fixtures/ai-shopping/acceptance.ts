import type { EvaluationResult, ShoppingCase } from "./schema";
import { evaluationGate, evaluationSummary } from "./runner";

/** Reports the authored roster and measured operations without changing coverage expectations. */
export function coordinatorAcceptanceReport(
  fixtures: ShoppingCase[],
  results: EvaluationResult[],
) {
  const gate = evaluationGate(results, fixtures.length);
  const rosterErrors: string[] = [];
  const metricErrors: string[] = [];
  const ids = new Set(fixtures.map((fixture) => fixture.id));
  if (ids.size !== fixtures.length) rosterErrors.push("duplicate-fixture");
  for (const fixture of fixtures)
    for (const chain of ["k-ruoka", "s-kaupat"] as const) {
      const executions = results.filter(
        (result) => result.id === fixture.id && result.chain === chain,
      );
      if (executions.length !== 1)
        rosterErrors.push(`${fixture.id}:${chain}:execution-count`);
      if (
        executions.some(
          (result) => result.requested !== fixture.expected.length,
        )
      )
        rosterErrors.push(`${fixture.id}:${chain}:request-count`);
    }
  for (const result of results) {
    if (!ids.has(result.id)) rosterErrors.push(`${result.id}:unexpected-case`);
    const planning = result.operationMetrics.filter(
      (metric) => metric.kind === "planning",
    );
    if (planning.length !== 1)
      metricErrors.push(`${result.id}:${result.chain}:planning-metric-count`);
    if (
      planning.reduce((sum, metric) => sum + metric.aiCalls, 0) !==
      result.aiRequests
    )
      metricErrors.push(`${result.id}:${result.chain}:inference-count`);
    if (
      planning.reduce((sum, metric) => sum + metric.searches, 0) !==
      result.searches
    )
      metricErrors.push(`${result.id}:${result.chain}:search-count`);
  }
  const operations = results.flatMap((result) =>
    result.operationMetrics.filter((metric) => metric.kind === "planning"),
  );
  const sum = (read: (metric: (typeof operations)[number]) => number) =>
    operations.reduce((total, metric) => total + read(metric), 0);
  const failures = [
    ...gate.failures,
    ...(rosterErrors.length ? ["invalid-case-roster"] : []),
    ...(metricErrors.length ? ["inconsistent-operation-metrics"] : []),
  ];
  return {
    gate: { ...gate, passed: failures.length === 0, failures },
    rosterErrors,
    metricErrors,
    chains: Object.fromEntries(
      ["k-ruoka", "s-kaupat"].map((chain) => [
        chain,
        evaluationSummary(results.filter((result) => result.chain === chain)),
      ]),
    ),
    operations: {
      count: operations.length,
      aiCalls: sum((metric) => metric.aiCalls),
      repairCalls: sum((metric) => metric.repairCalls),
      resolverCalls: sum((metric) => metric.resolverCalls),
      searches: sum((metric) => metric.searches),
      payloadCharacters: sum((metric) => metric.payloadCharacters),
      maxAiCalls: Math.max(0, ...operations.map((metric) => metric.aiCalls)),
      maxSearches: Math.max(0, ...operations.map((metric) => metric.searches)),
    },
    failures: results
      .filter(
        (result) =>
          result.missingRequests.length ||
          result.outcomeErrors.length ||
          result.unsuitable.length ||
          result.wrongQuantity.length ||
          result.wrongCategory.length ||
          result.unsupported.length,
      )
      .map((result) => ({
        id: result.id,
        chain: result.chain,
        missingRequests: result.missingRequests,
        outcomeErrors: result.outcomeErrors,
        unsuitable: result.unsuitable,
        wrongQuantity: result.wrongQuantity,
        wrongCategory: result.wrongCategory,
        unsupported: result.unsupported,
      })),
  };
}
