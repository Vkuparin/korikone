import { settingsCategory } from "./settings-helper";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completeFixtureLogin, fixtureTab } from "./store-helpers";

const options = async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-chains-"));
  return {
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  };
};

test("the pinned hint and Settings set up the second chain; both session logins and stores survive restart", async () => {
  const launch = await options();
  let app = await electron.launch(launch);
  try {
    let page = await app.firstWindow();
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
    await expect(page.getByRole("listitem", { name: "S-kaupat" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await completeFixtureLogin(app, page, "k-ruoka");
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    const hint = page.getByRole("button", {
      name: "Vertaa S-kaupat: kirjaudu sisään",
    });
    await expect(hint).toBeVisible();
    await hint.focus();
    await page.keyboard.press("Enter");
    await settingsCategory(page, "stores", "Kaupat");
    const other = page.getByRole("listitem", { name: "S-kaupat" });
    await other
      .getByRole("button", { name: "S-kaupat: Valitse kauppa" })
      .click();
    await other
      .getByLabel("S-kaupat: paikkakunta tai kaupan nimi")
      .fill("Helsinki");
    await other.getByRole("button", { name: "Etsi", exact: true }).click();
    await other
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await other
      .getByRole("button", { name: "S-kaupat: Kirjaudu sisään" })
      .click();
    await completeFixtureLogin(app, page, "s-kaupat");
    for (const chain of ["K-Ruoka", "S-kaupat"])
      await expect(
        page.getByRole("listitem", { name: chain }).getByRole("status"),
      ).toHaveText("Kirjautunut");
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(hint).toHaveCount(0);
    const before = (
      await page.evaluate(async () => (await window.korikone.load()).value)
    ).state;
    await app.close();
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "stores", "Kaupat");
    for (const chain of ["K-Ruoka", "S-kaupat"])
      await expect(
        page.getByRole("listitem", { name: chain }).getByRole("status"),
      ).toHaveText("Kirjautunut");
    const after = (
      await page.evaluate(async () => (await window.korikone.load()).value)
    ).state;
    expect(after.stores).toEqual(before.stores);
    expect(after.context).toEqual(before.context);
  } finally {
    await app.close();
  }
});

for (const [chain, name] of [
  ["k-ruoka", "K-Ruoka"],
  ["s-kaupat", "S-kaupat"],
]) {
  test(`${name} rejects sign-in and detects an expired fixture session`, async () => {
    const app = await electron.launch(await options());
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Ota käyttöön", exact: true })
        .click();
      await page.getByRole("textbox").fill("Helsinki");
      await page.getByRole("button", { name: "Etsi", exact: true }).click();
      await page
        .getByRole("button", {
          name: `${name} · Helsinki (fixture)`,
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
      await completeFixtureLogin(app, page, chain, "hylkaa");
      expect(
        (await page.evaluate(async () => (await window.korikone.load()).value))
          .storeLogins[chain],
      ).toBe("notStarted");
      await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
      await completeFixtureLogin(app, page, chain);
      await page.getByRole("button", { name: "Valmis", exact: true }).click();
      await page.getByRole("button", { name: "Kauppa", exact: true }).click();
      const tab = await fixtureTab(app, chain);
      await app.evaluate(
        ({ webContents }, id) =>
          webContents
            .fromId(id)!
            .executeJavaScript(
              'document.querySelector("form[action=vanhenna] button").click()',
            ),
        tab.id,
      );
      await expect
        .poll(() =>
          app.evaluate(
            ({ webContents }, id) => webContents.fromId(id)!.getURL(),
            tab.id,
          ),
        )
        .toContain("/vanhenna");
      await page
        .getByRole("button", { name: "Asetukset", exact: true })
        .click();
      await settingsCategory(page, "stores", "Kaupat");
      await expect(
        page.getByRole("listitem", { name }).getByRole("status"),
      ).toHaveText("Ei yhdistetty");
      expect(
        (await page.evaluate(async () => (await window.korikone.load()).value))
          .developmentRequests,
      ).toBe(0);
    } finally {
      await app.close();
    }
  });
}
