import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composer } from "./composer-helper";
import { settingsCategory } from "./settings-helper";

async function start(language: "fi" | "en") {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-fixes-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Aloita tyhjästä viikosta" }).click();
  await page.evaluate(async (language) => {
    const api = window.korikone;
    await api.setLanguage(language);
    await api.signInAI();
    const state = (await api.load()).value.state;
    const saved = await api.save({
      ...state,
      staples: [],
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
          servings: 3,
          leftovers: false,
        },
      ],
      extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    });
    if (!saved.ok) throw new Error(saved.error);
  }, language);
  await page.reload();
  return { app, page };
}

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`Clear list empties the list locally, explains it and undoes in ${language}`, async () => {
    const { app, page } = await start(language);
    try {
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const clear = page.getByRole("button", {
        name: tr("Tyhjennä lista", "Clear list"),
        exact: true,
      });
      const before = await load();
      await clear.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".list-empty-note")).toBeVisible();
      await expect(clear).toBeDisabled();
      await expect(page.locator(".edit-outcome")).toContainText(
        tr("Lista tyhjennetty", "List cleared"),
      );
      const cleared = await load();
      expect(cleared.state.meals).toEqual([]);
      expect(cleared.state.extras).toEqual([]);
      expect([
        cleared.developmentRequests,
        cleared.developmentStoreWrites,
      ]).toEqual([0, 0]);
      // The empty list stays empty across navigation.
      await page
        .getByRole("button", { name: tr("Reseptit", "Recipes"), exact: true })
        .click();
      await page
        .getByRole("button", {
          name: tr("Ostoslista", "Shopping list"),
          exact: true,
        })
        .click();
      await expect(page.locator(".grocery-row")).toHaveCount(0);
      await page
        .getByRole("button", { name: tr("Kumoa", "Undo"), exact: true })
        .click();
      await expect.poll(async () => (await load()).state.meals.length).toBe(2);
      const restored = await load();
      expect(restored.state.meals).toEqual(before.state.meals);
      expect(restored.state.extras).toEqual(before.state.extras);
      await expect(clear).toBeEnabled();
    } finally {
      await app.close();
    }
  });

  test(`unsent text is guarded before the list is cleared in ${language}`, async () => {
    const { app, page } = await start(language);
    try {
      await composer(page).fill(tr("lisää kahvia", "add coffee"));
      await page
        .getByRole("button", {
          name: tr("Tyhjennä lista", "Clear list"),
          exact: true,
        })
        .click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page
        .getByRole("button", { name: tr("Säilytä lista", "Keep the list") })
        .click();
      await expect(page.locator(".grocery-row").first()).toBeVisible();
      await expect(composer(page)).toHaveValue(
        tr("lisää kahvia", "add coffee"),
      );
    } finally {
      await app.close();
    }
  });

  test(`the people chip is a compact control that previews, applies and undoes on Shopping in ${language}`, async () => {
    const { app, page } = await start(language);
    try {
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const chip = page.getByRole("button", {
        name: new RegExp(`^4 ${tr("henkeä", "people")}$`),
      });
      await chip.click();
      const dialog = page.getByRole("dialog", {
        name: tr("Henkilömäärä", "Number of people"),
      });
      await expect(dialog).toBeVisible();
      const input = dialog.getByLabel(tr("Henkilömäärä", "Number of people"));
      const apply = dialog.getByRole("button", { name: tr("Käytä", "Apply") });
      // An invalid count previews nothing and cannot be applied.
      await input.fill("0");
      await expect(apply).toBeDisabled();
      await input.fill("abc");
      await expect(apply).toBeDisabled();
      // A valid one shows the meals it changes and those it keeps.
      await input.fill("6");
      await expect(dialog.locator(".household-preview")).toContainText(/4 → 6/);
      await expect(dialog.locator(".household-preview")).toContainText(/\(3\)/);
      const before = await load();
      expect(before.state.household.servings).toBe(4);
      expect(before.developmentRequests).toBe(0);
      // Escape keeps the plan and returns focus to the chip.
      await input.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(chip).toBeFocused();
      expect((await load()).state).toEqual(before.state);

      await chip.click();
      await dialog.getByLabel(tr("Henkilömäärä", "Number of people")).fill("6");
      await dialog.getByRole("button", { name: tr("Käytä", "Apply") }).click();
      await expect(dialog).toHaveCount(0);
      const after = await load();
      expect(after.state.household.servings).toBe(6);
      expect(after.state.meals.map((m) => [m.id, m.servings])).toEqual([
        ["m-pasta", 6],
        ["m-soup", 3],
      ]);
      expect(after.developmentRequests).toBe(0);
      expect(after.developmentStoreWrites).toBe(0);
      await expect(page.locator(".edit-outcome")).toContainText(
        tr("Talouden koko muutettu", "Household size changed"),
      );
      await page
        .getByRole("button", { name: tr("Kumoa", "Undo"), exact: true })
        .click();
      await expect
        .poll(async () => (await load()).state.household.servings)
        .toBe(4);
      const undone = await load();
      expect(undone.state.household.servings).toBe(4);
      expect(undone.state.meals[0].servings).toBe(4);
    } finally {
      await app.close();
    }
  });

  test(`Settings household size scales the meals, the home help is reachable and the language selector is compact in ${language}`, async () => {
    const { app, page } = await start(language);
    try {
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      // The home button explains itself on focus and keeps its accessible name.
      const home = page
        .getByRole("button", {
          name: new RegExp(`^${tr("Löytyy kotoa", "Already at home")}: `),
        })
        .first();
      await home.focus();
      const help = page.locator(".home-help").first();
      await expect(help).toBeVisible();
      await expect(help).toContainText(
        tr("ei siirretä kauppaan", "left out of the transfer"),
      );
      await expect(home).toHaveAttribute("aria-describedby", /home-help-/);

      await page
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(page, "household", tr("Kotitalous", "Household"));
      await page.locator('.settings-content input[name="servings"]').fill("6");
      await page
        .getByRole("button", { name: tr("Tallenna", "Save"), exact: true })
        .click();
      await expect
        .poll(async () => (await load()).state.household.servings)
        .toBe(6);
      const resized = await load();
      expect(resized.state.meals[0].servings).toBe(6);
      expect(resized.state.meals[1].servings).toBe(3);
      // General has the compact selector with no separate visible label.
      await settingsCategory(page, "general", tr("Yleiset", "General"));
      await expect(
        page.locator(".settings-content .language-control"),
      ).toBeVisible();
    } finally {
      await app.close();
    }
  });
}
