import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { layoutFindings } from "./overlap-helper";

test("Store Back follows the store page's own history, says when there is none, and the list is one click away", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-store-back-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const tabs = () =>
    app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((c) => c.getURL().startsWith("http://127.0.0.1"))
        .map((c) => ({ id: c.id, url: c.getURL() })),
    );
  const tab = async (chain: string) => {
    await expect
      .poll(async () =>
        (await tabs()).some((t) =>
          new URL(t.url).pathname.startsWith(`/${chain}/`),
        ),
      )
      .toBe(true);
    return (await tabs()).find((t) =>
      new URL(t.url).pathname.startsWith(`/${chain}/`),
    )!;
  };
  const path = async (id: number) =>
    new URL((await tabs()).find((t) => t.id === id)!.url).pathname;
  // A navigation the shopper makes in the store page. A script-started one without a click is
  // not a history entry in Chromium, so the page is loaded the way a followed link is.
  const visit = (id: number, relative: string) =>
    app.evaluate(
      ({ webContents }, { id, relative }) => {
        const contents = webContents.fromId(id)!;
        return contents.loadURL(new URL(relative, contents.getURL()).href);
      },
      { id, relative },
    );
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 800, height: 600 });
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    // Both chains get a fixture store and a list long enough to scroll.
    await page.evaluate(async () => {
      const api = window.korikone;
      const search = (await api.searchStores("Helsinki")).value;
      const k = search.storeResults.find((c) => c.providerId === "k-ruoka")!;
      const s = search.storeResults.find((c) => c.providerId === "s-kaupat")!;
      const first = await api.changeContext({
        context: k,
        revision: search.state.revision,
      });
      const second = await api.changeContext({
        context: s,
        revision: first.value.state.revision,
      });
      if (!first.ok || !second.ok) throw new Error("context");
    });
    await page.reload();
    await expect(page.locator(".grocery-row").first()).toBeVisible();
    const before = (await page.evaluate(() => window.korikone.load())).value;
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
    const scrolled = await page.evaluate(() => scrollY);

    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^Kauppa/ })
      .click();
    for (const [chain, name] of [
      ["s-kaupat", "S-kaupat"],
      ["k-ruoka", "K-Ruoka"],
    ] as const) {
      await page.getByRole("tab", { name, exact: true }).click();
      const store = await tab(chain);
      const back = page.locator('[data-store-action="back"]');
      const help = page.locator("#store-back-help");
      // Opened directly: the store page has no earlier page, and Back says so instead of
      // looking usable.
      await expect(back).toHaveText(`← Edellinen sivu (${name})`);
      await expect(back).toBeDisabled();
      await expect(help).toHaveText(
        "Kaupan sivustolla ei ole aiempaa sivua tässä näkymässä.",
      );

      // The shopper moves on in the store: history exists and Back becomes available.
      await visit(store.id, "tuote");
      await expect.poll(() => path(store.id)).toBe(`/${chain}/tuote`);
      await expect(back).toBeEnabled();
      await expect(help).toContainText("Ei poistu Kauppa-näkymästä");
      await visit(store.id, "ostoskori");
      await expect.poll(() => path(store.id)).toBe(`/${chain}/ostoskori`);

      // A reload keeps the history.
      await page.getByRole("button", { name: "Lataa uudelleen" }).click();
      await expect.poll(() => path(store.id)).toBe(`/${chain}/ostoskori`);
      await expect(back).toBeEnabled();

      // Back walks the store's pages, stays in the Store view, and is exhausted at the first.
      await back.click();
      await expect.poll(() => path(store.id)).toBe(`/${chain}/tuote`);
      await expect(back).toBeEnabled();
      await expect(page.locator(".store-frame")).toBeVisible();
      await back.click();
      await expect.poll(() => path(store.id)).toBe(`/${chain}/`);
      await expect(back).toBeDisabled();
      await expect(page.locator(".store-frame")).toBeVisible();
    }

    // The toolbar's controls keep their own room at this narrow width.
    expect(
      (await layoutFindings(page)).filter((f) =>
        /store-toolbar|data-store|tablist/.test(
          `${f.element} ${f.other ?? ""}`,
        ),
      ),
    ).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Korikone's own way back is separate, visible and returns to the same place in the list.
    const toList = page.locator('[data-store-return="list"]');
    await expect(toList).toHaveText("Palaa ostoslistaan");
    await toList.click();
    await expect(page.locator(".grocery-row").first()).toBeVisible();
    await expect(
      page.getByRole("navigation").getByRole("button", {
        name: "Ostoslista",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrolled);
    const after = (await page.evaluate(() => window.korikone.load())).value;
    expect(after.state).toEqual(before.state);
    expect(after.basket).toEqual(before.basket);
    expect([
      after.developmentRequests,
      after.developmentStoreWrites,
      after.developmentCatalogueRequests,
    ]).toEqual([
      before.developmentRequests,
      before.developmentStoreWrites,
      before.developmentCatalogueRequests,
    ]);
  } finally {
    await app.close();
  }
});
