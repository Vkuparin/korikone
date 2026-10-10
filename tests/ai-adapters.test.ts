import { expect, test, vi } from "vitest";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import {
  InferenceError,
  InferenceSession,
  discoverInferenceModels,
} from "../src/ai/provider";
import { shoppingDraftTask, recipeImportTask } from "../src/ai/tasks";
import { interpretShopping, extractRecipe } from "../src/ai/output";
import { initialState } from "../src/domain/model";
import { chooseModel } from "../src/ai/models";
import { adapterFailure, inferenceAppError } from "../src/ai/adapter-errors";
import { Service } from "../src/application/service";
import { requirements } from "../src/domain/planner";
import { ChatGPT } from "../src/ai/chatgpt";

async function setup(
  alternative: boolean,
  scenario: FixtureAI["scenario"] = "success",
  preference = "auto",
) {
  const fixture = new FixtureAI();
  await fixture.signIn();
  fixture.setScenario(scenario);
  const provider = alternative
    ? new FakeInferenceProvider(fixture, true)
    : new ChatGPTInferenceProvider(fixture);
  const controller = new AbortController();
  const models = await discoverInferenceModels(provider, controller.signal);
  const id = chooseModel(
    models.map((m) => ({ slug: m.modelId, name: m.name })),
    preference,
  );
  const session = new InferenceSession(
    provider,
    models.find((m) => m.modelId === id)!,
    { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 1000 },
    controller.signal,
  );
  return { fixture, provider, controller, session };
}

