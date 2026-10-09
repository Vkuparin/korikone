import { completeFixtureLogin } from "./store-helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("a product without a stated pack size can be confirmed from the row details", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-packsize-"));
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
    await list
      .getByRole("button", {
        name: "Kotimaista sika-nauta jauheliha 23 % 400 g",
      })
      .click();
    const details = list.getByRole("region", { name: "Tiedot: Jauheliha" });
    const candidate = details
      .locator(".candidate")
      .filter({ hasText: "Luomujauheliha" });
    await expect(candidate).toContainText("Pakkauskokoa ei ilmoiteta");
    await expect(
      candidate.getByRole("button", { name: /^Valitse tuote/ }),
    ).toBeDisabled();
    await candidate
      .getByLabel("Pakkauskoko: Luomujauheliha")
      .first()
      .fill("500");
    await candidate
      .getByRole("button", { name: "Vahvista pakkauskoko" })
      .click();
    await expect(candidate).toContainText("500 g");
    await expect(candidate).not.toContainText("Pakkauskokoa ei ilmoiteta");
    await candidate.getByRole("button", { name: /^Valitse tuote/ }).click();
    await expect(
      list.getByRole("button", { name: "Luomujauheliha", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  } finally {
    await app.close();
  }
});
