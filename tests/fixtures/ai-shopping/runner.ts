import { interpretShopping } from "../../../src/ai/output";
import { InferenceError, InferenceSession } from "../../../src/ai/provider";
import { buildCompactContext } from "../../../src/ai/context";
import { inferenceTasks } from "../../../src/ai/tasks";
import { isDeepStrictEqual } from "node:util";
import { PRICE_KEY } from "../../../src/domain/prices";
import { requirements } from "../../../src/domain/planner";
import { unresolvedReason as reason } from "../../../src/application/metrics";
import { ScriptedInferenceProvider } from "../../helpers/inference";
import { createFixtureService, type FixtureChain } from "./environment";
import {
  shoppingCaseSchema,
  type EvaluationResult,
  type ShoppingCase,
  type UnresolvedReason,
} from "./schema";

const normalize = (name: string) => name.trim().toLocaleLowerCase("fi");

/** Real draft validation, approval, persistence and both adapters; no IPC handler replacement. */
export async function evaluateShoppingCase(
  input: ShoppingCase,
  chain: FixtureChain,
  execution: "legacy" | "coordinator" = "legacy",
): Promise<EvaluationResult> {
  const fixture = shoppingCaseSchema.parse(input);
  if (execution === "coordinator" && !fixture.planningReplies)
    throw new Error(`Missing explicit planning replies: ${fixture.id}`);
  let interruptSearch: (() => Promise<void>) | undefined;
  const { service, tools, normalized, storage } = await createFixtureService(
    chain,
    fixture.catalogue,
    fixture.boundaryFailure,
    async () => interruptSearch?.(),
  );
  if (fixture.contextSetup)
    await service.save({ ...service.state, ...fixture.contextSetup });
  let before = service.snapshot();
  const retainedKeys = ["state", "last-quote", PRICE_KEY];
  let storedBefore = await Promise.all(
    retainedKeys.map((key) => storage.get(key)),
  );
  let interrupted = false;
  if (execution === "coordinator" && fixture.lifecycle) {
    interruptSearch = async () => {
      if (interrupted) return;
      interrupted = true;
      const operationId = service.planning.snapshot()!.operationId;
      if (fixture.lifecycle === "change-store-search") {
        await service.save({
          ...service.state,
          context: {
            ...service.state.context,
            storeId: "synthetic-other-store",
          },
        });
        before = service.snapshot();
        storedBefore = await Promise.all(
          retainedKeys.map((key) => storage.get(key)),
        );
      } else
        service.planning.control(
          { operationId },
          fixture.lifecycle === "invalidate-search",
        );
      await Promise.resolve();
    };
  }
  const contextCharacters = JSON.stringify({
    request: fixture.note,
    context: buildCompactContext(fixture.note, service.state),
  }).length;
  let calls = 0;
  const replies =
    execution === "coordinator" ? fixture.planningReplies! : fixture.replies;
  const provider = new ScriptedInferenceProvider(
    "fixture-evaluation",
    async (request) => ({
      text:
        request.task.id === "candidate-resolution"
          ? '{"version":1,"choices":[]}'
          : replies[Math.min(calls++, replies.length - 1)],
      completion: fixture.completion,
    }),
  );
  provider.models[0].capabilities.tasks = inferenceTasks;
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 1000 },
    new AbortController().signal,
  );
  let failure: UnresolvedReason | undefined;
  try {
    if (execution === "coordinator") {
      const planned = await service.planShopping(
        { prompt: fixture.note, consent: true },
        async (run) => run.bindInference(provider, provider.models[0]),
      );
      await service.commitPlanning({
        operationId: planned.planning!.operationId,
      });
    } else {
      service.draft = await service.measureOperation(
        "interpretation",
        async (metrics) => {
          try {
            return await interpretShopping(
              session,
              fixture.note,
              service.state,
            );
          } finally {
            metrics.aiCalls = session.callCount;
            metrics.repairCalls = Math.max(0, session.callCount - 1);
            metrics.payloadCharacters = session.payloadCharacters;
          }
        },
      );
      service.draftRevision = service.state.revision;
      service.draftNote = fixture.note;
      await service.approveDraft();
      await service.buildBasket();
    }
  } catch (error) {
    if (
      !(error instanceof InferenceError && error.code === "incomplete") &&
      !(
        error instanceof Error &&
        [
          "invalidDraft",
          "invalidOutput",
          "invalidIntentLedger",
          "aiCancelled",
          "draftStale",
        ].includes(error.message)
      ) &&
      !fixture.boundaryFailure
    )
      throw error;
    failure =
      execution === "coordinator" &&
      service.snapshot().planning?.phase === "cancelled"
        ? "cancelled"
        : execution === "coordinator" &&
            service.snapshot().planning?.phase === "obsolete"
          ? "obsolete"
          : execution === "coordinator" &&
              service.snapshot().planning?.failure === "invalid-output"
            ? "invalid-output"
            : error instanceof Error && error.message === "incomplete"
              ? "incomplete"
              : fixture.boundaryFailure === "search-error"
                ? "search-error"
                : fixture.boundaryFailure === "malformed"
                  ? "normalization"
                  : "invalid-output";
  }
  const result: EvaluationResult = {
    operationMetrics: await service.operationMetrics(),
    id: fixture.id,
    chain,
    requested: fixture.expected.length,
    missingRequests: [],
    wrongCategory: [],
    wrongQuantity: [],
    outcomeErrors: [],
    unsuitable: [],
    safePriced: 0,
    unresolved: 0,
    reasons: {},
    aiRequests: provider.calls.length,
    searches: tools.filter((t) => t === "search_products").length,
    retailerWrites: tools.filter((t) => /add|set|create|execute/.test(t))
      .length,
    contextCharacters,
    unsupported: fixture.requiredCapabilities.filter(
      (capability) =>
        !(
          execution === "coordinator"
            ? [
                "compact-context",
                "unknown-quantity",
                "visible-unsearchable-request",
                "weighed-pricing",
              ]
            : ["compact-context"]
        ).includes(capability),
    ),
    editCorrectness: "unsupported",
  };
  const count = (value: UnresolvedReason) => {
    result.reasons[value] = (result.reasons[value] ?? 0) + 1;
  };
  if (execution === "coordinator" && fixture.expectedFailure) {
    const after = service.snapshot();
    if (
      failure !== fixture.expectedFailure ||
      after.planning?.phase !==
        (["cancelled", "obsolete"].includes(fixture.expectedFailure)
          ? fixture.expectedFailure
          : "failed")
    )
      result.outcomeErrors.push("unexpected-terminal-outcome");
    const storedAfter = await Promise.all(
      retainedKeys.map((key) => storage.get(key)),
    );
    if (
      !["state", "basket", "quotedAt", "review", "journal"].every((key) =>
        isDeepStrictEqual(
          after[key as keyof typeof after],
          before[key as keyof typeof before],
        ),
      ) ||
      !isDeepStrictEqual(storedAfter, storedBefore)
    )
      result.outcomeErrors.push("failed-run-changed-saved-data");
    if (!result.outcomeErrors.length) {
      if (interrupted) {
        const capability = (
          {
            "cancel-search": "cancellation",
            "invalidate-search": "stale-run",
            "change-store-search": "store-change",
          } as const
        )[fixture.lifecycle!];
        result.unsupported = result.unsupported.filter(
          (value) => value !== capability,
        );
      }
      result.unresolved = fixture.expected.length;
      result.reasons[fixture.expectedFailure] = fixture.expected.length;
      return result;
    }
  }
  for (const expected of fixture.expected) {
    if (expected.kind === "dish") {
      const found = service.state.meals.some((m) =>
        service.state.recipes.some(
          (r) =>
            r.id === m.recipeId &&
            expected.names.map(normalize).includes(normalize(r.name)),
        ),
      );
      if (!found) {
        result.missingRequests.push(expected.id);
        result.unresolved++;
        count("missing-request");
      }
      continue;
    }
    const lines = service.basket.filter((line) =>
      expected.names.map(normalize).includes(normalize(line.requirement.name)),
    );
    const requestedRows = requirements(service.state).filter((r) =>
      expected.names.map(normalize).includes(normalize(r.name)),
    );
    if (!requestedRows.length) {
      const unknown =
        execution === "coordinator" && expected.amount === null
          ? service
              .snapshot()
              .committedIntents.find((result) =>
                expected.intentLabels?.includes(result.intent.label),
              )
          : undefined;
      if (unknown) {
        if (
          unknown.intent.quantity?.amount !== null ||
          unknown.reason !== "unknown-quantity"
        )
          result.wrongQuantity.push(expected.id);
        result.unresolved++;
        continue;
      }
      result.missingRequests.push(expected.id);
      result.unresolved++;
      count(failure ?? "missing-request");
      continue;
    }
    const amount = requestedRows.reduce((sum, r) => sum + r.amount, 0);
    if (
      requestedRows.some(
        (r) => (r.classification?.category ?? null) !== expected.category,
      )
    )
      result.wrongCategory.push(expected.id);
    if (
      amount !== expected.amount ||
      requestedRows.some((r) => r.unit !== expected.unit)
    )
      result.wrongQuantity.push(expected.id);
    if (failure) {
      result.unresolved++;
      count(failure);
      continue;
    }
    for (const line of lines) {
      if (!line.product || line.total === null) {
        result.unresolved++;
        count(reason(line, normalized.get(line.requirement.id) ?? []));
      } else if (
        expected.forbidden.includes(line.product.id) ||
        !expected.admissible.includes(line.product.id)
      )
        result.unsuitable.push(expected.id);
      else result.safePriced++;
    }
  }
  return result;
}

