import { FixtureAI } from "./fixtures";
import {
  InferenceError,
  type InferenceModel,
  type InferenceProvider,
  type InferenceRequest,
} from "./provider";
import { interpretationTasks } from "./tasks";
import { adapterFailure } from "./adapter-errors";

/** Development-only alternative: no network, authentication transport or cloud fallback. */
export class FakeInferenceProvider implements InferenceProvider {
  readonly id = "fake-alternative";
  constructor(
    private fixture: FixtureAI,
    development: boolean,
  ) {
    if (!development) throw new Error("developmentRequired");
  }
  async discoverModels(signal: AbortSignal): Promise<InferenceModel[]> {
    try {
      return (await this.fixture.models(signal)).map((m) => ({
        providerId: this.id,
        modelId: m.slug,
        name: m.name,
        capabilities: {
          tasks: interpretationTasks,
          outputModes: ["text"],
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
        text: await this.fixture.generatePinned(
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
