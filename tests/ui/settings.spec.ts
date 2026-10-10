import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

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