for (const alternative of [false, true]) {
  const label = alternative
    ? "fake alternative"
    : "ChatGPT adapter with local connection";
  test(`${label}: note validation, approval and persistence preserve the same meal/grocery semantics`, async () => {
    const { fixture, provider, session } = await setup(alternative);
    const state = initialState();
    state.staples = [];
    const note = "Nakkikeitto ja kahvia";
    const draft = await interpretShopping(session, note, state);
    const values = new Map<string, unknown>();
    const service = new Service({
      get: async (key) => values.get(key),
      set: async (key, value) => values.set(key, structuredClone(value)),
    });
    service.developmentMode = true;
    await service.init();
    await service.save({ ...service.state, staples: [] });
    service.draft = draft;
    service.draftNote = note;
    service.draftRevision = service.state.revision;
    await service.approveDraft();
    expect(service.state.meals).toHaveLength(1);
    expect(service.state.recipes.some((r) => r.name === "Nakkikeitto")).toBe(
      true,
    );
    expect(service.state.extras[0].name).toBe("Kahvi");
    expect(requirements(service.state).map((r) => r.name)).toEqual([
      "Peruna",
      "Porkkana",
      "Nakki",
      "Kahvi",
    ]);
    expect(values.get("state")).toEqual(service.state);
    expect(fixture.requestCount).toBe(1);
    expect(fixture.catalogueRequests).toBe(1);
    expect(session.model.providerId).toBe(provider.id);
    expect(fixture.lastModel).toBe("fixture-mini");
  });

  test(`${label}: recipe review and a single repair keep explicit model and one discovery`, async () => {
    const { fixture, session } = await setup(
      alternative,
      "invalidOnce",
      "fixture-large",
    );
    const state = initialState();
    const before = structuredClone(state);
    const recipe = await extractRecipe(session, "Nakkikeitto", state);
    expect(recipe.name).toBe("Nakkikeitto");
    expect(state).toEqual(before);
    expect(fixture.requestCount).toBe(2);
    expect(fixture.catalogueRequests).toBe(1);
    expect(fixture.lastModel).toBe("fixture-large");
    await expect(
      session.invoke(recipeImportTask, "third attempt"),
    ).rejects.toMatchObject({ code: "requestLimit" });
  });

  test(`${label}: usage, incomplete and transport errors consume one call with no repair`, async () => {
    for (const [scenario, code] of [
      ["usageLimit", "usageLimit"],
      ["incompleteDraft", "incomplete"],
      ["aiFailed", "transport"],
    ] as const) {
      const { fixture, session } = await setup(alternative, scenario);
      await expect(
        interpretShopping(session, "note", initialState()),
      ).rejects.toMatchObject({ code });
      expect(fixture.requestCount).toBe(1);
      expect(fixture.catalogueRequests).toBe(1);
    }
  });

  test(`${label}: cancellation aborts the real fixture invocation and cannot accept its late output`, async () => {
    const { fixture, controller, session } = await setup(
      alternative,
      "pendingSuccess",
    );
    const result = interpretShopping(session, "Nakkikeitto", initialState());
    const rejected = expect(result).rejects.toMatchObject({
      code: "cancelled",
    });
    await vi.waitFor(() => expect(fixture.requestCount).toBe(1));
    controller.abort();
    await rejected;
    await expect(
      session.invoke(shoppingDraftTask, "after cancel"),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(fixture.requestCount).toBe(1);
  });
}

test("alternative injection is development-only and provider-scoped model IDs cannot cross adapters", async () => {
  expect(() => new FakeInferenceProvider(new FixtureAI(), false)).toThrow(
    "developmentRequired",
  );
  const { provider, session, controller, fixture } = await setup(true);
  await expect(
    provider.invoke(
      {
        task: shoppingDraftTask,
        model: { providerId: "chatgpt", modelId: session.model.modelId },
        prompt: "note",
        output: { mode: "text" },
        maxOutputCharacters: 1000,
      },
      controller.signal,
    ),
  ).rejects.toMatchObject({ code: "unsupportedProvider" });
  await expect(
    session.invoke({ id: "unknown-task", version: 1 }, "note"),
  ).rejects.toMatchObject({ code: "unsupportedTask" });
  await expect(
    session.invoke(shoppingDraftTask, "note", {
      mode: "json-schema",
      name: "unsupported",
      schema: {},
    }),
  ).rejects.toMatchObject({ code: "unsupportedCapability" });
  expect(fixture.requestCount).toBe(0);
});

test("adapter and public error mapping preserve actionable errors and never turn provider failures into schema repairs", () => {
  for (const [internal, publicCode] of [
    ["cancelled", "aiCancelled"],
    ["incomplete", "incompleteDraft"],
    ["permissionDenied", "permissionMissing"],
    ["accountChanged", "accountChanged"],
    ["modelsUnavailable", "modelsUnavailable"],
    ["modelUnavailable", "modelUnavailable"],
    ["notConnected", "notConnected"],
    ["usageLimit", "usageLimit"],
    ["transport", "aiFailed"],
    ["invalidOutput", "aiFailed"],
  ] as const)
    expect(inferenceAppError(new InferenceError(internal)).message).toBe(
      publicCode,
    );
  expect(adapterFailure(new Error("invalidDraft")).code).toBe("invalidOutput");
  expect(adapterFailure(new Error("private response body")).message).toBe(
    "transport",
  );
});

test("real ChatGPT connection uses one mocked catalogue lookup and the same explicit model for repair", async () => {
  const values = new Map<string, unknown>([
    [
      "chatgpt-credentials",
      JSON.stringify({
        clientId: "synthetic-client",
        subject: "synthetic-subject",
        email: "fixture@korikone.local",
        accessToken: "synthetic-token",
        refreshToken: "",
        idToken: "",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["chatgpt.tokens.use.direct"],
      }),
    ],
  ]);
  const client = new ChatGPT(
    {
      get: async (key) => values.get(key),
      set: async (key, value) => values.set(key, value),
    },
    { encrypt: (text) => text, decrypt: (text) => text },
    async () => {},
  );
  let discoveries = 0;
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "https://api.openai.com/v1/models") {
      discoveries++;
      return Response.json({
        models: [
          {
            slug: "synthetic-mini",
            display_name: "Synthetic mini",
            visibility: "list",
          },
          {
            slug: "synthetic-large",
            display_name: "Synthetic large",
            visibility: "list",
          },
        ],
      });
    }
    if (url !== "https://api.openai.com/v1/responses")
      throw new Error("Unexpected URL");
    bodies.push(JSON.parse(String(init?.body)));
    const text =
      bodies.length === 1
        ? "invalid"
        : '{"items":[{"id":"milk","name":"Maito","amount":1000,"unit":"ml"}]}';
    const wire = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\ndata: ${JSON.stringify({ type: "response.completed" })}\n\n`;
    return new Response(wire, {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  try {
    await client.init();
    const provider = new ChatGPTInferenceProvider(client);
    const controller = new AbortController();
    const models = await discoverInferenceModels(provider, controller.signal);
    const session = new InferenceSession(
      provider,
      models[1],
      { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 1000 },
      controller.signal,
    );
    const result = await interpretShopping(
      session,
      "Maitoa 1 l",
      initialState(),
    );
    expect(result.items[0].name).toBe("Maito");
    expect(discoveries).toBe(1);
    expect(bodies).toHaveLength(2);
    expect(
      bodies.every(
        (body) =>
          body.model === "synthetic-large" &&
          body.store === false &&
          body.stream === true,
      ),
    ).toBe(true);
    expect(client.status().models.map((m) => m.slug)).toEqual([
      "synthetic-mini",
      "synthetic-large",
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
