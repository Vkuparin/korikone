import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";
import { initialState } from "../../src/domain/model";

for (const language of ["fi", "en"] as const) {
  test(`contextual Settings entries retain errors and reversible saves in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-settings-entry-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 800, height: 600 });
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.meals = [];
      state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
      state.context = {
        ...state.context,
        providerId: "k-ruoka",
        storeName: "K-Ruoka fixture",
      };
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.setLanguage(language);
        },
        { state, language },
      );
      await page.reload();
      const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
      const nav = (name: string) =>
        page
          .getByRole("navigation")
          .first()
          .getByRole("button", { name, exact: true });
      const note = page.getByLabel(
        tr("Mitä haluaisit valmistaa?", "What would you like to cook?"),
      );
      await note.fill("Retained contextual note");
      const heading = (section: string) =>
        page.locator(`#settings-section-${section}`);
      await page
        .getByRole("button", {
          name: `4 ${tr("henkeä", "people")}`,
          exact: true,
        })
        .click();
      await expect(heading("household")).toBeFocused();
      const budget = page.getByLabel(
        tr("Viikkobudjetti (€)", "Weekly budget (€)"),
      );
      await budget.fill("123.45");
      await nav(tr("Ostoslista", "Shopping list")).click();
      await page.locator(".store-chip").click();
      await expect(heading("stores")).toBeFocused();
      await nav(tr("Ostoslista", "Shopping list")).click();
      await expect(note).toHaveValue("Retained contextual note");
      await page
        .getByRole("button", {
          name: tr("Avaa ChatGPT ja tekoäly", "Open ChatGPT and AI"),
          exact: true,
        })
        .click();
      await expect(heading("ai")).toBeFocused();
      await page
        .getByRole("button", { name: "Continue with ChatGPT", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.korikone.load())).value.ai.state,
        )
        .toBe("connected");
      await nav(tr("Ostoslista", "Shopping list")).click();
      await note.fill("Makaronilaatikko");
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedFailure"),
      );
      await note.press("Control+Enter");
      const error = page.locator("#root > .error");
      await expect(error).toContainText(
        tr(
          "ChatGPT-pyyntö epäonnistui",
          "ChatGPT could not complete the request",
        ),
      );
      const originalError = await error.innerText();
      await error
        .getByRole("button", {
          name: tr("Avaa ChatGPT ja tekoäly", "Open ChatGPT and AI"),
          exact: true,
        })
        .click();
      await expect(heading("ai")).toBeFocused();
      await expect(page.locator(".progress")).toHaveCount(0);
      await expect(error).toHaveText(originalError);
      await nav(tr("Ostoslista", "Shopping list")).click();
      await page
        .getByRole("button", {
          name: `4 ${tr("henkeä", "people")}`,
          exact: true,
        })
        .click();
      await expect(heading("household")).toBeFocused();
      await expect(budget).toHaveValue("123.45");
      expect(
        await budget
          .locator("xpath=ancestor::label")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(14);
      expect(
        await budget.evaluate((el) =>
          parseFloat(getComputedStyle(el).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
      const save = budget
        .locator("xpath=ancestor::form")
        .getByRole("button", { name: tr("Tallenna", "Save"), exact: true });
      await budget.fill("-1");
      await save.click();
      await expect(error).toBeVisible();
      await expect(budget).toHaveValue("-1");
      await error
        .getByRole("button", {
          name: tr("Avaa Kotitalous", "Open Household"),
          exact: true,
        })
        .click();
      await expect(heading("household")).toBeFocused();
      await budget.fill("123.45");
      await save.click();
      await expect(error).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.korikone.load())).value.state
              .household.budget,
        )
        .toBe(12345);
      await expect(save).toBeEnabled();
      await expect(
        save.locator("xpath=ancestor::form").getByRole("status"),
      ).toHaveCount(0);
      await budget.fill(String(state.household.budget / 100));
      await save.click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.korikone.load())).value.state
              .household.budget,
        )
        .toBe(state.household.budget);
      await expect(save).toBeEnabled();
      await page.getByTestId("development-banner").getByRole("button").click();
      await expect(heading("advanced")).toBeFocused();
      await expect(
        page.getByLabel(tr("Kehitystila", "Development mode"), { exact: true }),
      ).toBeDisabled();
      await nav(tr("Kauppa", "Store")).click();
      await page
        .getByRole("button", {
          name: tr("Kauppojen asetukset", "Store settings"),
          exact: true,
        })
        .click();
      await expect(heading("stores")).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator(".settings-page").screenshot({
        path: `test-results/settings-entry-${language}-800.png`,
      });
      const result = (await page.evaluate(() => window.korikone.load())).value;
      expect(result.state.extras).toEqual(state.extras);
      expect(result.state.meals).toEqual([]);
      expect(result.state.household).toEqual(state.household);
      expect(result.developmentRequests).toBe(1);
    } finally {
      await app.close();
    }
  });
}

