import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { settingsCategory } from "./settings-helper";

test("the example list names its sample store on Kauppa and in Settings > Kaupat (B7.8)", async () => {
  const path = await mkdtemp(join(tmpdir(), "korikone-example-store-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = path;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await page.getByRole("button", { name: "Kauppa", exact: true }).click();
    const store = page.locator(".store-page");
    await expect(store).toContainText(
      "Esimerkkilista käyttää mallikauppaa (K-Ruoka · Helsinki (demo))",
    );
    await expect(store).not.toContainText("Valitse ensin kauppa");
    await store
      .getByRole("button", { name: "Valitse oikea kauppa", exact: true })
      .click();
    await settingsCategory(page, "stores", "Kaupat");
    const chains = page.locator(".chains");
    await expect(chains.getByLabel("K-Ruoka", { exact: true })).toContainText(
      "Esimerkki käyttää mallikauppaa: K-Ruoka · Helsinki (demo)",
    );
    // The other chain has no store yet and says so plainly.
    await expect(chains.getByLabel("S-kaupat", { exact: true })).toContainText(
      "Kauppaa ei ole valittu",
    );
  } finally {
    await app.close();
  }
});
