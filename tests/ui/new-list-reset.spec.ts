import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composer } from "./composer-helper";

async function launch(language: "fi" | "en", dir?: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = dir ?? (await mkdtemp(join(tmpdir(), "korikone-reset-")));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  return { app, data, page, language };
}

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`New list confirms once and resets the whole screen, and Cancel changes nothing in ${language}`, async () => {
    const { app, data, page } = await launch(language);
    let current = app;
    let view = page;
    try {
      await view
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await view.evaluate(async (language) => {
        const api = window.korikone;
        await api.setLanguage(language);
        await api.signInAI();
        const state = (await api.load()).value.state;
        const saved = await api.save({
          ...state,
          staples: [],
          note: "Pasta ja keitto",
          meals: [
            {
              id: "m-pasta",
              recipeId: "pasta",
              day: 0,
              servings: 4,
              leftovers: false,
            },
            {
              id: "m-soup",
              recipeId: "soup",
              day: 1,
              servings: 4,
              leftovers: false,
            },
          ],
          extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
        });
        if (!saved.ok) throw new Error(saved.error);
        await api.buildBasket();
      }, language);
      await view.reload();
      const load = async () =>
        (await view.evaluate(() => window.korikone.load())).value;
      const before = await load();
      expect(before.state.meals).toHaveLength(2);
      // Populated, with an unsent instruction, a focused target and an open row.
      await composer(view).fill(tr("lisää kahvia", "add coffee"));
      await view
        .getByRole("button", {
          name: new RegExp(
            `${tr("Muokkaa ohjeella", "Edit with instruction")}: Maito`,
          ),
        })
        .click();
      const open = view.getByRole("button", {
        name: tr("Uusi lista", "New list"),
        exact: true,
      });
      await open.click();

      // Cancel and Escape keep everything and return focus.
      const dialog = view.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: tr("Peruuta", "Cancel") })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(open).toBeFocused();
      expect((await load()).state).toEqual(before.state);
      await expect(composer(view)).toHaveValue(
        tr("lisää kahvia", "add coffee"),
      );
      await open.click();
      await view.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(open).toBeFocused();
      expect((await load()).state).toEqual(before.state);

      // Confirm: one durable local reset, no request, no write.
      await open.click();
      await dialog
        .getByRole("button", {
          name: tr("Aloita uusi lista", "Start new list"),
        })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(view.locator(".interpretation")).toHaveCount(0);
      await expect(view.locator(".grocery-row")).toHaveCount(0);
      await expect(view.locator(".edit-outcome")).toHaveCount(0);
      await expect(view.locator(".composer-focus")).toHaveCount(0);
      const reset = await load();
      expect(reset.state.meals).toEqual([]);
      expect(reset.state.extras).toEqual([]);
      expect(reset.state.note).toBe("");
      expect([reset.developmentRequests, reset.developmentStoreWrites]).toEqual(
        [0, 0],
      );
      expect(reset.state.recipes).toEqual(before.state.recipes);
      await expect(composer(view)).toHaveValue("");
      // The old drafts are not in session storage and do not come back after a reload.
      expect(
        await view.evaluate(() =>
          sessionStorage.getItem("shopping-edit-instruction"),
        ),
      ).toBeNull();
      await view.reload();
      await expect(composer(view)).toHaveValue("");
      await expect(view.locator(".interpretation")).toHaveCount(0);

      // The empty list is still empty after a restart.
      await current.close();
      ({ app: current, page: view } = await launch(language, data));
      await expect(composer(view)).toHaveValue("");
      await expect(view.locator(".grocery-row")).toHaveCount(0);
      expect((await load()).state.meals).toEqual([]);
    } finally {
      await current.close();
    }
  });

  test(`New list on an empty list with unsent text still asks once in ${language}`, async () => {
    const { app, page } = await launch(language);
    try {
      await page
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await page.evaluate(
        (language) => window.korikone.setLanguage(language),
        language,
      );
      await page.reload();
      await composer(page).fill(tr("Nakkikeitto", "Sausage soup"));
      await page
        .getByRole("button", {
          name: tr("Uusi lista", "New list"),
          exact: true,
        })
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", {
          name: tr("Aloita uusi lista", "Start new list"),
        })
        .click();
      await expect(composer(page)).toHaveValue("");
      await expect(dialog).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}
