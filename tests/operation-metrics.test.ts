import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { diagnostics } from "../src/application/diagnostics";
import {
  METRICS_KEY,
  METRICS_LIMIT,
  readMetrics,
} from "../src/application/metrics";
import { evaluateShoppingCase } from "./fixtures/ai-shopping/runner";
import { coverageShoppingCase } from "./fixtures/ai-shopping/cases";

function memory() {
  const entries = new Map<string, unknown>();
  return {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
}
test("real task repair and pricing record numeric counters on both adapters", async () => {
  for (const chain of ["k-ruoka", "s-kaupat"] as const) {
    const result = await evaluateShoppingCase(
      {
        ...coverageShoppingCase,
        replies: ["invalid", ...coverageShoppingCase.replies],
      },
      chain,
    );
    expect(result.operationMetrics).toHaveLength(2);
    expect(result.operationMetrics[0]).toMatchObject({
      kind: "interpretation",
      outcome: "success",
      aiCalls: 2,
      repairCalls: 1,
      resolverCalls: 0,
    });
    expect(result.operationMetrics[0].payloadCharacters).toBeGreaterThan(0);
    expect(result.operationMetrics[1]).toMatchObject({
      kind: "pricing",
      outcome: "success",
      searches: 2,
      unresolved: {},
    });
  }
});
test("failure and cancellation retain numeric metrics and never error text", async () => {
  const service = new Service(memory());
  for (const [code, outcome] of [
    ["aiCancelled", "cancelled"],
    ["draftStale", "obsolete"],
    ["PRIVATE ERROR", "failed"],
  ] as const) {
    await expect(
      service.measureOperation("planning", async (counters) => {
        counters.resolverCalls = 1;
        throw new Error(code);
      }),
    ).rejects.toThrow(code);
    expect((await service.operationMetrics()).at(-1)).toMatchObject({
      outcome,
      resolverCalls: 1,
    });
  }
  const result = await evaluateShoppingCase(
    { ...coverageShoppingCase, completion: "incomplete" },
    "k-ruoka",
  );
  expect(result.operationMetrics[0]).toMatchObject({
    outcome: "failed",
    aiCalls: 1,
    repairCalls: 0,
    unresolved: { incomplete: 1 },
  });
  const search = await evaluateShoppingCase(
    { ...coverageShoppingCase, boundaryFailure: "search-error" },
    "s-kaupat",
  );
  expect(search.operationMetrics.at(-1)).toMatchObject({
    outcome: "failed",
    searches: 1,
    unresolved: { "search-error": 1 },
  });
});

test("expanded candidate searches count actual external reads rather than requirements", async () => {
  const result = await evaluateShoppingCase(
    { ...coverageShoppingCase, catalogue: { "*": [] } },
    "k-ruoka",
  );
  const pricing = result.operationMetrics.find(
    (metric) => metric.kind === "pricing",
  )!;
  expect(pricing.searches).toBe(result.searches);
  expect(pricing.searches).toBeGreaterThan(
    coverageShoppingCase.expected.length,
  );
  expect(pricing.unresolved).toEqual(result.reasons);
});
test("metrics survive service restart, enforce bounds and redact hostile records", async () => {
  const db = memory();
  const service = new Service(db);
  for (let i = 0; i < METRICS_LIMIT + 3; i++)
    await service.measureOperation("pricing", async (counters) => {
      counters.searches = i;
    });
  const restarted = new Service(db);
  expect(await restarted.operationMetrics()).toHaveLength(METRICS_LIMIT);
  expect((await restarted.operationMetrics())[0].searches).toBe(3);
  const valid = (await restarted.operationMetrics())[0];
  await service.recordOperation({ ...valid, prompt: "PRIVATE PROMPT" });
  await service.recordOperation({ ...valid, searches: -1 });
  await service.recordOperation({ ...valid, latencyMs: Infinity });
  expect(await service.operationMetrics()).toHaveLength(METRICS_LIMIT);
  await db.set(METRICS_KEY, [
    valid,
    { ...valid, account: "PRIVATE ACCOUNT" },
    { ...valid, unresolved: { "PRIVATE PRODUCT": 1 } },
  ]);
  const report = diagnostics(
    service.snapshot(),
    {},
    [],
    await service.operationMetrics(),
  );
  expect(report.operationMetrics).toEqual([valid]);
  expect(JSON.stringify(report)).not.toContain("PRIVATE");
  expect(readMetrics([{ ...valid, productName: "PRIVATE" }])).toEqual([]);
  expect(service.snapshot()).not.toHaveProperty("operationMetrics");
  expect(await service.exportBackup()).not.toHaveProperty("operationMetrics");
});
test("metric storage failure cannot change operation success or its original error", async () => {
  const service = new Service({
    get: async () => {
      throw new Error("storageFailed");
    },
    set: async () => {
      throw new Error("storageFailed");
    },
  });
  expect(await service.measureOperation("planning", async () => 42)).toBe(42);
  await expect(
    service.measureOperation("planning", async () => {
      throw new Error("original");
    }),
  ).rejects.toThrow("original");
});
