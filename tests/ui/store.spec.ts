import { completeFixtureLogin } from "./store-helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the store cart opens in the Kauppa tab, which stays sandboxed and inside the app", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-store-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
  // The store tab's page, seen from the main process.
  const store = () =>
    app.evaluate(({ webContents }) => {
      const tab = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith("http://127.0.0.1"));
      return tab ? { id: tab.id, url: tab.getURL() } : null;
    });
  const run = (id: number, script: string) =>
    app.evaluate(
      ({ webContents }, { id, script }) =>
        webContents.fromId(id)!.executeJavaScript(script),
      { id, script },
    );
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
    const bar = page
      .getByRole("complementary")
      .getByRole("region", { name: "Yhteensä ja siirto" });
    await bar
      .getByRole("button", { name: /^Siirrä ja avaa S-kaupat-lista/ })
      .click({ timeout: 15000 });
    // The Kauppa view shows the "Korikone" list where the transfer went, with the site's own
    // add-all button scrolled into view and not pressed.
    await expect(
      page.getByRole("button", { name: "Kauppa", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("tab", { name: "S-kaupat", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => (await store())?.url)
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s-kaupat\/ostoslistat\/lista-1$/);
    const tab = (await store())!;
    expect(await run(tab.id, "document.title")).toBe(
      "S-kaupat (fixture): Lista",
    );
    await expect
      .poll(() => run(tab.id, "window.scrollY"))
      .toBeGreaterThan(1000);
    expect(
      await run(
        tab.id,
        `document.querySelector("button[data-test-id=addAllToCart]").getBoundingClientRect().top < window.innerHeight`,
      ),
    ).toBe(true);

    // Store pages get no Korikone bridge and no Node.
    expect(await run(tab.id, "typeof window.korikone")).toBe("undefined");
    expect(await run(tab.id, "typeof require")).toBe("undefined");

    // A popup opens in the same tab, not as a new window.
    const windows = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    await run(tab.id, `document.querySelector('a[target="_blank"]').click()`);
    await expect.poll(async () => (await store())?.url).toMatch(/\/ikkuna$/);
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(windows);

    // Sign-in on the fixture site is kept in the tab's session.
    await run(tab.id, `location.href = "kirjaudu"`);
    await expect.poll(async () => (await store())?.url).toMatch(/\/kirjaudu$/);
    await run(tab.id, `document.querySelector("form").submit()`);
    await expect
      .poll(() => run(tab.id, "document.body.innerText"))
      .toContain("Kirjautunut");

    // Development mode never reaches the real stores.
    for (const url of [
      "https://www.s-kaupat.fi/",
      "https://www.k-ruoka.fi/kauppa/ostoskori",
    ])
      expect(
        await app.evaluate(
          async ({ webContents }, { id, url }) =>
            webContents
              .fromId(id)!
              .loadURL(url)
              .then(
                () => "loaded",
                (error: Error) => error.message,
              ),
          { id: tab.id, url },
        ),
      ).toContain("ERR_BLOCKED_BY_CLIENT");

    // Leaving the Kauppa view takes the site off the window, and the navigation leads back.
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].contentView.children.length,
      ),
    ).toBe(1);
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].contentView.children.length,
        ),
      )
      .toBe(0);
    const back = page.getByRole("button", { name: "Kauppa S-kaupat · palaa" });
    await expect(back).toBeVisible();
    await back.click();
    await expect(
      page.getByRole("tab", { name: "S-kaupat", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].contentView.children.length,
        ),
      )
      .toBe(1);
  } finally {
    await app.close();
  }
});
