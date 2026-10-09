import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("cancelling during catalogue lookup prevents note and recipe generations", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-model-cancel-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await expect(page.getByLabel("Mitä haluaisit valmistaa?")).toBeVisible();
    const evidence = await page.evaluate(async () => {
      const api = window.korikone;
      await api.signInAI();
      const before = (await api.load()).value;
      const results = [];
      for (const method of ["generate", "importRecipe"]) {
        for (const lookup of [1, 2]) {
          await api.developmentScenario("delayedModels");
          const pending = api[method]({
            prompt: "Pasta",
            text: "Pasta",
            consent: true,
          });
          const deadline = Date.now() + 10000;
          while (
            (await api.load()).value.developmentModelCatalogueRequests < lookup
          ) {
            if (Date.now() > deadline)
              throw new Error("Catalogue lookup did not start");
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          await api.cancelAI();
          results.push(await pending);
        }
      }
      return { before, results, after: (await api.load()).value };
    });
    expect(evidence.results).toEqual([
      { ok: false, error: "aiCancelled" },
      { ok: false, error: "aiCancelled" },
      { ok: false, error: "aiCancelled" },
      { ok: false, error: "aiCancelled" },
    ]);
    expect(evidence.after.developmentRequests).toBe(0);
    expect(evidence.after.state).toEqual(evidence.before.state);
    expect(evidence.after.basket).toEqual(evidence.before.basket);
    expect(evidence.after.draft).toBeNull();
    expect(evidence.after.recipeDraft).toBeNull();
  } finally {
    await app.close();
  }
});

test("model selectors save one preference without submitting the note and retain it after restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-models-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    const settingsModel = page.getByLabel("AI-malli", { exact: true });
    await expect(settingsModel).toBeEnabled();
    await expect(settingsModel.locator("option")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Hallitse ChatGPT:n käyttöä" })
      .focus();
    await page.keyboard.press("Tab");
    await expect(settingsModel).toBeFocused();
    await settingsModel.selectOption("fixture-large");
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    const model = page.getByLabel("AI-malli", { exact: true });
    await expect(model).toHaveValue("fixture-large");
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Pasta");
    const before = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    await model.selectOption("auto");
    await expect(model).toHaveValue("auto");
    await expect(
      page.getByRole("button", { name: "Päivitä lista", exact: true }),
    ).toBeEnabled();
    await expect(note).toHaveValue("Pasta");
    const unchanged = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(unchanged.developmentRequests).toBe(0);
    expect(unchanged.basket).toEqual(before.basket);
    expect(unchanged.quotedAt).toBe(before.quotedAt);
    await note.press("Control+Enter");
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              async () => (await window.korikone.load()).value,
            )
          ).developmentModel,
      )
      .toBe("fixture-mini");
    await model.selectOption("fixture-large");
    await expect(model).toBeEnabled();
    await page
      .getByRole("button", { name: "Päivitä lista", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(model).toBeFocused();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 800),
    );
    const box = (await model.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    if (!process.env.KORIKONE_EXECUTABLE)
      await page.screenshot({ path: "test-results/models.png" });
    await app.close();
    app = await electron.launch({
      args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
      env,
      ...(process.env.KORIKONE_EXECUTABLE
        ? { executablePath: process.env.KORIKONE_EXECUTABLE }
        : {}),
    });
    page = await app.firstWindow();
    await expect(page.getByLabel("AI-malli", { exact: true })).toHaveValue(
      "fixture-large",
    );
    const results = await page.evaluate(async () => {
      const api = window.korikone;
      await api.signInAI();
      const initial = (await api.load()).value;
      await api.importRecipe({ text: "Pasta", consent: true });
      const recipeModel = (await api.load()).value.developmentModel;
      const failures: string[] = [];
      for (const scenario of ["removedModel", "emptyModels", "modelsFailed"]) {
        await api.developmentScenario(scenario);
        const result = await api.generate({ prompt: "Pasta", consent: true });
        failures.push(result.error!);
        const after = (await api.load()).value;
        if (
          JSON.stringify(after.basket) !== JSON.stringify(initial.basket) ||
          after.developmentRequests !== 0
        )
          throw new Error("Failed model changed the list or generated content");
      }
      await api.setAIModel("auto");
      await api.developmentScenario("noSmallModel");
      const automatic = await api.generate({ prompt: "Pasta", consent: true });
      return { recipeModel, failures, automatic: automatic.error };
    });
    expect(results.recipeModel).toBe("fixture-large");
    expect(results.failures).toEqual([
      "modelUnavailable",
      "modelsUnavailable",
      "modelsUnavailable",
    ]);
    expect(results.automatic).toBe("modelSelectionRequired");
  } finally {
    await app.close();
  }
});
