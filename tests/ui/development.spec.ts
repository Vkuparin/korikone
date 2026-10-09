import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function launch(env: Record<string, string>) {
  return electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
}

test("real IPC uses fixtures for setup, AI retry, both stores and transfers", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-development-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await launch(env);
  try {
    await app.evaluate(({ shell }) => {
      const calls: string[] = [];
      Object.assign(globalThis, { fixtureExternalCalls: calls });
      globalThis.fetch = async () => {
        calls.push("fetch");
        throw new Error("Unexpected network request");
      };
      shell.openExternal = async () => {
        calls.push("browser");
        throw new Error("Unexpected external browser");
      };
    });
    const page = await app.firstWindow();
    await expect(page.getByTestId("development-banner")).toBeVisible();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await page.getByRole("textbox").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "K-Ruoka · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await page.getByRole("button", { name: "Jatka", exact: true }).click();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await page.getByRole("button", { name: "Suunnittele viikko" }).click();
    await page.getByLabel("Kieli", { exact: true }).selectOption("en");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByLabel("Development mode", { exact: true }),
    ).toBeChecked();
    await page.getByLabel("AI fixture scenario").selectOption("invalidOnce");
    await page
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    await page
      .getByLabel("What would you like to cook?")
      .fill("pasta and soup");
    await expect(page.locator(".interpretation")).toHaveCount(2, {
      timeout: 15000,
    });
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value.developmentRequests,
      ),
    ).toBe(2);
    const result = await page.evaluate(async () => {
      const api = window.korikone;
      const search = await api.searchStores("Helsinki");
      const state = search.value.state;
      const context = search.value.storeResults.find(
        (s) => s.providerId === "s-kaupat",
      )!;
      const saved = await api.save({ ...state, context });
      if (!saved.ok) throw new Error(saved.error);
      await api.loginStore();
      await api.checkStoreLogin();
      await api.buildBasket();
      const prepared = await api.prepare();
      if (!prepared.ok) throw new Error(prepared.error);
      const transferred = await api.execute({
        id: prepared.value.review!.id,
        acknowledged: true,
      });
      await api.openStoreCart();
      await api.usageAI();
      await api.logoutStore();
      await api.cancelStoreLogin();
      return transferred;
    });
    expect(result.ok).toBe(true);
    expect(result.value.journal!.status).toBe("verified");
    for (const scenario of [
      "usageLimit",
      "invalidDraft",
      "incompleteDraft",
      "aiFailed",
    ]) {
      const failed = await page.evaluate(async (scenario) => {
        await window.korikone.developmentScenario(scenario);
        return window.korikone.generate({
          prompt: "pasta",
          model: "auto",
          consent: true,
        });
      }, scenario);
      expect(failed).toMatchObject({ ok: false, error: scenario });
    }
    expect(
      await page.evaluate(() => window.korikone.setDevelopmentMode(false)),
    ).toMatchObject({ ok: false, error: "developmentRequired" });
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { fixtureExternalCalls: string[] })
            .fixtureExternalCalls,
      ),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});

test("settings enable and persist development mode with separate profiles", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.KORIKONE_TEST_DATA;
  delete env.KORIKONE_DEVELOPMENT;
  env.KORIKONE_DATA_DIR = await mkdtemp(
    join(tmpdir(), "korikone-mode-settings-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await launch(env);
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await page.getByLabel("Kehitystila", { exact: true }).click();
    await expect(page.getByTestId("development-banner")).toBeVisible();
    await app.close();
    app = await launch(env);
    page = await app.firstWindow();
    await expect(page.getByTestId("development-banner")).toBeVisible();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await page.getByLabel("Kehitystila", { exact: true }).click();
    await expect(page.getByTestId("development-banner")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Asetukset", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