for (const language of ["fi", "en"] as const) {
  test(`Settings categories retain drafts, focus and real saves in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_HIDDEN = "1";
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-settings-sections-"),
    );
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      await page.getByLabel("Mitä haluaisit valmistaa?").fill("Retain my note");
      if (language === "en") {
        await page.getByLabel("Kieli", { exact: true }).click();
        await page
          .getByRole("option", { name: "English", exact: true })
          .click();
      }
      const fi = language === "fi";
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const baseline = await load();
      await page
        .getByRole("button", {
          name: fi ? "Asetukset" : "Settings",
          exact: true,
        })
        .click();
      const settings = page.locator(".settings-page");
      const category = async (value: string, label: string) => {
        if (await settings.locator(".settings-category").isVisible())
          await settings
            .locator(".settings-category select")
            .selectOption(value);
        else
          await settings
            .getByRole("navigation")
            .getByRole("button", { name: label, exact: true })
            .click();
        await expect(
          settings.locator(`#settings-section-${value}`),
        ).toBeFocused();
      };
      await expect(settings.locator("#settings-section-general")).toBeFocused();
      await category("household", fi ? "Kotitalous" : "Household");
      const servings = settings.locator('input[name="servings"]');
      const budget = settings.locator('input[name="budget"]');
      await servings.fill("7");
      await budget.fill("bad budget");
      await expect(
        settings.getByText(
          fi
            ? "Kotitalouden muutoksia ei ole tallennettu."
            : "Household changes have not been saved.",
          { exact: true },
        ),
      ).toBeVisible();
      await category("about", fi ? "Tietoja" : "About");
      await expect(settings.getByTestId("app-version")).not.toHaveText(
        /Unavailable|Ei saatavilla/,
      );
      await app.evaluate(({ shell }) => {
        shell.openPath = async () => "fixture opener failed";
      });
      await settings
        .getByRole("button", {
          name: fi
            ? "Avaa kolmansien osapuolten lisenssit"
            : "Open third-party notices",
        })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        fi ? "lisenssejä ei voitu avata" : "notices could not be opened",
      );
      await app.evaluate(({ shell }) => {
        shell.openPath = async () => "";
      });
      await settings
        .getByRole("button", {
          name: fi
            ? "Avaa kolmansien osapuolten lisenssit"
            : "Open third-party notices",
        })
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await category("household", fi ? "Kotitalous" : "Household");
      await expect(servings).toHaveValue("7");
      await settings
        .getByRole("button", { name: fi ? "Tallenna" : "Save", exact: true })
        .click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(budget).toHaveValue("bad budget");
      await settings
        .getByRole("button", {
          name: fi ? "Muokkaa vakiotuotteita" : "Edit regular items",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: fi ? "← Asetukset" : "← Settings",
          exact: true,
        })
        .click();
      await expect(servings).toHaveValue("7");
      await expect(budget).toHaveValue("bad budget");
      const unchanged = await load();
      expect(unchanged.developmentRequests).toBe(baseline.developmentRequests);
      expect(unchanged.developmentCatalogueRequests).toBe(
        baseline.developmentCatalogueRequests,
      );
      await budget.fill("95,50");
      await settings
        .getByRole("button", { name: fi ? "Tallenna" : "Save", exact: true })
        .click();
      await expect
        .poll(async () => (await load()).state.household.budget)
        .toBe(9550);
      expect((await load()).state.household.servings).toBe(7);
      await expect(
        settings.getByText(
          fi
            ? "Kotitalouden muutoksia ei ole tallennettu."
            : "Household changes have not been saved.",
          { exact: true },
        ),
      ).toHaveCount(0);
      await page
        .getByRole("button", {
          name: fi ? "Ostoslista" : "Shopping list",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel(
          fi ? "Mitä haluaisit valmistaa?" : "What would you like to cook?",
        ),
      ).toHaveValue("Retain my note");
      await page
        .getByRole("button", {
          name: fi ? "Asetukset" : "Settings",
          exact: true,
        })
        .click();
      await expect(servings).toHaveValue("7");
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(800, 600),
      );
      await category("general", fi ? "Yleiset" : "General");
      const languageMenu = settings.getByRole("button", {
        name: fi ? "Kieli" : "Language",
        exact: true,
      });
      await languageMenu.click();
      await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(
        2,
      );
      await page
        .getByRole("option", { name: fi ? "English" : "Suomi", exact: true })
        .click();
      await category("household", fi ? "Household" : "Kotitalous");
      await expect(budget).toHaveValue("95,50");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/settings-categories-${language}-800.png`,
        fullPage: true,
      });
      expect((await load()).developmentRequests).toBe(
        baseline.developmentRequests,
      );
    } finally {
      await app.close();
    }
  });
}

test("Advanced retains locked development tools and the real diagnostic preview/export", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "korikone-settings-diagnostics-"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = directory;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "advanced", "Lisäasetukset");
    await expect(
      page.getByLabel("Kehitystila", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Muokkaa vakiotuotteita", exact: true }),
    ).toHaveCount(0);
    const path = join(directory, "diagnostics.json");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showMessageBox = async (...args: unknown[]) => {
        const options = args.at(-1) as { detail?: string };
        Object.assign(globalThis, { diagnosticPreview: options.detail });
        return { response: 0, checkboxChecked: false };
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, path);
    await page
      .getByRole("button", {
        name: "Tallenna vianetsintätiedot (ei henkilötietoja)",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        try {
          return await readFile(path, "utf8");
        } catch {
          return "";
        }
      })
      .not.toBe("");
    expect(await readFile(path, "utf8")).toBe(
      await app.evaluate(
        () =>
          (globalThis as unknown as { diagnosticPreview: string })
            .diagnosticPreview,
      ),
    );
    const snapshot = (await page.evaluate(async () => window.korikone.load()))
      .value;
    expect(snapshot.developmentRequests).toBe(0);
    await settingsCategory(page, "ai", "ChatGPT ja tekoäly");
    await expect(page.getByLabel("Kehitystila", { exact: true })).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Muokkaa vakiotuotteita", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

for (const language of ["fi", "en"] as const) {
  test(`appearance keyboard selection, backup restore and restart preserve the list in ${language}`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "korikone-settings-appearance-"),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = directory;
    env.KORIKONE_TEST_HIDDEN = "1";
    const options = { args: ["."], env };
    let app = await electron.launch(options);
    try {
      let page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      await page
        .getByLabel("Mitä haluaisit valmistaa?")
        .fill("Keep this unapplied note");
      if (language === "en") {
        await page.getByLabel("Kieli", { exact: true }).click();
        await page
          .getByRole("option", { name: "English", exact: true })
          .click();
      }
      const fi = language === "fi";
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const baseline = await load();
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = "dark";
      });
      await page
        .getByRole("button", {
          name: fi ? "Asetukset" : "Settings",
          exact: true,
        })
        .click();
      const general = () =>
        settingsCategory(page, "general", fi ? "Yleiset" : "General");
      const data = () => settingsCategory(page, "data", fi ? "Tiedot" : "Data");
      const household = () =>
        settingsCategory(page, "household", fi ? "Kotitalous" : "Household");
      const appearance = page.getByLabel(fi ? "Ulkoasu" : "Appearance", {
        exact: true,
      });
      await expect(page.getByTestId("system-appearance")).toContainText(
        fi ? "Tumma" : "Dark",
      );
      await appearance.focus();
      await appearance.press("ArrowDown");
      await expect(appearance).toHaveValue("light");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await appearance.press("ArrowDown");
      await expect(appearance).toHaveValue("dark");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await household();
      const servings = page.locator('.settings-content input[name="servings"]');
      await servings.fill("9");
      await data();
      const receipts = page.getByLabel(
        fi ? "Kuittien ostosrivit" : "Receipt purchase lines",
      );
      await receipts.fill("Unsaved receipt draft");
      const backupPath = join(directory, "backup.json");
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [filePath],
        });
      }, backupPath);
      await page
        .getByText(fi ? "Varmuuskopiot ja tiedot" : "Backups and data", {
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: fi ? "Vie varmuuskopio" : "Export backup",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => {
          try {
            return JSON.parse(await readFile(backupPath, "utf8")).appearance;
          } catch {
            return null;
          }
        })
        .toBe("dark");
      const backup = JSON.parse(await readFile(backupPath, "utf8"));
      await general();
      await appearance.selectOption("light");
      await expect(appearance).toHaveValue("light");
      const changed = await load();
      expect(changed.state.meals).toEqual(baseline.state.meals);
      expect(changed.state.revision).toBe(baseline.state.revision);
      expect(changed.basket).toEqual(baseline.basket);
      expect(changed.developmentRequests).toBe(baseline.developmentRequests);
      expect(changed.developmentCatalogueRequests).toBe(
        baseline.developmentCatalogueRequests,
      );
      await data();
      const restore = page.getByRole("button", {
        name: fi ? "Palauta varmuuskopio" : "Restore backup",
        exact: true,
      });
      await writeFile(
        backupPath,
        JSON.stringify({ ...backup, appearance: "sepia" }),
      );
      await restore.click();
      await expect(page.getByRole("alert")).toBeVisible();
      expect((await load()).state.appearance).toBe("light");
      backup.household.servings = 3;
      backup.household.budget = 12345;
      backup.receiptText = "Restored receipt lines";
      await writeFile(backupPath, JSON.stringify(backup));
      await restore.click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(receipts).toHaveValue("Unsaved receipt draft");
      await general();
      await expect(appearance).toHaveValue("dark");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await household();
      await expect(servings).toHaveValue("9");
      await expect(
        page.locator('.settings-content input[name="budget"]'),
      ).toHaveValue("123.45");
      await page
        .getByRole("button", {
          name: fi ? "Ostoslista" : "Shopping list",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel(
          fi ? "Mitä haluaisit valmistaa?" : "What would you like to cook?",
        ),
      ).toHaveValue("Keep this unapplied note");
      expect((await load()).developmentRequests).toBe(
        baseline.developmentRequests,
      );
      await app.close();
      app = await electron.launch(options);
      page = await app.firstWindow();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page
        .getByRole("button", {
          name: fi ? "Asetukset" : "Settings",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel(fi ? "Ulkoasu" : "Appearance", { exact: true }),
      ).toHaveValue("dark");
      expect((await load()).state.meals).toEqual(baseline.state.meals);
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = "light";
      });
      await page
        .getByLabel(fi ? "Ulkoasu" : "Appearance", { exact: true })
        .selectOption("system");
      await expect(page.getByTestId("system-appearance")).toContainText(
        fi ? "Vaalea" : "Light",
      );
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = "dark";
      });
      await expect(page.getByTestId("system-appearance")).toContainText(
        fi ? "Tumma" : "Dark",
      );
    } finally {
      await app.close();
    }
  });
}
