import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { settingsCategory } from "./settings-helper";
test("unsaved recipe quantities survive language switching and saved data survives restart", async () => {
  const path = await mkdtemp(join(tmpdir(), "korikone-forms-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = path;
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByRole("button", { name: "Reseptit", exact: true }).click();
    await page.getByRole("button", { name: "Uusi resepti" }).click();
    await page.getByLabel("Nimi", { exact: true }).fill("Testikeitto");
    await page.getByRole("button", { name: "Lisää aines" }).click();
    await page.getByLabel("Nimi", { exact: true }).nth(1).fill("Peruna");
    await page.getByLabel("Määrä", { exact: true }).fill("0,125");
    await page
      .locator("form", {
        has: page.getByLabel("Nimi", { exact: true }).first(),
      })
      .getByLabel("Yksikkö")
      .selectOption("kg");
    await page.getByLabel("Kieli", { exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.getByLabel("Amount", { exact: true })).toHaveValue(
      "0,125",
    );
    await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue(
      "Testikeitto",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Peruna · 125 g")).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settingsCategory(page, "advanced", "Advanced");
    await page.getByLabel("Store", { exact: true }).selectOption("demo-s");
    await expect(page.locator(".context")).toContainText("S-kaupat");
    await page
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    await page.getByText("Add saved recipes", { exact: true }).click();
    await expect(page.getByLabel("Recipe", { exact: true })).toContainText(
      "Testikeitto",
    );
    await page.setViewportSize({ width: 720, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "test-results/narrow-week.png" });
    await app.close();
    app = await electron.launch({ args: ["."], env });
    const restarted = await app.firstWindow();
    await restarted.getByText("Add saved recipes", { exact: true }).click();
    await expect(restarted.getByLabel("Recipe", { exact: true })).toContainText(
      "Testikeitto",
    );
    await expect(restarted.locator(".context")).toContainText("S-kaupat");
    await restarted
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await settingsCategory(restarted, "household", "Household");
    await restarted
      .getByRole("button", { name: "Edit regular items", exact: true })
      .click();
    await restarted.getByRole("button", { name: "Edit", exact: true }).click();
    await restarted.getByLabel("Amount", { exact: true }).fill("750");
    await restarted.getByRole("button", { name: "Save", exact: true }).click();
    await expect(restarted.locator("article")).toHaveCount(1);
    await expect(restarted.locator("article")).toContainText("750 g");
  } finally {
    await app.close();
  }
});

test("a recipe and a new regular item being written keep their text after a look at another page (B6.8)", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-drafts-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    const nav = (name: string) =>
      page
        .getByRole("navigation")
        .first()
        .getByRole("button", { name, exact: true });
    await nav("Reseptit").click();
    await page.getByRole("button", { name: "Uusi resepti" }).click();
    await page.getByLabel("Nimi", { exact: true }).fill("Keskeneräinen keitto");
    await page.getByRole("button", { name: "Lisää aines" }).click();
    await page.getByLabel("Nimi", { exact: true }).nth(1).fill("Peruna");
    await page.getByLabel("Määrä", { exact: true }).fill("2");
    await nav("Ostoslista").click();
    await nav("Reseptit").click();
    await expect(page.getByLabel("Nimi", { exact: true }).first()).toHaveValue(
      "Keskeneräinen keitto",
    );
    await expect(page.getByLabel("Nimi", { exact: true }).nth(1)).toHaveValue(
      "Peruna",
    );
    await expect(page.getByLabel("Määrä", { exact: true })).toHaveValue("2");
    // Nothing was saved on the way.
    expect(
      (
        await page.evaluate(() => window.korikone.load())
      ).value.state.recipes.some(
        (r: { name: string }) => r.name === "Keskeneräinen keitto",
      ),
    ).toBe(false);

    await nav("Asetukset").click();
    await settingsCategory(page, "household", "Kotitalous");
    await page.getByRole("button", { name: "Muokkaa vakiotuotteita" }).click();
    const form = page.locator("form", {
      has: page.getByRole("button", { name: "Lisää vakiotuote" }),
    });
    await form.getByLabel("Nimi", { exact: true }).fill("Kahvi");
    await nav("Ostoslista").click();
    await nav("Asetukset").click();
    await settingsCategory(page, "household", "Kotitalous");
    await page.getByRole("button", { name: "Muokkaa vakiotuotteita" }).click();
    await expect(form.getByLabel("Nimi", { exact: true })).toHaveValue("Kahvi");
  } finally {
    await app.close();
  }
});
