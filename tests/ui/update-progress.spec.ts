import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composer } from "./composer-helper";

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`a new list shows activity while it runs and a refused draft is explained without an authentication link in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-progress-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await page.evaluate(async (language) => {
        await window.korikone.setLanguage(language);
        await window.korikone.signInAI();
      }, language);
      await page.reload();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const note = composer(page);
      const text = "Nakkikeitto ja kanapasta";
      const update = page.getByRole("button", {
        name: tr("Päivitä lista", "Update list"),
        exact: true,
      });
      const status = page.locator("#note-update-help");

      // Activity is visible while a slow reply is awaited: a stage and elapsed seconds.
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedSuccess"),
      );
      await note.fill(text);
      await update.click();
      await expect(status).not.toHaveText(
        tr("Ctrl + Enter päivittää listan", "Ctrl + Enter to update the list"),
      );
      await expect(page.locator(".note-elapsed")).toBeVisible({
        timeout: 10000,
      });
      await expect(note).toHaveValue(text);
      await expect(page.locator(".note-box")).not.toHaveClass(/is-working/, {
        timeout: 20000,
      });

      // A refused draft: the note is kept, the cause is named and no sign-in link is offered.
      await page
        .getByRole("button", { name: tr("Uusi lista", "New list") })
        .click();
      await page.evaluate(() =>
        window.korikone.developmentScenario("invalidDraft"),
      );
      await note.fill(text);
      await page
        .getByRole("button", {
          name: tr("Luo uusi lista", "Create new list"),
          exact: true,
        })
        .click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole("alert")).not.toContainText(
        tr("ChatGPT ja tekoäly", "ChatGPT and AI"),
      );
      await expect(note).toHaveValue(text);
      await expect(page.getByTestId("failure-cause")).toContainText(
        tr("Muistiinpanosi säilyi", "Your note was kept"),
      );
      const failed = await load();
      expect(failed.state.meals.length).toBeGreaterThan(0);

      // Explicit retry after the failure works from the same note.
      await page.evaluate(() => window.korikone.developmentScenario("success"));
      await page
        .getByRole("button", {
          name: tr("Luo uusi lista", "Create new list"),
          exact: true,
        })
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 20000 });
    } finally {
      await app.close();
    }
  });
}
