import { expect, test } from "vitest";
import {
  OperationTracker,
  operationProgressSchema,
} from "../src/application/operation-progress";

test("newer action owns progress; late and terminal events cannot overwrite it", () => {
  const events: unknown[] = [];
  const tracker = new OperationTracker(
    (p) => events.push(p),
    () => 100,
  );
  const first = tracker.start("planShopping");
  tracker.update(first, { stage: "generating" });
  const next = tracker.start("transferDisplayed");
  tracker.update(first, { stage: "saving" });
  tracker.finish(first, "done");
  expect(tracker.current?.id).toBe(next);
  expect(events).toHaveLength(3);
  tracker.update(next, { stage: "checking", completed: 2, total: 5 });
  expect(tracker.current).toMatchObject({
    startedAt: 100,
    completed: 2,
    total: 5,
  });
  tracker.update(next, { stage: "cancelling", cancellable: false });
  tracker.update(next, { stage: "transferring", completed: 3, total: 5 });
  expect(tracker.current?.stage).toBe("cancelling");
  tracker.finish(next, "cancelled");
  tracker.update(next, { stage: "generating" });
  expect(tracker.current).toMatchObject({
    stage: "cancelled",
    cancellable: false,
  });
  expect(
    events.every((e) => operationProgressSchema.safeParse(e).success),
  ).toBe(true);
});

test("invalid counts and sensitive extra fields are refused", () => {
  const tracker = new OperationTracker(() => {});
  const id = tracker.start("planShopping");
  expect(() =>
    tracker.update(id, { stage: "searching", completed: 3, total: 2 }),
  ).toThrow();
  expect(
    operationProgressSchema.safeParse({ ...tracker.current, note: "private" })
      .success,
  ).toBe(false);
});
