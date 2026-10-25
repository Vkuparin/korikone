import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { OperationProgress } from "../src/application/operation-progress";
import {
  OperationProgressBody,
  operationStageLabel,
} from "../src/ui/operation-progress";

const progress = (
  overrides: Partial<OperationProgress> = {},
): OperationProgress => ({
  id: "a8faf7cd-34d8-4c0f-9c84-1b5573137d35",
  sequence: 1,
  method: "generate",
  stage: "generating",
  startedAt: 0,
  updatedAt: 0,
  completed: null,
  total: null,
  cancellable: true,
  ...overrides,
});
const render = (
  value: OperationProgress,
  elapsedSeconds = 0,
  language = "en",
  showElapsed = false,
) =>
  renderToStaticMarkup(
    React.createElement(OperationProgressBody, {
      progress: value,
      language,
      elapsedSeconds,
      showElapsed,
    }),
  );

test("AI progress is indeterminate without fabricated counts or a live region", () => {
  const html = render(progress());
  expect(html).toContain("Waiting for the AI response");
  expect(html).toContain(
    '<progress class="operation-meter" aria-label="Operation progress"></progress>',
  );
  expect(html).not.toMatch(
    /value=|max=|role=|aria-live=|<button|operation-elapsed/,
  );
});

test("search progress renders real completed and total values", () => {
  const value = progress({ stage: "searching", completed: 2, total: 7 });
  const html = render(value, 4, "fi", true);
  expect(html).toContain("Haetaan tuotteita: 2/7");
  expect(html).toContain('value="2" max="7"');
  expect(html).toContain(
    'class="operation-elapsed" aria-hidden="true">4 s kulunut',
  );
  for (const stage of ["checking", "transferring", "verifying"] as const)
    expect(
      operationStageLabel(progress({ stage, completed: 0, total: 7 }), "en"),
    ).toContain("0/7");
});

test("long AI waits keep a truthful waiting and cancellation hint", () => {
  for (const seconds of [15, 45, 90]) {
    const html = render(progress(), seconds);
    expect(html).toContain(
      "Still waiting for the provider to respond. You can cancel the operation.",
    );
    expect(html).not.toMatch(/retry|timeout|%/i);
  }
  expect(render(progress(), 14)).not.toContain("operation-wait");
  expect(render(progress({ stage: "repairing" }), 45, "fi")).toContain(
    "Voit perua toiminnon.",
  );
  expect(render(progress({ cancellable: false }), 45)).not.toContain(
    "You can cancel",
  );
});

test("terminal states have no progress meter or waiting hint", () => {
  for (const stage of ["done", "failed", "cancelled"] as const) {
    const html = render(progress({ stage, completed: 7, total: 7 }), 90);
    expect(html).not.toMatch(/<progress|operation-wait/);
  }
});
