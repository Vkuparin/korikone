import { ChatGPTInferenceProvider } from "../../../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../../../src/ai/fake-provider";
import { FixtureAI } from "../../../src/ai/fixtures";
import {
  InferenceSession,
  discoverInferenceModels,
} from "../../../src/ai/provider";
import { editedPlan } from "../../../src/application/edits";
import { Service, type Storage } from "../../../src/application/service";
import { requirements } from "../../../src/domain/planner";
import { DemoProvider } from "../../../src/stores/demo";
import { editNow, editPlan } from "../../helpers/edit-plan";
import {
  editCaseSchema,
  type EditCase,
  type EditEvaluationResult,
} from "./edit-schema";

/** In-memory documents with the SQLite worker's all-or-nothing `setMany`. */
function memory(): Storage {
  const entries = new Map<string, unknown>();
  return {
    get: async (key) => structuredClone(entries.get(key)),
    set: async (key, value) => {
      entries.set(key, structuredClone(value));
    },
    setMany: async (batch) => {
      for (const entry of structuredClone(batch))
        entries.set(entry.key, entry.value);
    },
  };
}

class CountingAI extends FixtureAI {
  prompts = 0;
  constructor(private scripted: string[] = []) {
    super();
  }
  override async generatePinned(
    model: string,
    prompt: string,
    signal: AbortSignal,
  ) {
    const reply = this.scripted[this.prompts++];
    return reply ?? super.generatePinned(model, prompt, signal);
  }
}

/** Bought amount per requirement key; rows at home or removed are absent. */
const bought = (state: ReturnType<typeof editPlan>) =>
  Object.fromEntries(
    requirements(state, editNow).map((r) => [`${r.id}:${r.unit}`, r.amount]),
  ) as Record<string, number>;

/**
 * Runs one authored scenario through the real task validation, `applyEditIntent`, the service's
 * partial requote and persistence, and (for undo cases) `Service.undoEdit`. `scripted` replaces the
 * fixture interpreter's replies, which is how the metrics are checked against dropped requests.
 */
