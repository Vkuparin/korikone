import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("development alternative provider uses real note and recipe IPC with pinned model, repair and cancellation", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-ai-provider-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_AI_PROVIDER = "fake-alternative";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const state = initialState();
    state.onboarded = true;
    state.staples = [];
    const evidence = await page.evaluate(async (state) => {
      const api = window.korikone;
      await api.save(state);
      await api.signInAI();
      await api.setAIModel("fixture-large");
      const before = (await api.load()).value.state;
      await api.developmentScenario("invalidOnce");
      const recipe = await api.importRecipe({
        text: "Nakkikeitto",
        consent: true,
      });
      const recipeAfter = (await api.load()).value;
      await api.developmentScenario("success");
      const note = await api.generate({
        prompt: "Nakkikeitto ja kahvia",
        consent: true,
      });
      const draftAfter = (await api.load()).value;
      await api.approveDraft();
      const saved = (await api.load()).value.state;
      await api.developmentScenario("pendingSuccess");
      const pending = api.generate({ prompt: "Pasta", consent: true });
      const deadline = Date.now() + 5000;
      while ((await api.load()).value.developmentRequests !== 1) {
        if (Date.now() > deadline)
          throw new Error("Fixture invocation did not start");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await api.cancelAI();
      return {
        before,
        recipe,
        recipeAfter,
        note,
        draftAfter,
        saved,
        cancelled: await pending,
        after: (await api.load()).value,
      };
    }, state);
    expect(evidence.recipe.ok).toBe(true);
    expect(evidence.recipeAfter.recipeDraft?.name).toBe("Nakkikeitto");
    expect(evidence.recipeAfter.state).toEqual(evidence.before);
    expect(evidence.recipeAfter).toMatchObject({
      developmentAIProvider: "fake-alternative",
      developmentRequests: 2,
      developmentModel: "fixture-large",
      developmentModelCatalogueRequests: 1,
    });
    expect(evidence.note.ok).toBe(true);
    expect(evidence.draftAfter).toMatchObject({
      developmentAIProvider: "fake-alternative",
      developmentRequests: 1,
      developmentModel: "fixture-large",
      developmentModelCatalogueRequests: 1,
    });
    expect(evidence.saved.meals).toHaveLength(1);
    expect(evidence.saved.extras[0].name).toBe("Kahvi");
    expect(evidence.cancelled).toEqual({ ok: false, error: "aiCancelled" });
    expect(evidence.after.state).toEqual(evidence.saved);
    expect(evidence.after.draft).toBeNull();
    expect(evidence.after.developmentRequests).toBe(1);
  } finally {
    await app.close();
  }
});
