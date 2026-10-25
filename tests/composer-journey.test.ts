import { expect, test } from "vitest";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import { InferenceSession, discoverInferenceModels } from "../src/ai/provider";
import type { PlanningRun } from "../src/application/planning";
import { createFixtureService } from "./fixtures/ai-shopping/environment";

// B4 (v0.11.2): a multi-dish request, then additions, a removal and a change of mind, all
// through the development fixture interpreter, real validation, matching and persistence.
for (const alternative of [false, true])
  test(`a six-dish list survives additions, removals and a swap (${alternative ? "alternative" : "ChatGPT"} adapter)`, async () => {
    const env = await createFixtureService("s-kaupat", {
      "*": [{ id: "generic", name: "Tuote 500 g", price: 2 }],
    });
    const { service } = env;
    const connection = new FixtureAI();
    await connection.signIn();
    const adapter = alternative
      ? new FakeInferenceProvider(connection, true)
      : new ChatGPTInferenceProvider(connection);
    const models = await discoverInferenceModels(
      adapter,
      new AbortController().signal,
    );
    const model = models.find((m) => m.modelId === "fixture-mini") ?? models[0];
    const note =
      "Makaronilaatikko, nakkikeitto, kanapasta, uunimakkara, poronkäristys, siskonmakkarakeitto ja 2 l maitoa";
    const planned = await service.planShopping(
      { prompt: note, consent: true },
      async (run: PlanningRun) => run.bindInference(adapter, model),
    );
    expect(planned.planning?.phase).toBe("ready");
    const committed = await service.commitPlanning({
      operationId: planned.planning!.operationId,
    });
    const dishes = () =>
      service.state.meals.map(
        (m) => service.state.recipes.find((r) => r.id === m.recipeId)!.name,
      );
    expect(committed.state.meals.length).toBeGreaterThanOrEqual(6);
    expect(committed.basket.length).toBeGreaterThan(6);
    expect(committed.state.extras.map((i) => i.name)).toContain("Maito");
    const session = async () =>
      new InferenceSession(
        adapter,
        model,
        { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 180_000 },
        new AbortController().signal,
      );
    const edit = async (instruction: string, focusTargetId?: string) =>
      service.editList(
        {
          revision: service.state.revision,
          instruction,
          consent: true,
          ...(focusTargetId ? { focusTargetId } : {}),
        },
        session,
      );
    const added = await edit("munakas ja 500 g kahvia");
    expect(added.edit?.status).toBe("applied");
    expect(dishes()).toContain("Munakas");
    const removed = await edit(
      "poista tämä",
      `meal:${service.state.meals.find((m) => /kanapasta/i.test(service.state.recipes.find((r) => r.id === m.recipeId)!.name))!.id}`,
    );
    expect(removed.edit?.status).toBe("applied");
    expect(dishes().some((name) => /kanapasta/i.test(name))).toBe(false);
    const swapped = await edit("vaihda uunimakkara siskonmakkarakeittoon");
    expect(swapped.edit?.status).toBe("applied");
    expect(dishes().some((name) => /uunimakkara/i.test(name))).toBe(false);
    expect(service.basket.length).toBe(
      service.basket.filter((l) => l.matching).length,
    );
    expect(
      env.tools.every((t) => ["search_products", "check_basket"].includes(t)),
    ).toBe(true);
  });
