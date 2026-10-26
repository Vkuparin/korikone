import { expect, test, vi } from "vitest";
import { FixtureAI } from "../src/ai/fixtures";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { InferenceSession } from "../src/ai/provider";
import type { PlanningRun } from "../src/application/planning";
import { createFixtureService } from "./fixtures/ai-shopping/environment";

async function providers(alternative: boolean) {
  const cloud = new FixtureAI(),
    local = new FixtureAI();
  await cloud.signIn();
  await local.signIn();
  const chatgpt = new ChatGPTInferenceProvider(cloud);
  const other = new FakeInferenceProvider(local, true);
  const provider = alternative ? other : chatgpt;
  const selected = alternative ? local : cloud;
  const unselected = alternative ? cloud : local;
  const invoked = vi.spyOn(provider, "invoke");
  const bind = async (run: PlanningRun) => {
    const models = await provider.discoverModels(run.signal);
    return run.bindInference(
      provider,
      models.find((model) => model.modelId === "fixture-large")!,
    );
  };
  return { provider, selected, unselected, invoked, bind, chatgpt, other };
}

for (const alternative of [false, true]) {
  const label = alternative ? "alternative" : "ChatGPT fixture";
  for (const chain of ["k-ruoka", "s-kaupat"] as const)
    test(`${label}/${chain}: one repaired pinned session plans an ambiguous row without a resolver request`, async () => {
      const env = await createFixtureService(chain, {
        "*": [
          { id: "cooking", name: "Ruokakerma 200 ml", price: 1 },
          { id: "whipping", name: "Kuohukerma 200 ml", price: 2 },
        ],
      });
      const ai = await providers(alternative);
      ai.selected.setScenario("invalidOnce");
      const before = env.service.snapshot();
      const ready = await env.service.planShopping(
        { prompt: "200 ml kermaa", consent: true },
        ai.bind,
      );
      expect(ready.planning).toMatchObject({
        phase: "ready",
        model: { providerId: ai.provider.id, modelId: "fixture-large" },
        counters: { aiCalls: 2 },
      });
      expect(ready.state).toEqual(before.state);
      expect(ready.basket).toEqual(before.basket);
      const result = env.service.planningResult(ready.planning!.operationId);
      expect(result.resolver.status).toBe("skipped");
      expect(result.intents[0].status).toBe("approval-required");
      expect(ai.invoked.mock.calls.map(([request]) => request.task.id)).toEqual(
        ["shopping-plan", "shopping-plan"],
      );
      expect(
        ai.invoked.mock.calls.every(
          ([request]) =>
            request.model.providerId === ai.provider.id &&
            request.model.modelId === "fixture-large",
        ),
      ).toBe(true);
      expect(ai.selected.catalogueRequests).toBe(1);
      expect(ai.unselected.requestCount).toBe(0);
      expect(ai.unselected.catalogueRequests).toBe(0);
      const committed = await env.service.commitPlanning({
        operationId: ready.planning!.operationId,
      });
      expect(committed.state.note).toBe("200 ml kermaa");
      expect(committed.state.accepted).toEqual(before.state.accepted);
      expect(committed.basket[0].matching?.status).toBe("approval-required");
      expect(committed.basket[0].product).toBeNull();
      expect(
        env.tools.some((tool) => /add|set|create|execute/.test(tool)),
      ).toBe(false);
    });

  for (const [scenario, error, calls] of [
    ["invalidDraft", null, 2],
    ["incompleteDraft", null, 1],
    ["usageLimit", "usageLimit", 1],
  ] as const)
    test(`${label}: ${scenario} never uses the other provider or replaces saved state`, async () => {
      const env = await createFixtureService("k-ruoka", {});
      const ai = await providers(alternative);
      ai.selected.setScenario(scenario);
      const before = env.service.snapshot();
      const pending = env.service.planShopping(
        { prompt: "1 l maitoa", consent: true },
        ai.bind,
      );
      // B4.3: an unusable reply plans the note itself; an account or usage error still fails.
      if (error) await expect(pending).rejects.toThrow(error);
      else
        expect((await pending).planning?.provisional.rows).toMatchObject([
          { name: "Maito", amount: 1000, unit: "ml" },
        ]);
      expect(ai.selected.requestCount).toBe(calls);
      expect(ai.unselected.requestCount).toBe(0);
      expect(ai.unselected.catalogueRequests).toBe(0);
      expect(env.service.snapshot().state).toEqual(before.state);
      expect(env.service.snapshot().basket).toEqual(before.basket);
      expect(
        env.tools.every((tool) =>
          ["search_products", "check_basket"].includes(tool),
        ),
      ).toBe(true);
      if (error) expect(env.tools).toEqual([]);
    });

  for (const obsolete of [false, true])
    test(`${label}: ${obsolete ? "stale" : "cancelled"} pinned operation rejects pending output`, async () => {
      const env = await createFixtureService("k-ruoka", {});
      const ai = await providers(alternative);
      ai.selected.setScenario("pendingSuccess");
      const before = env.service.snapshot();
      const pending = env.service.planShopping(
        { prompt: "1 l maitoa", consent: true },
        ai.bind,
      );
      const rejected = expect(pending).rejects.toThrow(
        obsolete ? "draftStale" : "aiCancelled",
      );
      await vi.waitFor(() => expect(ai.selected.requestCount).toBe(1));
      env.service.planning.control(
        { operationId: env.service.planning.snapshot()!.operationId },
        obsolete,
      );
      await rejected;
      expect(env.service.snapshot().planning?.phase).toBe(
        obsolete ? "obsolete" : "cancelled",
      );
      expect(env.service.snapshot().state).toEqual(before.state);
      expect(env.service.snapshot().basket).toEqual(before.basket);
      expect(ai.unselected.requestCount).toBe(0);
      expect(env.tools).toEqual([]);
    });
}