export async function evaluateEditCase(
  input: EditCase,
  provider: "chatgpt" | "alternative",
  scripted?: string[],
): Promise<EditEvaluationResult> {
  const fixture = editCaseSchema.parse(input);
  const storage = memory();
  const service = new Service(storage);
  service.developmentMode = true;
  await storage.set("state", editPlan());
  await service.init();
  await service.buildBasket();
  const retailer = service.registry.get("demo-k") as DemoProvider;
  const connection = new CountingAI(scripted);
  await connection.signIn();
  const adapter =
    provider === "alternative"
      ? new FakeInferenceProvider(connection, true)
      : new ChatGPTInferenceProvider(connection);
  const controller = new AbortController();
  const models = await discoverInferenceModels(adapter, controller.signal);
  const session = new InferenceSession(
    adapter,
    models.find((m) => m.modelId === "fixture-mini") ?? models[0],
    { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 180_000 },
    controller.signal,
  );
  const before = structuredClone(service.state);
  const beforeAmounts = bought(before);
  const writesBefore = retailer.writes;

  const result: EditEvaluationResult = {
    id: fixture.id,
    provider,
    language: fixture.language,
    requested: fixture.expectedOperations.length,
    missingEdits: [],
    incorrectEdits: [],
    amountErrors: [],
    mealErrors: [],
    preservedViolations: [],
    outcomeErrors: [],
    aiRequests: 0,
    retailerWrites: 0,
    undoCorrect: null,
  };
  let applied: { op: string; targetId: string; after?: number }[] = [];
  let outcome: "applied" | "clarification" | "rejected" = "rejected";
  let candidates: string[][] = [];
  try {
    const snapshot = await service.editList(
      {
        revision: service.state.revision,
        instruction: fixture.instruction,
        consent: true,
        ...(fixture.focusTargetId
          ? { focusTargetId: fixture.focusTargetId }
          : {}),
      },
      async () => session,
    );
    const edit = snapshot.edit;
    if (edit?.status === "applied") {
      outcome = "applied";
      applied = edit.applied.map((a) => ({
        op: a.op,
        targetId: a.targetId,
        after: a.after,
      }));
    } else if (edit?.status === "clarification") {
      outcome = "clarification";
      candidates = edit.ambiguities.map((a) =>
        a.candidates.map((c) => c.targetId),
      );
    }
  } catch (error) {
    result.outcomeErrors.push(
      `rejected:${error instanceof Error ? error.message : "unknown"}`,
    );
  }
  result.aiRequests = connection.prompts;

  // Operations: a missing one is counted whether it was dropped, clarified or rejected.
  for (const expected of fixture.expectedOperations) {
    const found = applied.find(
      (a) => a.op === expected.op && a.targetId === expected.targetId,
    );
    if (!found) result.missingEdits.push(`${expected.op}:${expected.targetId}`);
    else if (expected.after !== undefined && found.after !== expected.after)
      result.incorrectEdits.push(`${expected.op}:${expected.targetId}:value`);
  }
  for (const actual of applied)
    if (
      !fixture.expectedOperations.some(
        (e) => e.op === actual.op && e.targetId === actual.targetId,
      )
    )
      result.incorrectEdits.push(`${actual.op}:${actual.targetId}`);
  const expectedOutcome =
    fixture.outcome === "unchanged"
      ? outcome !== "applied"
      : outcome === fixture.outcome;
  if (!expectedOutcome && !result.outcomeErrors.length)
    result.outcomeErrors.push(`${outcome}!=${fixture.outcome}`);
  if (fixture.outcome === "clarification" && fixture.expectedCandidates) {
    const norm = (groups: string[][]) =>
      groups.map((g) => [...g].sort().join("|")).sort();
    if (
      JSON.stringify(norm(candidates)) !==
      JSON.stringify(norm(fixture.expectedCandidates))
    )
      result.outcomeErrors.push("candidates");
  }

  const after = bought(service.state);
  if (fixture.outcome !== "applied" || outcome !== "applied") {
    // A clarification or rejection must leave the saved list exactly as it was.
    if (JSON.stringify(service.state) !== JSON.stringify(before))
      result.outcomeErrors.push("state-changed");
  }
  for (const [key, expected] of Object.entries(fixture.expectedAmounts))
    if ((after[key] ?? 0) !== expected)
      result.amountErrors.push(`${key}:${after[key] ?? 0}!=${expected}`);
  for (const key of fixture.preserved)
    if ((after[key] ?? 0) !== (beforeAmounts[key] ?? 0))
      result.preservedViolations.push(key);
  for (const [mealId, name] of Object.entries(
    fixture.expectedMealRecipes ?? {},
  )) {
    const meal = service.state.meals.find((m) => m.id === mealId);
    const recipe = service.state.recipes.find((r) => r.id === meal?.recipeId);
    if (recipe?.name !== name) result.mealErrors.push(mealId);
  }

  if (fixture.undo) {
    const requests = connection.prompts;
    const searches = retailer.searchRequests;
    let restored = false;
    try {
      const undone = await service.undoEdit({
        revision: service.state.revision,
      });
      restored = undone.editUndoAvailable === false;
    } catch {
      // Nothing was applied, so there was nothing to undo.
    }
    result.undoCorrect =
      restored &&
      JSON.stringify(editedPlan(service.state)) ===
        JSON.stringify(editedPlan(before)) &&
      JSON.stringify(bought(service.state)) === JSON.stringify(beforeAmounts) &&
      connection.prompts === requests &&
      retailer.searchRequests === searches &&
      retailer.writes === writesBefore;
  }
  result.retailerWrites = retailer.writes - writesBefore;
  return result;
}

/** Aggregates the per-case measurements; the gate needs every list below to be empty. */
export function editSummary(results: EditEvaluationResult[]) {
  const sum = (pick: (r: EditEvaluationResult) => unknown[]) =>
    results.reduce((total, r) => total + pick(r).length, 0);
  return {
    executions: results.length,
    requested: results.reduce((total, r) => total + r.requested, 0),
    missingEdits: sum((r) => r.missingEdits),
    incorrectEdits: sum((r) => r.incorrectEdits),
    amountErrors: sum((r) => r.amountErrors),
    mealErrors: sum((r) => r.mealErrors),
    preservedViolations: sum((r) => r.preservedViolations),
    outcomeErrors: sum((r) => r.outcomeErrors),
    undoFailures: results.filter((r) => r.undoCorrect === false).length,
    aiRequests: results.reduce((total, r) => total + r.aiRequests, 0),
    retailerWrites: results.reduce((total, r) => total + r.retailerWrites, 0),
  };
}

/** Passes only with every authored scenario run on both provider adapters and no error. */
export function editGate(
  cases: EditCase[],
  results: EditEvaluationResult[],
  minimumCases = 20,
) {
  const summary = editSummary(results);
  const ids = new Set(cases.map((c) => c.id));
  const roster = (["chatgpt", "alternative"] as const).every((provider) =>
    [...ids].every(
      (id) =>
        results.filter((r) => r.id === id && r.provider === provider).length ===
        1,
    ),
  );
  return {
    summary,
    passed:
      ids.size >= minimumCases &&
      roster &&
      results.length === ids.size * 2 &&
      summary.missingEdits === 0 &&
      summary.incorrectEdits === 0 &&
      summary.amountErrors === 0 &&
      summary.mealErrors === 0 &&
      summary.preservedViolations === 0 &&
      summary.outcomeErrors === 0 &&
      summary.undoFailures === 0 &&
      summary.retailerWrites === 0,
  };
}
