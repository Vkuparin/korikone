import { FakeInferenceProvider } from "../../src/ai/fake-provider";
import { FixtureAI } from "../../src/ai/fixtures";
import {
  InferenceSession,
  discoverInferenceModels,
} from "../../src/ai/provider";

/** The development inference path: fixture connection behind the fake alternative provider. */
export async function editInference(replies: string[] = []) {
  const connection = new (class extends FixtureAI {
    prompts = 0;
    override async generatePinned(
      model: string,
      prompt: string,
      signal: AbortSignal,
    ) {
      const reply = replies[this.prompts++];
      return reply ?? super.generatePinned(model, prompt, signal);
    }
  })();
  await connection.signIn();
  const provider = new FakeInferenceProvider(connection, true);
  const controller = new AbortController();
  const models = await discoverInferenceModels(provider, controller.signal);
  const sessions: InferenceSession[] = [];
  return {
    connection,
    controller,
    sessions,
    session: async () => {
      sessions.push(
        new InferenceSession(
          provider,
          models[0],
          { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 180_000 },
          controller.signal,
        ),
      );
      return sessions.at(-1)!;
    },
  };
}
