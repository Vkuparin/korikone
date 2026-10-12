import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

/** Representative Shopping and Settings views for the owner's visual check; nothing is asserted
 * beyond the page being laid out, because the colour contracts have their own checks. */
test("captures Shopping and Stores settings for both chains, themes and sizes", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-capture-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    for (const chain of ["k-ruoka", "s-kaupat"] as const) {
      await page.evaluate(async (chain) => {
        const api = window.korikone;
        const search = (await api.searchStores("Helsinki")).value;
        const store = search.storeResults.find((c) => c.providerId === chain)!;
        const changed = await api.changeContext({
          context: store,
          revision: search.state.revision,
        });
        if (!changed.ok) throw new Error(changed.error);
        await api.save({
          ...changed.value.state,
          extras: [
            { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
            { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
          ],
        });
      }, chain);
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate(
          (theme) => window.korikone.setAppearance(theme),
          theme,
        );
        for (const [width, height] of [
          [1280, 800],
          [800, 700],
        ]) {
          await app.evaluate(
            ({ BrowserWindow }, [w, h]) =>
              BrowserWindow.getAllWindows()[0].setSize(w, h),
            [width, height],
          );
          await page.reload();
          const name = `chain-${chain}-${theme}-${width}`;
          await page.screenshot({
            path: `test-results/captures/${name}-shopping.png`,
            fullPage: true,
          });
          await page
            .getByRole("button", { name: "Asetukset", exact: true })
            .click();
          await settingsCategory(page, "stores", "Kaupat");
          await page.screenshot({
            path: `test-results/captures/${name}-settings.png`,
            fullPage: true,
          });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page
            .getByRole("button", { name: "Ostoslista", exact: true })
            .click();
        }
      }
    }
  } finally {
    await app.close();
  }
});
