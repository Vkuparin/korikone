import { completeFixtureLogin } from "./store-helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initialState } from "../../src/domain/model";

test("a list row opens its product details and can change the product", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-details-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
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
    const name = list.getByRole("button", {
      name: "Kotimaista sika-nauta jauheliha 23 % 400 g",
    });
    // Row actions remain visible; a look-alike is not a cheaper option.
    const row = list
      .locator(".grocery-row")
      .filter({ hasText: "Kotimaista sika-nauta jauheliha 23 % 400 g" });
    const home = row.getByRole("button", { name: "Löytyy kotoa: Jauheliha" });
    const opacity = () =>
      home.evaluate((el) => Number(getComputedStyle(el).opacity));
    await page.mouse.move(0, 0);
    await expect.poll(opacity).toBe(1);
    await row.hover();
    await expect.poll(opacity).toBe(1);
    await page.mouse.move(0, 0);
    await home.focus();
    await expect.poll(opacity).toBe(1);
    await expect(row).not.toContainText("Edullisempi");
    await expect(name).toHaveAttribute("aria-expanded", "false");
    await name.focus();
    await page.keyboard.press("Enter");
    const details = list.getByRole("region", { name: "Tiedot: Jauheliha" });
    await expect(details).toContainText("Tarvitaan: 400 g");
    await expect(details).toContainText("Ostetaan: 1 pakkaus, 400 g");
    await expect(details).toContainText("/ kg");
    const replacement = details.getByRole("button", {
      name: "Käytä kerran: Kotimaista kanan jauheliha 4% 400 g",
    });
    await replacement.focus();
    await page.keyboard.press("Enter");
    const chosen = list.getByRole("button", {
      name: "Kotimaista kanan jauheliha 4% 400 g",
      exact: true,
    });
    // The alternatives close once the choice is applied, and focus returns to the row's product.
    await expect(details).toHaveCount(0);
    await expect(chosen).toHaveAttribute("aria-expanded", "false");
    await expect(chosen).toBeFocused();
  } finally {
    await app.close();
  }
});