export function evaluationSummary(results: EvaluationResult[]) {
  const reasons: Partial<Record<UnresolvedReason, number>> = {};
  for (const result of results)
    for (const [key, value] of Object.entries(result.reasons))
      reasons[key as UnresolvedReason] =
        (reasons[key as UnresolvedReason] ?? 0) + value;
  const sum = (read: (r: EvaluationResult) => number) =>
    results.reduce((n, r) => n + read(r), 0);
  return {
    executions: results.length,
    requested: sum((r) => r.requested),
    missing: sum((r) => r.missingRequests.length),
    wrongCategory: sum((r) => r.wrongCategory.length),
    unsuitable: sum((r) => r.unsuitable.length),
    wrongQuantity: sum((r) => r.wrongQuantity.length),
    outcomeErrors: sum((r) => r.outcomeErrors.length),
    safePriced: sum((r) => r.safePriced),
    unresolved: sum((r) => r.unresolved),
    aiRequests: sum((r) => r.aiRequests),
    searches: sum((r) => r.searches),
    retailerWrites: sum((r) => r.retailerWrites),
    maxContextCharacters: Math.max(
      0,
      ...results.map((r) => r.contextCharacters),
    ),
    unsupported: [...new Set(results.flatMap((r) => r.unsupported))],
    reasons,
  };
}

export function evaluationGate(results: EvaluationResult[], minimumCases = 60) {
  const metrics = evaluationSummary(results);
  const failures: string[] = [];
  if (new Set(results.map((r) => r.id)).size < minimumCases)
    failures.push("insufficient-cases");
  if (metrics.unsuitable) failures.push("forbidden-selection");
  if (metrics.missing) failures.push("missing-request");
  if (metrics.wrongQuantity) failures.push("wrong-quantity");
  if (metrics.wrongCategory) failures.push("wrong-category");
  if (metrics.outcomeErrors) failures.push("unexpected-outcome");
  if (metrics.retailerWrites) failures.push("retailer-write");
  if (results.some((r) => r.aiRequests > 3)) failures.push("request-cap");
  if (
    [...new Set(results.map((r) => r.id))].some(
      (id) =>
        !["k-ruoka", "s-kaupat"].every((chain) =>
          results.some((r) => r.id === id && r.chain === chain),
        ),
    )
  )
    failures.push("missing-chain");
  if (metrics.unsupported.length)
    failures.push("unsupported-required-capability");
  return { passed: failures.length === 0, failures, metrics };
}
