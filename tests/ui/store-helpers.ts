import { expect, type ElectronApplication, type Page } from "@playwright/test";

export async function fixtureTab(app: ElectronApplication, chain: string) {
  const find = () =>
    app.evaluate(({ webContents }, chain) => {
      const tab = webContents
        .getAllWebContents()
        .find(
          (contents) =>
            contents.getURL().startsWith("http://127.0.0.1:") &&
            new URL(contents.getURL()).pathname.startsWith(`/${chain}/`),
        );
      return tab ? { id: tab.id, url: tab.getURL() } : null;
    }, chain);
  await expect.poll(find).not.toBeNull();
  return (await find())!;
}

export async function completeFixtureLogin(
  app: ElectronApplication,
  page: Page,
  chain?: string,
  result: "kirjaudu" | "hylkaa" = "kirjaudu",
) {
  await expect(page.locator(".store-frame")).toBeVisible();
  chain ??= (await page.locator(".store-frame").getAttribute("data-chain"))!;
  const tab = await fixtureTab(app, chain);
  await expect
    .poll(() =>
      app.evaluate(
        ({ webContents }, id) => webContents.fromId(id)!.getURL(),
        tab.id,
      ),
    )
    .toContain("/kirjaudu");
  await app.evaluate(
    ({ webContents }, { id, result }) =>
      webContents
        .fromId(id)!
        .executeJavaScript(
          `document.querySelector('form[action="${result}"] button').click()`,
        ),
    { id: tab.id, result },
  );
  await expect
    .poll(() =>
      app.evaluate(
        ({ webContents }, id) =>
          webContents.fromId(id)!.executeJavaScript("document.body.innerText"),
        tab.id,
      ),
    )
    .toContain(
      result === "kirjaudu" ? "Kirjautunut" : "Kirjautuminen hylättiin",
    );
  const back = page.getByRole("button", { name: "Takaisin aloitukseen" });
  if (await back.isVisible()) await back.click();
  else
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
}
