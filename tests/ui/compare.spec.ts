import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("comparing stores is read-only and can switch to the other chain", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-compare-"));
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

    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Makaronilaatikko");
    await note.press("Control+Enter");
    const list = page.getByRole("complementary");
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(
      "Ostoslista · 7",
      { timeout: 15000 },
    );
    const cartBefore = await page.evaluate(
      async () => (await window.korikone.load()).value.state,
    );
    const compare = list.getByRole("button", { name: "Vertaa kauppoja" });
    await compare.click();
    const panel = list.getByRole("region", { name: "Kauppojen vertailu" });
    await expect(panel.getByRole("columnheader")).toHaveText([
      "",
      "S-kaupat",
      "K-Ruoka",
    ]);
    // The K-Ruoka fixture has no salt and dearer mince.
    await expect(panel).toContainText("Molemmissa hinnoitellut (6)");
    await expect(panel).toContainText("1 ilman hintaa");
    await expect(panel.getByRole("status")).toContainText(
      "S-kaupat on edullisempi",
    );
    await expect(panel.getByRole("row", { name: /Noutomaksu/ })).toContainText(
      "ei tiedossa",
    );
    await expect(list).toContainText("Noutomaksu 3,90");
    await expect(panel.getByRole("listitem").first()).toContainText(
      "Jauheliha",
    );
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value.state,
      ),
    ).toEqual(cartBefore);

    await panel.getByRole("button", { name: "Sulje vertailu" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".context")).toContainText(
      "S-kaupat · Helsinki (fixture)",
    );

    await compare.click();
    await list
      .getByRole("button", { name: "Käytä tätä kauppaa: K-Ruoka" })
      .click();
    await expect(page.locator(".context")).toContainText(
      "K-Ruoka · Helsinki (fixture)",
    );
    await expect(panel).toHaveCount(0);
    await expect(list).toContainText("Suola");
  } finally {
    await app.close();
  }
});
