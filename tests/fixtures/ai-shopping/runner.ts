import {
  generateValidated,
  draftPrompt,
  validateDraft,
} from "../../../src/ai/draft";
import { InferenceError, InferenceSession } from "../../../src/ai/provider";
import type { BasketLine, Product } from "../../../src/domain/model";
import { relevant, requirements } from "../../../src/domain/planner";
import { ScriptedInferenceProvider } from "../../helpers/inference";
import { createFixtureService, type FixtureChain } from "./environment";
import {
  shoppingCaseSchema,
  type EvaluationResult,
  type ShoppingCase,
  type UnresolvedReason,
} from "./schema";

const normalize = (name: string) => name.trim().toLocaleLowerCase("fi");
function reason(line: BasketLine, products: Product[]): UnresolvedReason {
  if (!products.length) return "empty-search";
  const available = products.filter((p) => p.available);
  if (!available.length) return "stock";
  if (available.every((p) => p.packAmount === 0)) return "pack";
  const compatible = available.filter((p) => p.unit === line.requirement.unit);
  if (!compatible.length) return "unit";
  const packed = compatible.filter((p) => p.packAmount > 0);
  if (!packed.length) return "pack";
  const priced = packed.filter((p) => p.price !== null);
  if (!priced.length) return "price";
  if (!priced.some((p) => relevant(p.name, line.requirement.name)))
    return "suitability";
  return "ranking";
}

/** Real draft validation, approval, persistence and both adapters; no IPC handler replacement. */
export async function evaluateShoppingCase(
  input: ShoppingCase,
  chain: FixtureChain,
): Promise<EvaluationResult> {
  const fixture = shoppingCaseSchema.parse(input);
  const { service, tools, normalized } = await createFixtureService(
    chain,
    fixture.catalogue,
    fixture.boundaryFailure,
  );
  let calls = 0;
  const provider = new ScriptedInferenceProvider(
    "fixture-evaluation",
    async () => ({
      text: fixture.replies[Math.min(calls++, fixture.replies.length - 1)],
      completion: fixture.completion,
    }),
  );
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 1000 },
    new AbortController().signal,
  );
  let failure: UnresolvedReason | undefined;
  try {
    service.draft = await generateValidated(
      async (prompt) =>
        (await session.invoke({ id: "shopping-draft", version: 1 }, prompt))
          .text,
      draftPrompt(fixture.note, service.state),
      (raw) => validateDraft(raw, service.state, fixture.note),
      " Return a valid complete shopping draft only.",
    );
    service.draftRevision = service.state.revision;
    service.draftNote = fixture.note;
    await service.approveDraft();
    await service.buildBasket();
  } catch (error) {
    if (
      !(error instanceof InferenceError && error.code === "incomplete") &&
      !(error instanceof Error && error.message === "invalidDraft") &&
      !fixture.boundaryFailure
    )
      throw error;
    failure =
      error instanceof Error && error.message === "incomplete"
        ? "incomplete"
        : fixture.boundaryFailure === "search-error"
          ? "search-error"
          : fixture.boundaryFailure === "malformed"
            ? "normalization"
            : "invalid-output";
  }
  const result: EvaluationResult = {
    id: fixture.id,
    chain,
    requested: fixture.expected.length,
    missingRequests: [],
    wrongCategory: [],
    wrongQuantity: [],
    unsuitable: [],
    safePriced: 0,
    unresolved: 0,
    reasons: {},
    aiRequests: provider.calls.length,
    searches: tools.filter((t) => t === "search_products").length,
    retailerWrites: tools.filter((t) => /add|set|create|execute/.test(t))
      .length,
    unsupported: fixture.requiredCapabilities,
    editCorrectness: "unsupported",
  };
  const count = (value: UnresolvedReason) => {
    result.reasons[value] = (result.reasons[value] ?? 0) + 1;
  };
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
      result.missingRequests.push(expected.id);
      result.unresolved++;
      count(failure ?? "missing-request");
      continue;
    }
    const amount = requestedRows.reduce((sum, r) => sum + r.amount, 0);
    if (
      requestedRows.some(
        (r) => r.classification?.category !== expected.category,
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
    safePriced: sum((r) => r.safePriced),
    unresolved: sum((r) => r.unresolved),
    aiRequests: sum((r) => r.aiRequests),
    searches: sum((r) => r.searches),
    retailerWrites: sum((r) => r.retailerWrites),
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
