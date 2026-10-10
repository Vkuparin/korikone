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
    await page.getByLabel("Yksikkö").selectOption("kg");
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
    await settingsCategory(page, "stores", "Stores");
    await page.getByText("Advanced settings", { exact: true }).click();
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
