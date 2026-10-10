import { settingsCategory } from "./settings-helper";
import { completeFixtureLogin } from "./store-helpers";
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
    await completeFixtureLogin(app, page);
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect(
      page.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    await page.getByLabel("Kieli", { exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settingsCategory(page, "advanced", "Advanced");
    await expect(
      page.getByLabel("Development mode", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Development mode", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("AI fixture scenario").locator("option"),
    ).toHaveCount(13);
    await page.getByLabel("AI fixture scenario").selectOption("invalidOnce");
    await page
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    await page
      .getByLabel("What would you like to cook?")
      .fill("pasta and soup");
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value.developmentRequests,
      ),
    ).toBe(0);
    await page
      .getByRole("button", { name: "Update list", exact: true })
      .click();
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
    await settingsCategory(page, "advanced", "Lisäasetukset");
    await page.getByLabel("Kehitystila", { exact: true }).click();
    await expect(page.getByTestId("development-banner")).toBeVisible();
    // The development profile starts with setup done, as in the real profile.
    await expect(
      page.getByRole("heading", { name: "Missä teet ruokaostokset?" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Asetukset", exact: true }),
    ).toBeVisible();
    await app.close();
    app = await launch(env);
    page = await app.firstWindow();
    await expect(page.getByTestId("development-banner")).toBeVisible();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "advanced", "Lisäasetukset");
    await page.getByLabel("Kehitystila", { exact: true }).click();
    await expect(page.getByTestId("development-banner")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Asetukset", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("the live acceptance note shows Finnish units, tidy names and the account name", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-acceptance-note-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await launch(env);
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await page.getByRole("textbox").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await completeFixtureLogin(app, page);
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect(
      page.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Makaronilaatikko");
    await note.press("Control+Enter");
    const list = page.getByRole("complementary");
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(
      "Ostoslista · 7",
      { timeout: 15000 },
    );
    for (const product of [
      "Myllyn Paras Makaroni 400g",
      "Kotimaista sika-nauta jauheliha 23 % 400 g",
      "Kotimaista sipuli 500 g",
      "Meira Mustapippuri jauhettu 25g",
      "Kotimaista vapaan kanan munat M10",
    ])
      await expect(list.getByText(product, { exact: true })).toBeVisible();
    await expect(list).toContainText("Makaronilaatikko2 kpl");
    await expect(list).not.toContainText("pcs");
    await expect(page.locator("body")).not.toContainText("MakaronI");
    await list
      .getByRole("button", { name: /^Siirrä ja avaa S-kaupat-lista/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Kauppa", exact: true }),
    ).toHaveAttribute("aria-current", "page", { timeout: 15000 });
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    const panel = list.getByRole("region", { name: "Siirron tulos" });
    await expect(panel).toContainText("Ostoskori päivitetty ja tarkistettu");
    await expect(panel).not.toContainText("demo-household");
  } finally {
    await app.close();
  }
});
