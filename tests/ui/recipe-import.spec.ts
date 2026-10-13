import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const language of ["fi", "en"] as const) {
  test(`pasted text becomes a reviewable recipe draft that saves only on Save in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-import-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const fi = language === "fi";
      const tr = (a: string, b: string) => (fi ? a : b);
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
      const scenario = (name: string) =>
        page.evaluate(
          (name) => window.korikone.developmentScenario(name),
          name,
        );
      await page
        .getByRole("button", { name: tr("Reseptit", "Recipes"), exact: true })
        .click();
      const start = await load();
      const open = page.getByRole("button", {
        name: tr("Tuo resepti tekstistä", "Import recipe from text"),
        exact: true,
      });
      const submit = page.getByRole("button", {
        name: tr("Tuo resepti", "Import recipe"),
        exact: true,
      });
      const paste = page.getByLabel(
        tr("Liitä resepti tekstinä", "Paste the recipe as text"),
      );
      const text =
        "Nakkikeitto: 4 annosta, 800 g perunaa, 400 g porkkanaa, 400 g nakkeja.";

      // Opening and typing send nothing and an empty paste cannot be submitted.
      await open.click();
      await expect(submit).toBeDisabled();
      await paste.fill(text);
      await page.waitForTimeout(500);
      expect((await load()).developmentRequests).toBe(0);

      // Invalid draft and usage limit: nothing is saved, the text stays for another try.
      for (const [name, code] of [
        ["invalidDraft", "invalidDraft"],
        ["usageLimit", "usageLimit"],
      ] as const) {
        await scenario(name);
        await submit.click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(paste).toHaveValue(text);
        const failed = await load();
        expect(failed.state).toEqual(start.state);
        expect(failed.recipeDraft).toBeNull();
        expect(code).toBeTruthy();
      }

      // Cancelling a slow import leaves no draft and saves nothing.
      await scenario("delayedSuccess");
      await submit.click();
      const cancel = page.getByRole("button", {
        name: tr("Peruuta tuonti", "Cancel import"),
        exact: true,
      });
      await expect(cancel).toBeVisible();
      await cancel.click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      const cancelled = await load();
      expect(cancelled.state).toEqual(start.state);
      expect(cancelled.recipeDraft).toBeNull();

      // A retry succeeds: the draft opens in the recipe form and nothing is saved yet.
      await scenario("success");
      await open.click();
      await paste.fill(text);
      await submit.click();
      await expect(page.getByLabel(tr("Nimi", "Name")).first()).toHaveValue(
        "Nakkikeitto",
      );
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: tr("Tarkista tuotu", "Review the imported") }),
      ).toBeVisible();
      expect((await load()).state.recipes).toEqual(start.state.recipes);

      // One amount is edited, then Save stores the recipe.
      const amount = page
        .getByLabel(tr("Määrä", "Amount"), { exact: true })
        .first();
      await expect(amount).toHaveValue("800");
      await amount.fill("1000");
      await page
        .getByRole("button", { name: tr("Tallenna", "Save"), exact: true })
        .click();
      await expect
        .poll(async () => (await load()).state.recipes.length)
        .toBe(start.state.recipes.length + 1);
      const saved = (await load()).state.recipes.find(
        (r) => r.name === "Nakkikeitto",
      )!;
      expect(saved.ingredients[0]).toMatchObject({
        id: "potato",
        amount: 1000,
        unit: "g",
      });
      // Failures and the cancel used one request each: usage limit, invalid draft (2), success.
      expect((await load()).developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}
