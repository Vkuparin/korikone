import { useEffect, useState } from "react";
import {
  aiOperation,
  operationProgressSchema,
  terminalOperation,
  type OperationProgress,
} from "../application/operation-progress";

export function useOperationProgress() {
  const [operation, setOperation] = useState<OperationProgress | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let active = true;
    const receive = (value: unknown) => {
      const parsed = operationProgressSchema.safeParse(value);
      if (active && parsed.success) {
        setNow(Date.now());
        setOperation((previous) =>
          previous && previous.sequence >= parsed.data.sequence
            ? previous
            : parsed.data,
        );
      }
    };
    const unsubscribe = window.korikone.onOperationProgress(receive);
    void window.korikone
      .getOperationProgress()
      .then((result) => {
        if (result.ok) receive(result.value);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const running = operation !== null && !terminalOperation(operation);
  useEffect(() => {
    if (!running) return;
    const first = setTimeout(() => setNow(Date.now()), 160);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running, operation?.id]);
  const elapsedSeconds = operation
    ? Math.max(0, (now - operation.startedAt) / 1000)
    : 0;
  return {
    operation,
    elapsedSeconds,
    visible:
      running && (aiOperation(operation!.method) || elapsedSeconds >= 0.15),
  };
}
