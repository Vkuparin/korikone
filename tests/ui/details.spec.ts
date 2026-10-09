import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
    // Quiet rows: home and remove appear on hover or focus; a look-alike is not a cheaper option.
    const row = list
      .locator(".grocery-row")
      .filter({ hasText: "Kotimaista sika-nauta jauheliha 23 % 400 g" });
    const home = row.getByRole("button", { name: "Löytyy kotoa: Jauheliha" });
    const opacity = () =>
      home.evaluate((el) => Number(getComputedStyle(el).opacity));
    await page.mouse.move(0, 0);
    await expect.poll(opacity).toBe(0);
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
    await details
      .getByRole("button", {
        name: "Valitse tuote: Kotimaista kanan jauheliha 4% 400 g",
      })
      .click();
    const chosen = list.getByRole("button", {
      name: "Kotimaista kanan jauheliha 4% 400 g",
      exact: true,
    });
    await expect(chosen).toHaveAttribute("aria-expanded", "true");
    await expect(details).toContainText("Tälle ainekselle hyväksymäsi tuote.");
    await chosen.click();
    await expect(details).toHaveCount(0);
  } finally {
    await app.close();
  }
});
