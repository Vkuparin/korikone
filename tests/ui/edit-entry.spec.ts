import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function launch(dataDir?: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA =
    dataDir ?? (await mkdtemp(join(tmpdir(), "korikone-entry-")));
  return {
    app: await electron.launch({ args: ["."], env }),
    dataDir: env.KORIKONE_TEST_DATA,
  };
}

for (const language of ["fi", "en"] as const) {
  test(`row and meal entry focus the composer on one exact target and explain the edit in ${language}`, async () => {
    const { app, dataDir } = await launch();
    let current = app;
    try {
      let page = await current.firstWindow();
      const fi = language === "fi";
      const tr = (a: string, b: string) => (fi ? a : b);
      await page.evaluate(async (language) => {
        const state = (await window.korikone.load()).value.state;
        await window.korikone.save({
          ...state,
          onboarded: true,
          setupComplete: true,
          language,
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
              servings: 4,
              leftovers: false,
            },
          ],
          extras: [
            { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
            { id: "ruisleipä", name: "Ruisleipä", amount: 500, unit: "g" },
            { id: "paahtoleipä", name: "Paahtoleipä", amount: 400, unit: "g" },
          ],
          skipped: ["carrot:g"],
        });
        await window.korikone.setLanguage(language);
        await window.korikone.signInAI();
      }, language);
      await page.reload();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const edit = tr("Muokkaa ohjeella", "Edit with instruction");
      const composer = page.getByLabel(
        tr("Muokkaa nykyistä listaa", "Edit current list"),
      );
      const update = page.getByRole("button", {
        name: tr("Taio muutokset", "Update my shopping list"),
        exact: true,
      });
      const start = await load();

      // Two similar rows have distinct entry points; the target chip names the one chosen.
      const toast = page.getByRole("button", {
        name: `${edit}: Paahtoleipä`,
        exact: true,
      });
      await toast.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText(`${tr("Kohde", "About")}: Paahtoleipä`),
      ).toBeVisible();
      await expect(composer).toBeFocused();
      await page.keyboard.type(tr("poista tämä", "remove this"));
      await page.waitForTimeout(500);
      // Cancelling clears the target and sends nothing.
      await composer.press("Escape");
      await expect(page.getByText(`${tr("Kohde", "About")}:`)).toHaveCount(0);
      const idle = await load();
      expect(idle.developmentRequests).toBe(0);
      expect(idle.developmentCatalogueRequests).toBe(
        start.developmentCatalogueRequests,
      );
      expect(idle.state).toEqual(start.state);

      // The exact row is edited and every other row and flag stays.
      await toast.click();
      await update.click();
      await expect(page.locator(".edit-outcome > p").first()).toContainText(
        tr("Poistettu Paahtoleipä", "Removed Paahtoleipä"),
      );
      const edited = await load();
      expect(edited.state.removed).toEqual(["paahtoleipä:g"]);
      expect(edited.state.skipped).toEqual(["carrot:g"]);
      expect(edited.state.extras).toEqual(start.state.extras);
      expect(edited.developmentRequests).toBe(1);

      // Collapsed details give the concrete change and never an invented saving.
      const details = page.locator(".edit-details");
      await expect(details).toBeVisible();
      await expect(details).not.toHaveAttribute("open", "");
      await details.locator("summary").click();
      await expect(details).toContainText(
        tr("Poistettu Paahtoleipä (400 g)", "Removed Paahtoleipä (400 g)"),
      );
      await expect(details.locator("ul li")).toHaveCount(1);
      await expect(details).toContainText(tr("Ennallaan", "Unchanged"));
      await expect(page.locator(".edit-price")).toBeVisible();

      // A meal has its own entry; "this" resolves to it.
      await page
        .getByRole("button", {
          name: `${edit}: Tomaattipasta`,
          exact: true,
        })
        .click();
      await expect(
        page.getByText(`${tr("Kohde", "About")}: Tomaattipasta`),
      ).toBeVisible();
      await composer.fill(tr("tuplaa tämä", "double this"));
      await update.click();
      await expect(
        page.getByText(tr("annosta", "servings")).first(),
      ).toBeVisible();
      await expect
        .poll(async () => (await load()).state.meals[0].servings)
        .toBe(8);
      expect((await load()).state.removed).toEqual(["paahtoleipä:g"]);
      const doubled = await page.locator(".edit-details").first();
      await doubled.locator("summary").click();
      await expect(doubled).toContainText("4 → 8");

      // A restart restores the explanation for the current revision; Undo needs no second approval.
      await current.close();
      ({ app: current } = await launch(dataDir));
      page = await current.firstWindow();
      await page.locator(".edit-details summary").click();
      await expect(page.locator(".edit-details")).toContainText("4 → 8");
      await page
        .getByRole("button", { name: tr("Kumoa", "Undo"), exact: true })
        .click();
      await expect(
        page.getByText(tr("Muutos kumottu:", "Change undone:")),
      ).toBeVisible();
      expect((await load()).state.meals[0].servings).toBe(4);
      expect((await load()).state.removed).toEqual(["paahtoleipä:g"]);

      // Narrow layout: the entry stays reachable without horizontal scrolling.
      await current.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await current.close();
    }
  });
}
