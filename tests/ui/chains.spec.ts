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
  let app = await electron.launch({ args: ["."], env });
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

    // Saved logins are found again after a restart, without pressing the check button.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    const restarted = await app.firstWindow();
    await restarted
      .getByRole("button", { name: "Asetukset", exact: true })
      .click();
    for (const name of ["K-Ruoka", "S-kaupat"])
      await expect(
        restarted.getByRole("listitem", { name }).getByRole("status"),
      ).toHaveText("Kirjautunut");
  } finally {
    await app.close();
  }
});

test("a chain card chooses its own store and the bar says what comparing needs", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-pick-"));
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

    const bar = page.getByRole("region", { name: "Yhteensä ja siirto" });
    await expect(bar).toContainText(
      "Vertailua varten valitse kauppa ketjulle S-kaupat.",
    );
    await bar.getByRole("button", { name: "Avaa Asetukset" }).click();
    const sKaupat = page.getByRole("listitem", { name: "S-kaupat" });
    await sKaupat
      .getByRole("button", { name: "S-kaupat: Valitse kauppa" })
      .click();
    await sKaupat
      .getByLabel("S-kaupat: paikkakunta tai kaupan nimi")
      .fill("Helsinki");
    await sKaupat.getByRole("button", { name: "Etsi", exact: true }).click();
    // Only this chain's stores are offered, and choosing one keeps K-Ruoka active.
    await expect(
      sKaupat.getByRole("button", { name: "K-Ruoka · Helsinki (fixture)" }),
    ).toHaveCount(0);
    await sKaupat
      .getByRole("button", { name: "S-kaupat · Helsinki (fixture)" })
      .click();
    await expect(sKaupat).toContainText("S-kaupat · Helsinki (fixture)");
    await expect(page.getByRole("listitem", { name: "K-Ruoka" })).toContainText(
      "Käytössä",
    );
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(bar).not.toContainText("Vertailua varten");
    await expect(
      bar.getByRole("button", { name: "Vertaa kauppoja" }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
