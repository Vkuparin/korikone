import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("both chains stay signed in and switching keeps each chain's store", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-chains-"));
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
        name: "K-Ruoka · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    // Setup also offers the other chain, which has no store yet.
    const other = page.getByRole("listitem", { name: "S-kaupat" });
    await expect(other).toContainText("Kauppaa ei ole valittu");
    await other
      .getByRole("button", { name: "S-kaupat: Kirjaudu sisään" })
      .click();
    await expect(other.getByRole("status")).toHaveText("Kirjautunut");
    await page.getByRole("button", { name: "Jatka", exact: true }).click();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await page.getByRole("button", { name: "Suunnittele viikko" }).click();

    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await page.getByLabel("Etsi K-Ruoka- tai S-kaupat-kauppa").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    const kRuoka = page.getByRole("listitem", { name: "K-Ruoka" });
    const sKaupat = page.getByRole("listitem", { name: "S-kaupat" });
    await expect(sKaupat).toContainText("Käytössä");
    await expect(sKaupat.getByRole("status")).toHaveText("Kirjautunut");
    await expect(kRuoka).toContainText("K-Ruoka · Helsinki (fixture)");
    await expect(kRuoka.getByRole("status")).toHaveText("Kirjautunut");

    await kRuoka
      .getByRole("button", { name: "K-Ruoka: Käytä tätä kauppaa" })
      .click();
    await expect(kRuoka).toContainText("Käytössä");
    await expect(page.locator(".context")).toContainText(
      "K-Ruoka · Helsinki (fixture)",
    );
    await expect(sKaupat).toContainText("S-kaupat · Helsinki (fixture)");
    await expect(sKaupat.getByRole("status")).toHaveText("Kirjautunut");
  } finally {
    await app.close();
  }
});
