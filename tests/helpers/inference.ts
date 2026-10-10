import {
  type InferenceEvent,
  type InferenceModel,
  type InferenceProvider,
  type InferenceRequest,
  type InferenceResult,
} from "../../src/ai/provider";

/** Test-only adapter: no transport, authentication or implicit provider fallback. */
export class ScriptedInferenceProvider implements InferenceProvider {
  readonly calls: InferenceRequest[] = [];
  readonly signals: AbortSignal[] = [];
  readonly models: InferenceModel[];
  constructor(
    readonly id: string,
    private readonly reply: (
      request: InferenceRequest,
      signal: AbortSignal,
      onEvent?: (event: InferenceEvent) => void,
    ) => Promise<InferenceResult>,
  ) {
    this.models = [
      {
        providerId: id,
        modelId: "same-model-name",
        name: "Synthetic model",
        capabilities: {
          tasks: [
            { id: "shopping-draft", version: 1 },
            { id: "recipe-import", version: 1 },
          ],
          outputModes: ["text"],
          streaming: false,
        },
      },
    ];
  }
  async discoverModels(signal: AbortSignal) {
    signal.throwIfAborted();
    return structuredClone(this.models);
  }
  async invoke(
    request: InferenceRequest,
    signal: AbortSignal,
    onEvent?: (event: InferenceEvent) => void,
  ) {
    this.calls.push(structuredClone(request));
    this.signals.push(signal);
    return this.reply(request, signal, onEvent);
  }
}
