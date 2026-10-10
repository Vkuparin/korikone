import {
  InferenceError,
  type InferenceModel,
  type InferenceProvider,
  type InferenceRequest,
} from "./provider";
import { interpretationTasks } from "./tasks";
import { chatGPTOutputModes } from "./protocol";
import { adapterFailure } from "./adapter-errors";

/** Connection owns auth/transport. No auth records or task schemas cross this boundary. */
export interface ChatGPTConnection {
  models(signal?: AbortSignal): Promise<{ slug: string; name: string }[]>;
  generatePinned(
    model: string,
    input: string,
    signal: AbortSignal,
  ): Promise<string>;
}
export class ChatGPTInferenceProvider implements InferenceProvider {
  readonly id = "chatgpt";
  constructor(private connection: ChatGPTConnection) {}
  async discoverModels(signal: AbortSignal): Promise<InferenceModel[]> {
    try {
      return (await this.connection.models(signal)).map((m) => ({
        providerId: this.id,
        modelId: m.slug,
        name: m.name,
        capabilities: {
          tasks: interpretationTasks,
          outputModes: [...chatGPTOutputModes],
          streaming: false,
        },
      }));
    } catch (error) {
      throw adapterFailure(error);
    }
  }
  async invoke(request: InferenceRequest, signal: AbortSignal) {
    if (request.model.providerId !== this.id)
      throw new InferenceError("unsupportedProvider");
    if (
      !interpretationTasks.some(
        (t) => t.id === request.task.id && t.version === request.task.version,
      )
    )
      throw new InferenceError("unsupportedTask");
    if (request.output.mode !== "text")
      throw new InferenceError("unsupportedCapability");
    try {
      signal.throwIfAborted();
      return {
        text: await this.connection.generatePinned(
          request.model.modelId,
          request.prompt,
          signal,
        ),
        completion: "complete" as const,
      };
    } catch (error) {
      throw adapterFailure(error);
    }
  }
}
