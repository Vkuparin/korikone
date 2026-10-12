import { describe, expect, test } from "vitest";
import { editCases } from "./fixtures/ai-shopping/edits";
import {
  editGate,
  editSummary,
  evaluateEditCase,
} from "./fixtures/ai-shopping/edit-runner";
import type { EditEvaluationResult } from "./fixtures/ai-shopping/edit-schema";

const providers = ["chatgpt", "alternative"] as const;

async function evaluateAll() {
  const results: EditEvaluationResult[] = [];
  for (const provider of providers)
    for (const c of editCases)
      results.push(await evaluateEditCase(c, provider));
  return results;
}

describe("F17.7 edit scenarios", () => {
  test("twenty distinct FI/EN scenarios have explicit targets and preserved rows", () => {
    expect(editCases).toHaveLength(20);
    expect(new Set(editCases.map((c) => c.id)).size).toBe(20);
    expect(new Set(editCases.map((c) => c.language))).toEqual(
      new Set(["fi", "en"]),
    );
    expect(new Set(editCases.map((c) => c.kind))).toEqual(
      new Set([
        "add",
        "remove",
        "replace",
        "servings",
        "quantity",
        "at-home",
        "conflict",
        "multi",
        "undo",
      ]),
    );
    for (const c of editCases) expect(c.preserved.length).toBeGreaterThan(0);
  });

  test("every scenario passes on both provider adapters through the real service", async () => {
    const results = await evaluateAll();
    const gate = editGate(editCases, results);
    const failing = results.filter(
      (r) =>
        r.missingEdits.length ||
        r.incorrectEdits.length ||
        r.amountErrors.length ||
        r.mealErrors.length ||
        r.preservedViolations.length ||
        r.outcomeErrors.length ||
        r.undoCorrect === false,
    );
    expect(failing).toEqual([]);
    expect(gate.passed).toBe(true);
    // One interpretation request each and none for the undo step.
    expect(gate.summary).toMatchObject({
      executions: 40,
      aiRequests: 40,
      retailerWrites: 0,
      undoFailures: 0,
    });
    expect(results.filter((r) => r.undoCorrect)).toHaveLength(2);
  });

  test("dropping or clarifying requests is counted as missing, never as an improvement", async () => {
    const applied = editCases.filter((c) => c.outcome === "applied");
    const expectedOperations = applied.reduce(
      (n, c) => n + c.expectedOperations.length,
      0,
    );
    // A model that answers every instruction as unsupported changes nothing.
    const dropped: EditEvaluationResult[] = [];
    for (const c of applied)
      dropped.push(
        await evaluateEditCase(c, "alternative", [
          JSON.stringify({
            version: 1,
            operations: [],
            ambiguities: [],
            unsupported: [{ phrase: c.instruction }],
          }),
        ]),
      );
    const summary = editSummary(dropped);
    expect(summary.missingEdits).toBe(expectedOperations);
    expect(summary.outcomeErrors).toBe(applied.length);
    expect(summary.incorrectEdits).toBe(0);
    expect(summary.retailerWrites).toBe(0);
    expect(summary.undoFailures).toBe(1);
    expect(editGate(editCases, dropped).passed).toBe(false);
  });

  test("an edit that touches an unrelated row is a preserved-row violation", async () => {
    const c = editCases.find((e) => e.id === "edit-remove-rye-fi")!;
    // Removing the toast instead of the rye bread is an incorrect and a missing edit, and the
    // authored preserved row changes.
    const wrong = await evaluateEditCase(c, "chatgpt", [
      JSON.stringify({
        version: 1,
        operations: [{ op: "removeItem", target: "row:paahtoleipä:g" }],
        ambiguities: [],
        unsupported: [],
      }),
    ]);
    expect(wrong.missingEdits).toEqual(["removeItem:row:ruisleipä:g"]);
    expect(wrong.incorrectEdits).toEqual(["removeItem:row:paahtoleipä:g"]);
    expect(wrong.preservedViolations).toEqual(["paahtoleipä:g"]);
    expect(wrong.amountErrors).toEqual(["ruisleipä:g:500!=0"]);
  });
});