test("equal model names remain scoped and unsupported planning capability consumes no call", async () => {
  const ai = await providers(true);
  const signal = new AbortController().signal;
  const models = await ai.other.discoverModels(signal);
  const cloudModels = await ai.chatgpt.discoverModels(signal);
  expect(models[0].modelId).toBe(cloudModels[0].modelId);
  expect(
    () =>
      new InferenceSession(
        ai.chatgpt,
        models[0],
        { maxCalls: 3, maxOutputCharacters: 10000, timeoutMs: 1000 },
        signal,
      ),
  ).toThrow("unsupportedProvider");
  const env = await createFixtureService("k-ruoka", {});
  await expect(
    env.service.planShopping(
      { prompt: "1 l maitoa", consent: true },
      async (run) => {
        const model = {
          ...models[0],
          capabilities: {
            ...models[0].capabilities,
            tasks: [{ id: "recipe-import", version: 1 }],
          },
        };
        return run.bindInference(ai.other, model);
      },
    ),
  ).rejects.toThrow("unsupportedTask");
  expect(ai.selected.requestCount).toBe(0);
  expect(ai.unselected.requestCount).toBe(0);
});

for (const alternative of [false, true])
  test(`${alternative ? "alternative" : "ChatGPT fixture"}: a model without the resolver task keeps safe rows with one request`, async () => {
    const env = await createFixtureService("k-ruoka", {
      "*": [
        { id: "milk", name: "Maito 1 l", price: 1.2 },
        { id: "cooking", name: "Ruokakerma 200 ml", price: 1 },
        { id: "whipping", name: "Kuohukerma 200 ml", price: 2 },
      ],
    });
    const ai = await providers(alternative);
    const ready = await env.service.planShopping(
      { prompt: "1 l maitoa ja 200 ml kermaa", consent: true },
      async (run) => {
        const model = (await ai.provider.discoverModels(run.signal))[0];
        model.capabilities.tasks = model.capabilities.tasks.filter(
          (task) => task.id !== "candidate-resolution",
        );
        return run.bindInference(ai.provider, model);
      },
    );
    const result = env.service.planningResult(ready.planning!.operationId);
    expect(result.resolver.status).toBe("skipped");
    expect(ai.selected.requestCount).toBe(1);
    expect(ai.unselected.requestCount).toBe(0);
    expect(ai.unselected.catalogueRequests).toBe(0);
    const committed = await env.service.commitPlanning({
      operationId: ready.planning!.operationId,
    });
    expect(
      committed.basket.find((line) => line.requirement.name === "Maito")
        ?.product?.id,
    ).toBe("milk");
    expect(
      committed.basket.find((line) => line.requirement.name === "Kerma")
        ?.product,
    ).toBeNull();
    expect(env.tools.some((tool) => /add|set|create|execute/.test(tool))).toBe(
      false,
    );
  });
