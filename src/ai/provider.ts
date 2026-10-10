import { z } from "zod";

export const inferenceTaskSchema = z.object({
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
});
export type InferenceTask = z.infer<typeof inferenceTaskSchema>;
export const modelIdentitySchema = z.object({
  providerId: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200),
});
export type ModelIdentity = z.infer<typeof modelIdentitySchema>;
export const inferenceModelSchema = modelIdentitySchema.extend({
  name: z.string().min(1).max(200),
  capabilities: z.object({
    tasks: z.array(inferenceTaskSchema).max(100),
    outputModes: z
      .array(z.enum(["text", "json-schema"]))
      .min(1)
      .max(2),
    streaming: z.boolean(),
  }),
});
export type InferenceModel = z.infer<typeof inferenceModelSchema>;
export type InferenceOutput =
  | { mode: "text" }
  | { mode: "json-schema"; name: string; schema: Record<string, unknown> };
export type InferenceRequest = {
  task: InferenceTask;
  model: ModelIdentity;
  prompt: string;
  output: InferenceOutput;
  maxOutputCharacters: number;
};
export const inferenceUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export const inferenceResultSchema = z.object({
  text: z.string(),
  completion: z.enum(["complete", "incomplete"]),
  usage: inferenceUsageSchema.optional(),
});
export type InferenceResult = z.infer<typeof inferenceResultSchema>;
export const inferenceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-delta"), text: z.string() }),
  z.object({ type: z.literal("usage"), usage: inferenceUsageSchema }),
]);
export type InferenceEvent = z.infer<typeof inferenceEventSchema>;

export type InferenceErrorCode =
  | "unsupportedProvider"
  | "unsupportedTask"
  | "unsupportedCapability"
  | "modelUnavailable"
  | "modelsUnavailable"
  | "notConnected"
  | "permissionDenied"
  | "accountChanged"
  | "usageLimit"
  | "rateLimit"
  | "cancelled"
  | "timeout"
  | "busy"
  | "transport"
  | "incomplete"
  | "invalidOutput"
  | "requestLimit";

/** Codes are safe to count; adapter response bodies and credentials are never carried here. */
export class InferenceError extends Error {
  constructor(readonly code: InferenceErrorCode) {
    super(code);
    this.name = "InferenceError";
  }
}

/** Auth, URLs, account state and transport-specific payloads stay behind this interface. */
export interface InferenceProvider {
  readonly id: string;
  discoverModels(signal: AbortSignal): Promise<InferenceModel[]>;
  invoke(
    request: InferenceRequest,
    signal: AbortSignal,
    onEvent?: (event: InferenceEvent) => void,
  ): Promise<InferenceResult>;
}

export async function discoverInferenceModels(
  provider: InferenceProvider,
  signal: AbortSignal,
): Promise<InferenceModel[]> {
  if (signal.aborted) throw new InferenceError("cancelled");
  let rejectAbort: (error: InferenceError) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => rejectAbort(new InferenceError("cancelled"));
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const raw = await Promise.race([provider.discoverModels(signal), aborted]);
    if (signal.aborted) throw new InferenceError("cancelled");
    const parsed = z.array(inferenceModelSchema).max(1000).safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.some((model) => model.providerId !== provider.id)
    )
      throw new InferenceError("invalidOutput");
    if (
      new Set(parsed.data.map((model) => model.modelId)).size !==
      parsed.data.length
    )
      throw new InferenceError("invalidOutput");
    return parsed.data;
  } catch (error) {
    if (signal.aborted) throw new InferenceError("cancelled");
    if (error instanceof InferenceError) throw error;
    throw new InferenceError("modelsUnavailable");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export class InferenceProviders {
  private readonly providers = new Map<string, InferenceProvider>();
  register(provider: InferenceProvider) {
    if (!provider.id || this.providers.has(provider.id))
      throw new InferenceError("unsupportedProvider");
    this.providers.set(provider.id, provider);
  }
  get(id: string): InferenceProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new InferenceError("unsupportedProvider");
    return provider;
  }
}

export type InferenceBounds = {
  maxCalls: number;
  maxOutputCharacters: number;
  timeoutMs: number;
};

/** One selected adapter/model for an operation. Tasks own prompts, schemas and repair policy. */
export class InferenceSession {
  readonly model: Readonly<InferenceModel>;
  private calls = 0;
  private payloadSize = 0;
  get payloadCharacters() {
    return this.payloadSize;
  }
  private inFlight = false;
  private stopped = false;
  private readonly bounds: InferenceBounds;
  get callCount() {
    return this.calls;
  }

