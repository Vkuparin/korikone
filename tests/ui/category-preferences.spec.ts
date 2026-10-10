import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initialState } from "../../src/domain/model";
import { settingsCategory } from "./settings-helper";

for (const language of ["fi", "en"] as const)
  test(`Advanced preferences retain explicit consent, drafts, restart and backup in ${language}`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "korikone-preferences-settings-"),
    );
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, {
      KORIKONE_TEST_DATA: directory,
      KORIKONE_TEST_HIDDEN: "1",
    });
    let app = await electron.launch({ args: ["."], env });
    const fi = language === "fi";
    const names = {
      settings: fi ? "Asetukset" : "Settings",
      advanced: fi ? "Lisäasetukset" : "Advanced",
      coffee: fi ? "Kahvi" : "Coffee",
      cream: fi ? "Kerma" : "Cream",
      edit: fi ? "Muokkaa" : "Edit",
      cancel: fi ? "Peruuta" : "Cancel",
      save: fi ? "Tallenna tyyppi" : "Save type",
      forget: fi ? "Unohda" : "Forget",
      reset: fi ? "Unohda kaikki tuotetyypit" : "Forget all product types",
      confirm: fi ? "Vahvista unohtaminen" : "Confirm forgetting",
    };
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.language = language;
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.note = "Saved fixture note";
      state.extras = [
        { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
        { id: "cream", name: "Ruokakerma", amount: 200, unit: "ml" },
      ];
      await page.evaluate(async (state) => {
        const api = window.korikone;
        await api.save(state);
        await api.setLanguage(state.language);
        await api.buildBasket();
        for (const [category, key, productId, kind, value] of [
          ["coffee", "coffee:g", "coffee", "coffee", "ground"],
          ["cream", "cream:ml", "cream", "cream", "cooking"],
        ]) {
          const current = (await api.load()).value;
          const result = await api.rememberCategoryPreference({
            revision: current.state.revision,
            requirementKey: key,
            productId,
            preference: {
              category,
              qualifiers: [{ kind, value }],
              strength: "required",
            },
          });
          if (!result.ok) throw new Error(result.error);
        }
      }, state);
      await page.reload();
      await page.setViewportSize({ width: 800, height: 600 });
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const seeded = await load();
      const openAdvanced = async () => {
        await page
          .getByRole("button", { name: names.settings, exact: true })
          .click();
        await settingsCategory(page, "advanced", names.advanced);
      };
      await openAdvanced();
      await page.screenshot({
        path: `test-results/preferences-${language}-advanced.png`,
      });
      expect((await load()).developmentCatalogueRequests).toBe(
        seeded.developmentCatalogueRequests,
      );
      const coffee = () =>
        page.getByRole("article", { name: names.coffee, exact: true });
      const cream = () =>
        page.getByRole("article", { name: names.cream, exact: true });
      const backup = join(directory, "backup.json");
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, backup);
      await page
        .getByRole("button", {
          name: fi
            ? "Tallenna varmuuskopio ennen muutoksia"
            : "Save a backup before changes",
        })
        .press("Enter");
      await expect
        .poll(async () => {
          try {
            return JSON.parse(await readFile(backup, "utf8"))
              .categoryPreferences.length;
          } catch {
            return 0;
          }
        })
        .toBe(2);
      await expect(
        coffee().getByRole("button", { name: names.edit, exact: true }),
      ).toBeEnabled();
      await coffee()
        .getByRole("button", { name: names.edit, exact: true })
        .press("Enter");
      const type = coffee().locator("select").first();
      await expect(type).toBeFocused();
      await page.screenshot({
        path: `test-results/preferences-${language}-editor.png`,
      });
      await type.press("ArrowDown");
      await expect(type).toHaveValue("beans");
      await coffee().locator("select").last().press("ArrowDown");
      await coffee().getByRole("button", { name: names.save }).press("Enter");
      await expect(coffee()).toContainText(fi ? "Pavut" : "Beans");
      await expect(
        coffee().getByRole("button", { name: names.edit, exact: true }),
      ).toBeFocused();
      expect(
        (await load()).state.categoryPreferences.find(
          (r: { category: string }) => r.category === "coffee",
        )!.strength,
      ).toBe("preferred");
      await coffee()
        .getByRole("button", { name: names.edit, exact: true })
        .press("Enter");
      await coffee().locator("select").first().press("ArrowDown");
      await coffee().getByRole("button", { name: names.cancel }).press("Enter");
      expect(
        (await load()).state.categoryPreferences.find(
          (r: { category: string }) => r.category === "coffee",
        )!.qualifiers[0].value,
      ).toBe("beans");
      await coffee()
        .getByRole("button", { name: names.edit, exact: true })
        .press("Enter");
      await page.evaluate(async () => {
        const api = window.korikone;
        const current = (await api.load()).value;
        await api.save({ ...current.state, note: "Concurrent fixture edit" });
      });
      await coffee().getByRole("button", { name: names.save }).press("Enter");
      await expect(page.locator(".error")).toBeVisible();
      await expect(
        coffee().getByRole("button", { name: names.edit, exact: true }),
      ).toBeVisible();
      await cream()
        .getByRole("button", { name: names.forget, exact: true })
        .press("Enter");
      await expect(cream()).toHaveCount(0);
      await expect(
        page.getByRole("heading", {
          name: fi ? "Muistetut tuotetyypit" : "Remembered product types",
          exact: true,
        }),
      ).toBeFocused();
      const beforeCancel = await load();
      await page
        .getByRole("button", { name: names.reset, exact: true })
        .press("Enter");
      await page
        .getByRole("group")
        .getByRole("button", { name: names.cancel })
        .press("Enter");
      await expect(
        page.getByRole("button", { name: names.reset, exact: true }),
      ).toBeFocused();
      expect((await load()).state.categoryPreferences).toEqual(
        beforeCancel.state.categoryPreferences,
      );
      expect((await load()).developmentCatalogueRequests).toBe(
        beforeCancel.developmentCatalogueRequests,
      );
      await page
        .getByRole("button", { name: names.reset, exact: true })
        .press("Enter");
      await page.getByRole("button", { name: names.confirm }).press("Enter");
      await expect(coffee()).toHaveCount(0);
      expect((await load()).state.categoryPreferences).toEqual([]);
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, backup);
      const restored = await page.evaluate(() => window.korikone.importData());
      expect(restored.ok).toBe(true);
      expect(restored.value.state.categoryPreferences).toEqual(
        seeded.state.categoryPreferences,
      );
      await app.close();
      app = await electron.launch({ args: ["."], env });
      page = await app.firstWindow();
      const restarted = await load();
      expect(restarted.state.categoryPreferences).toEqual(
        seeded.state.categoryPreferences,
      );
      await openAdvanced();
      await expect(coffee()).toContainText(fi ? "Jauhettu" : "Ground");
      expect((await load()).developmentCatalogueRequests).toBe(
        restarted.developmentCatalogueRequests,
      );
      expect((await load()).developmentRequests).toBe(0);
      expect((await load()).developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
