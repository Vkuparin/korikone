import { expect, test } from "vitest";
import { InferenceError, InferenceSession } from "../src/ai/provider";
import { suggestStarterMeals } from "../src/ai/starter-ideas";
import { starterThemes } from "../src/domain/starter-ideas";
import { starterIdeasTask } from "../src/ai/tasks";
import { initialState } from "../src/domain/model";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { Service } from "../src/application/service";
import { starterFixtureReply } from "../src/ai/starter-fixtures";

function setup(reply: (prompt: string) => Promise<string>, native = false) {
  const provider = new ScriptedInferenceProvider(
    "fake-alternative",
    async (r) => ({ text: await reply(r.prompt), completion: "complete" }),
  );
  provider.models[0].capabilities.tasks.push(starterIdeasTask);
  provider.models[0].capabilities.outputModes = native
    ? ["text", "json-schema"]
    : ["text"];
  const controller = new AbortController();
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 2, maxOutputCharacters: 5000, timeoutMs: 1000 },
    controller.signal,
  );
  return { session, provider, controller };
}
const names = ["Nakkikeitto", "Kanapasta", "Makaronilaatikko"];
for (const theme of starterThemes)
  test.each([false, true])(
    `${theme.id} uses bounded alternative-provider suggestions (native %s)`,
    async (native) => {
      const { session, provider } = setup(
        async () => JSON.stringify({ names }),
        native,
      );
      const state = initialState();
      const result = await suggestStarterMeals(session, theme.id, state, [
        "Uunimakkara",
      ]);
      expect(result).toEqual(names);
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toMatchObject({
        task: starterIdeasTask,
        maxOutputCharacters: 5000,
        output: { mode: native ? "json-schema" : "text" },
      });
      expect(provider.calls[0].prompt).toContain(
        JSON.stringify(state.household),
      );
      expect(provider.calls[0].prompt).toContain('"avoid":["Uunimakkara"]');
    },
  );
test.each([
  "{broken",
  JSON.stringify({ names: ["A", "B", "C"] }),
  JSON.stringify({ names: ["Soup", "Soup", "Soup"] }),
  JSON.stringify({ names: ["https://example.com", "Pasta", "Soup"] }),
])("invalid suggestions use only one repair: %s", async (raw) => {
  const { session, provider } = setup(async () => raw);
  await expect(
    suggestStarterMeals(session, "weekday", initialState(), []),
  ).rejects.toThrow("invalidOutput");
  expect(provider.calls).toHaveLength(2);
});
test("a repeated whole set is repaired without changing provider or model", async () => {
  let calls = 0;
  const { session, provider } = setup(async () =>
    JSON.stringify({
      names: calls++ ? ["Uunimakkara", "Tomaattipasta", "Kasviskeitto"] : names,
    }),
  );
  expect(
    await suggestStarterMeals(session, "weekday", initialState(), names),
  ).not.toEqual(names);
  expect(provider.calls).toHaveLength(2);
  expect(provider.calls[1].model).toEqual(provider.calls[0].model);
});
test("provider failure and cancellation are not retried", async () => {
  const { session, provider } = setup(async () => {
    throw new InferenceError("usageLimit");
  });
  await expect(
    suggestStarterMeals(session, "weekday", initialState(), []),
  ).rejects.toThrow("usageLimit");
  expect(provider.calls).toHaveLength(1);
  const cancelled = setup(async () => JSON.stringify({ names }));
  cancelled.controller.abort();
  await expect(
    suggestStarterMeals(cancelled.session, "weekday", initialState(), []),
  ).rejects.toThrow("cancelled");
  expect(cancelled.provider.calls).toHaveLength(0);
});
test("service rotates suggestions without saving a list or reading a retailer and rejects stale replies", async () => {
  const storage = { get: async () => undefined, set: async () => {} };
  const service = new Service(storage);
  const before = structuredClone(service.state);
  const session = async () =>
    setup(async (prompt) => {
      const data = prompt.slice(prompt.indexOf("\n{") + 1);
      return JSON.stringify(starterFixtureReply(JSON.parse(data)));
    }).session;
  const first = await service.suggestStarterIdeas(
    { theme: "weekday", consent: true },
    session,
  );
  const second = await service.suggestStarterIdeas(
    { theme: "weekday", consent: true },
    session,
  );
  expect(second.starterIdeas!.names).not.toEqual(first.starterIdeas!.names);
  expect(service.state).toEqual(before);
  expect(service.basket).toEqual([]);
  const stale = setup(async () => {
    service.state.revision++;
    return JSON.stringify({ names });
  });
  await expect(
    service.suggestStarterIdeas(
      { theme: "family", consent: true },
      async () => stale.session,
    ),
  ).rejects.toThrow("draftStale");
  expect(service.starterIdeas).toEqual(second.starterIdeas);
});

test("B5.9: a fenced JSON reply is accepted without a repair request", async () => {
  const { session, provider } = setup(
    async () => "```json\n" + JSON.stringify({ names }) + "\n```",
  );
  expect(
    await suggestStarterMeals(session, "weekday", initialState(), []),
  ).toEqual(names);
  expect(provider.calls).toHaveLength(1);
});
