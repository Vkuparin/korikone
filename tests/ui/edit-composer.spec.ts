import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-composer-"));
  return electron.launch({ args: ["."], env });
}

for (const language of ["fi", "en"] as const) {
  test(`the composer edits the saved list, asks for clarification and undoes in ${language}`, async () => {
    const app = await launch();
    try {
      const page = await app.firstWindow();
      const fi = language === "fi";
      const tr = (a: string, b: string) => (fi ? a : b);
      await page.evaluate(async (language) => {
        const loaded = await window.korikone.load();
        const state = loaded.value.state;
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
        });
        await window.korikone.setLanguage(language);
        await window.korikone.signInAI();
      }, language);
      await page.reload();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const button = (name: string) =>
        page.getByRole("button", { name, exact: true });
      const composer = page.getByLabel(
        tr("Muokkaa nykyistä listaa", "Edit current list"),
      );
      const update = button(tr("Taio muutokset", "Update my shopping list"));
      await expect(composer).toBeVisible();
      await expect(button(tr("Uusi lista", "New list"))).toBeVisible();
      const planned = await load();
      const revision = planned.state.revision;

      // Typing and opening menus make no request.
      await composer.fill(tr("poista leipä", "remove bread"));
      await page.waitForTimeout(600);
      expect((await load()).developmentRequests).toBe(0);

      // An ambiguous instruction leaves the list alone and offers the candidates.
      await update.click();
      const choice = page.getByRole("button", { name: /^Paahtoleipä ·/ });
      await expect(choice).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Ruisleipä ·/ }),
      ).toBeVisible();
      await expect(
        page.getByText(tr("Lista ei muuttunut.", "The list did not change.")),
      ).toBeVisible();
      expect((await load()).state.revision).toBe(revision);
      expect((await load()).developmentRequests).toBe(1);
      await expect(composer).toHaveValue(tr("poista leipä", "remove bread"));

      // The chosen candidate resubmits with its exact target.
      await choice.click();
      await expect(
        page.getByText(tr("Lista päivitetty:", "List updated:")),
      ).toBeVisible();
      await expect(page.locator(".edit-outcome > p").first()).toContainText(
        tr("Poistettu Paahtoleipä", "Removed Paahtoleipä"),
      );
      await expect(composer).toHaveValue("");
      const edited = await load();
      expect(edited.state.revision).toBe(revision + 1);
      expect(edited.state.removed).toEqual(["paahtoleipä:g"]);
      expect(edited.developmentRequests).toBe(2);
      expect(edited.developmentStoreWrites).toBe(0);

      // Undo is local.
      await button(tr("Kumoa", "Undo")).click();
      await expect(
        page.getByText(tr("Muutos kumottu:", "Change undone:")),
      ).toBeVisible();
      await expect(button(tr("Kumoa", "Undo"))).toHaveCount(0);
      const undone = await load();
      expect(undone.state.removed).toEqual([]);
      expect(undone.developmentRequests).toBe(2);
      expect(undone.editUndoAvailable).toBe(false);

      // An unsupported instruction names itself and changes nothing.
      await composer.fill(tr("tilaa kotiinkuljetus", "order home delivery"));
      await update.click();
      await expect(
        page.getByText(tr("Lista ei muuttunut.", "The list did not change.")),
      ).toBeVisible();
      expect((await load()).state.revision).toBe(undone.state.revision);

      // New list always asks once; Cancel keeps the list, the instruction and the focus.
      await button(tr("Uusi lista", "New list")).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await button(tr("Peruuta", "Cancel")).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(composer).toHaveValue(
        tr("tilaa kotiinkuljetus", "order home delivery"),
      );
      expect((await load()).state.meals).toHaveLength(2);

      // Confirming resets the whole workspace and returns the empty first-list composer.
      await button(tr("Uusi lista", "New list")).click();
      await button(tr("Aloita uusi lista", "Start new list")).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      const empty = await load();
      expect(empty.state.meals).toEqual([]);
      expect(empty.editUndoAvailable).toBe(false);
      const fresh = page.getByLabel(
        tr("Mitä haluaisit valmistaa?", "What would you like to cook?"),
        { exact: true },
      );
      await expect(fresh).toHaveValue("");
      await fresh.fill("Nakkikeitto");
      await button(tr("Taio ostoslista", "Create my shopping list")).click();
      await expect
        .poll(async () => (await load()).state.note, { timeout: 20000 })
        .toBe("Nakkikeitto");
      expect((await load()).editUndoAvailable).toBe(false);
    } finally {
      await app.close();
    }
  });
}

test("a failed edit keeps the instruction and the list", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      const state = (await window.korikone.load()).value.state;
      await window.korikone.save({
        ...state,
        onboarded: true,
        setupComplete: true,
        language: "en",
        staples: [],
        meals: [
          {
            id: "m-soup",
            recipeId: "soup",
            day: 0,
            servings: 4,
            leftovers: false,
          },
        ],
      });
      await window.korikone.setLanguage("en");
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("usageLimit");
    });
    await page.reload();
    const composer = page.getByLabel("Edit current list");
    await composer.fill("double the soup");
    await page
      .getByRole("button", { name: "Update my shopping list", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(composer).toHaveValue("double the soup");
    await expect(page.getByText("The list was not changed")).toBeVisible();
    const after = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(after.state.meals[0].servings).toBe(4);
    expect(after.editUndoAvailable).toBe(false);
  } finally {
    await app.close();
  }
});

test("text typed while an edit runs stays in the composer", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      const state = (await window.korikone.load()).value.state;
      await window.korikone.save({
        ...state,
        onboarded: true,
        setupComplete: true,
        language: "en",
        staples: [],
        meals: [
          {
            id: "m-soup",
            recipeId: "soup",
            day: 0,
            servings: 4,
            leftovers: false,
          },
        ],
      });
      await window.korikone.setLanguage("en");
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("delayedSuccess");
    });
    await page.reload();
    const composer = page.getByLabel("Edit current list");
    await composer.fill("double the soup");
    await page
      .getByRole("button", { name: "Update my shopping list", exact: true })
      .click();
    await composer.fill("add milk");
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              async () => (await window.korikone.load()).value,
            )
          ).state.meals[0].servings,
        { timeout: 15000 },
      )
      .toBe(8);
    await page.waitForTimeout(300);
    await expect(composer).toHaveValue("add milk");
  } finally {
    await app.close();
  }
});
