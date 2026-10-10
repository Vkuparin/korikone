import { InferenceError, type InferenceErrorCode } from "./provider";

export function adapterFailure(error: unknown): InferenceError {
  if (error instanceof InferenceError) return error;
  if (error instanceof Error && error.name === "AbortError")
    return new InferenceError("cancelled");
  if (error instanceof Error && error.name === "TimeoutError")
    return new InferenceError("timeout");
  const codes: Record<string, InferenceErrorCode> = {
    aiCancelled: "cancelled",
    cancelled: "cancelled",
    incompleteDraft: "incomplete",
    permissionMissing: "permissionDenied",
    permissionDenied: "permissionDenied",
    notConnected: "notConnected",
    accountChanged: "accountChanged",
    modelsUnavailable: "modelsUnavailable",
    modelUnavailable: "modelUnavailable",
    usageLimit: "usageLimit",
    busy: "busy",
    invalidDraft: "invalidOutput",
    aiFailed: "transport",
  };
  return new InferenceError(
    error instanceof Error
      ? (codes[error.message] ?? "transport")
      : "transport",
  );
}

/** Existing app errors are public UI codes; malformed transport never becomes draft repair. */
export function inferenceAppError(error: unknown): Error {
  if (!(error instanceof InferenceError))
    return error instanceof Error ? error : new Error("aiFailed");
  const codes: Partial<Record<InferenceErrorCode, string>> = {
    cancelled: "aiCancelled",
    incomplete: "incompleteDraft",
    permissionDenied: "permissionMissing",
    notConnected: "notConnected",
    accountChanged: "accountChanged",
    modelsUnavailable: "modelsUnavailable",
    modelUnavailable: "modelUnavailable",
    usageLimit: "usageLimit",
    busy: "busy",
  };
  return new Error(codes[error.code] ?? "aiFailed");
}