  constructor(
    private readonly provider: InferenceProvider,
    model: InferenceModel,
    bounds: InferenceBounds,
    private readonly operationSignal: AbortSignal,
  ) {
    const parsed = inferenceModelSchema.parse(model);
    if (parsed.providerId !== provider.id)
      throw new InferenceError("unsupportedProvider");
    const validated = z
      .object({
        maxCalls: z.number().int().min(1).max(100),
        maxOutputCharacters: z.number().int().min(1).max(1_000_000),
        timeoutMs: z.number().int().min(1).max(600_000),
      })
      .parse(bounds);
    this.bounds = Object.freeze(validated);
    for (const task of parsed.capabilities.tasks) Object.freeze(task);
    Object.freeze(parsed.capabilities.tasks);
    Object.freeze(parsed.capabilities.outputModes);
    Object.freeze(parsed.capabilities);
    this.model = Object.freeze(parsed);
  }

  async invoke(
    task: InferenceTask,
    prompt: string,
    output: InferenceOutput = { mode: "text" },
    onEvent?: (event: InferenceEvent) => void,
  ): Promise<InferenceResult> {
    if (this.operationSignal.aborted || this.stopped)
      throw new InferenceError("cancelled");
    if (this.inFlight) throw new InferenceError("busy");
    const selectedTask = inferenceTaskSchema.parse(task);
    if (
      !this.model.capabilities.tasks.some(
        (supported) =>
          supported.id === selectedTask.id &&
          supported.version === selectedTask.version,
      )
    )
      throw new InferenceError("unsupportedTask");
    if (
      !this.model.capabilities.outputModes.includes(output.mode) ||
      (onEvent && !this.model.capabilities.streaming)
    )
      throw new InferenceError("unsupportedCapability");
    if (this.calls >= this.bounds.maxCalls)
      throw new InferenceError("requestLimit");
    if (typeof prompt !== "string" || !prompt || prompt.length > 1_000_000)
      throw new InferenceError("invalidOutput");

    this.calls++;
    this.payloadSize += prompt.length;
    this.inFlight = true;
    const controller = new AbortController();
    let streamedCharacters = 0;
    let eventCount = 0;
    let terminalError: InferenceError | null = null;
    let rejectAbort: (error: InferenceError) => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const cancel = () => {
      this.stopped = true;
      controller.abort();
      terminalError = new InferenceError("cancelled");
      rejectAbort(terminalError);
    };
    this.operationSignal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      this.stopped = true;
      controller.abort();
      terminalError = new InferenceError("timeout");
      rejectAbort(terminalError);
    }, this.bounds.timeoutMs);
    const events = onEvent
      ? (raw: InferenceEvent) => {
          if (controller.signal.aborted) return;
          eventCount++;
          const parsed = inferenceEventSchema.safeParse(raw);
          if (!parsed.success || eventCount > 10_000) {
            this.stopped = true;
            controller.abort();
            terminalError = new InferenceError("invalidOutput");
            rejectAbort(terminalError);
            return;
          }
          if (parsed.data.type === "text-delta")
            streamedCharacters += parsed.data.text.length;
          if (streamedCharacters > this.bounds.maxOutputCharacters) {
            this.stopped = true;
            controller.abort();
            terminalError = new InferenceError("invalidOutput");
            rejectAbort(terminalError);
            return;
          }
          onEvent(parsed.data);
        }
      : undefined;
    try {
      const request: InferenceRequest = {
        task: structuredClone(selectedTask),
        model: {
          providerId: this.model.providerId,
          modelId: this.model.modelId,
        },
        prompt,
        output: structuredClone(output),
        maxOutputCharacters: this.bounds.maxOutputCharacters,
      };
      const raw = await Promise.race([
        this.provider.invoke(request, controller.signal, events),
        aborted,
      ]);
      if (terminalError) throw terminalError;
      if (this.operationSignal.aborted) throw new InferenceError("cancelled");
      const result = inferenceResultSchema.safeParse(raw);
      if (
        !result.success ||
        result.data.text.length > this.bounds.maxOutputCharacters
      )
        throw new InferenceError("invalidOutput");
      if (result.data.completion !== "complete")
        throw new InferenceError("incomplete");
      return result.data;
    } catch (error) {
      if (error instanceof InferenceError) throw error;
      if (this.operationSignal.aborted) throw new InferenceError("cancelled");
      throw new InferenceError("transport");
    } finally {
      clearTimeout(timer);
      this.operationSignal.removeEventListener("abort", cancel);
      controller.abort();
      this.inFlight = false;
    }
  }
}