for (const language of ["fi", "en"] as const) {
  test(`row hierarchy retains corrections and selections in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-hierarchy-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.language = language;
      state.staples = [];
      const mealName =
        "Pitkä aterian nimi, jonka kaikki sanat pysyvät luettavina myös kapeassa näkymässä";
      const longName =
        "Pitkän tuotenimen paikallinen testituote, jonka koko nimi ja pakkaustiedot pitää voida lukea myös kapeassa ostoslistassa 500 g";
      const packName = "Testituote ilman ilmoitettua pakkauskokoa";
      const priceName = "Testituote ilman ilmoitettua hintaa 500 g";
      state.recipes = [
        {
          id: "layout-meal",
          name: mealName,
          servings: 2,
          instructions: "",
          kind: "meal",
          ingredients: [
            { id: "layout-long", name: longName, amount: 500, unit: "g" },
          ],
        },
      ];
      state.meals = [
        {
          id: "layout-serving",
          recipeId: "layout-meal",
          day: 0,
          servings: 2,
          leftovers: false,
        },
      ];
      state.extras = [
        { id: "layout-unknown-pack", name: packName, amount: 500, unit: "g" },
        { id: "layout-unknown-price", name: priceName, amount: 500, unit: "g" },
        { id: "carrot", name: "Porkkana", amount: 500, unit: "g" },
      ];
      expect(
        await page.evaluate(
          async (state) => (await window.korikone.save(state)).ok,
          state,
        ),
      ).toBe(true);
      await page.evaluate(
        (language) => window.korikone.setLanguage(language),
        language,
      );
      await page.reload();
      const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
      const meal = page.locator(".meal-select").filter({ hasText: mealName });
      await meal.focus();
      await page.keyboard.press("Enter");
      await expect(meal).toHaveAttribute("aria-pressed", "true");
      const long = page.locator(".grocery-row").filter({
        has: page.getByRole("button", {
          name: `${tr("Löytyy kotoa", "Already at home")}: ${longName}`,
          exact: true,
        }),
      });
      await expect(long).toHaveClass(/highlighted/);
      const pack = page.locator(".grocery-row").filter({
        has: page.getByRole("button", {
          name: `${tr("Löytyy kotoa", "Already at home")}: ${packName}`,
          exact: true,
        }),
      });
      await expect(pack).toHaveClass(/unresolved/);
      await expect(pack.locator(".row-price")).toHaveText(
        tr("Hinta puuttuu", "Price unknown"),
      );
      await pack.locator(".row-name").click();
      const packDetails = pack.getByRole("region");
      await expect(
        packDetails.getByRole("button", {
          name: /^(Käytä kerran|Use once)/,
        }),
      ).toBeDisabled();
      await packDetails.locator('input[type="number"]').fill("500");
      await packDetails
        .getByRole("button", {
          name: tr("Vahvista pakkauskoko", "Confirm pack size"),
        })
        .click();
      await expect(pack).not.toHaveClass(/unresolved/);
      await pack
        .getByRole("button", {
          name: `${tr("Lisää", "Increase")}: ${packName}`,
          exact: true,
        })
        .click();
      await expect(pack.locator(".quantity-control span")).toHaveText("2");
      await expect(packDetails).toContainText("500 g");
      const price = page.locator(".grocery-row").filter({ hasText: priceName });
      await price.locator(".row-name").click();
      await expect(
        price.getByRole("region").getByRole("button", {
          name: /^(Käytä kerran|Use once)/,
        }),
      ).toBeDisabled();
      const carrot = page.locator(".grocery-row").filter({
        has: page.locator('.home-button[aria-label$=": Porkkana"]'),
      });
      await carrot.locator(".row-name").click();
      await expect(
        carrot
          .locator(".candidate")
          .filter({ hasText: "Porkkana 1 kg" })
          .getByRole("button"),
      ).toBeDisabled();
      const home = long.getByRole("button", {
        name: `${tr("Löytyy kotoa", "Already at home")}: ${longName}`,
      });
      await home.focus();
      await page.keyboard.press("Enter");
      await expect(home).toHaveAttribute("aria-pressed", "true");
      await expect(home).toBeEnabled();
      await home.focus();
      await page.keyboard.press("Enter");
      await expect(home).toHaveAttribute("aria-pressed", "false");
      await expect(meal).toHaveAttribute("aria-pressed", "true");
      for (const appearance of ["light", "dark"] as const) {
        await page.evaluate(
          (appearance) => window.korikone.setAppearance(appearance),
          appearance,
        );
        for (const size of [
          { width: 1280, height: 800 },
          { width: 800, height: 600 },
        ]) {
          await page.setViewportSize(size);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          expect(
            await long
              .locator(".row-name")
              .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
          ).toBeGreaterThanOrEqual(16);
          expect(
            await long
              .locator(".row-amount")
              .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
          ).toBeGreaterThanOrEqual(14);
          await page.screenshot({
            path: `test-results/hierarchy-${language}-${appearance}-${size.width}.png`,
          });
          await long.scrollIntoViewIfNeeded();
          await long.screenshot({
            path: `test-results/hierarchy-row-${language}-${appearance}-${size.width}.png`,
          });
          await meal.screenshot({
            path: `test-results/hierarchy-meal-${language}-${appearance}-${size.width}.png`,
          });
          await price.locator(".row-name").click();
          await price.screenshot({
            path: `test-results/hierarchy-details-${language}-${appearance}-${size.width}.png`,
          });
          await price.locator(".row-name").click();
        }
      }
      const saved = (await page.evaluate(() => window.korikone.load())).value;
      expect(saved.state.quantities["layout-unknown-pack:g"]).toBe(1000);
      expect(saved.developmentRequests).toBe(0);
    } finally {
      await app.close();
    }
  });
}
