import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { settingsCategory } from "./settings-helper";

for (const language of ["fi", "en"] as const) {
  test(`the comparison names what it needs, Stores settings cannot switch chain silently and the way back to the store is offered in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-access-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const fi = language === "fi";
      const tr = (a: string, b: string) => (fi ? a : b);
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const nav = (name: string | RegExp) =>
        page.getByRole("navigation").getByRole("button", { name });

      for (const [active, other, activeName, otherName] of [
        ["k-ruoka", "s-kaupat", "K-Ruoka", "S-kaupat"],
        ["s-kaupat", "k-ruoka", "S-kaupat", "K-Ruoka"],
      ] as const) {
        // Only the active chain has a store; a list gives the total region something to show.
        await page.evaluate(
          async ({ active, language }) => {
            const api = window.korikone;
            await api.setLanguage(language);
            const search = (await api.searchStores("Helsinki")).value;
            const store = search.storeResults.find(
              (c) => c.providerId === active,
            )!;
            const changed = await api.changeContext({
              context: store,
              revision: search.state.revision,
            });
            if (!changed.ok) throw new Error(changed.error);
            const state = changed.value.state;
            const saved = await api.save({
              ...state,
              staples: [],
              stores: Object.fromEntries(
                Object.entries(state.stores).filter(([id]) => id === active),
              ),
              meals: [],
              extras: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
            });
            if (!saved.ok) throw new Error(saved.error);
          },
          { active, language },
        );
        await page.reload();
        await nav(tr("Ostoslista", "Shopping list")).click();
        const before = await load();
        const hint = page.locator(".compare-hint button");
        await expect(hint).toHaveText(
          tr(
            `Vertailu: valitse kauppa ketjulle ${otherName}`,
            `Compare: choose a ${otherName} store`,
          ),
        );

        // The prerequisite is actionable by keyboard and opens the Stores settings.
        await hint.focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("heading", {
            name: tr("Kauppaketjut", "Store chains"),
          }),
        ).toBeVisible();
        await expect(
          page.getByText(
            tr(
              "Etsi K-Ruoka- tai S-kaupat-kauppa",
              "Search for a K-Ruoka or S-kaupat store",
            ),
          ),
        ).toHaveCount(0);

        // Choosing the other chain's store changes only its own remembered store.
        const picked = await page.evaluate(async (other) => {
          const api = window.korikone;
          const search = (await api.searchStores("alternate")).value;
          const store = search.storeResults.find(
            (c) => c.providerId === other,
          )!;
          const current = (await api.load()).value.state;
          const saved = await api.save({
            ...current,
            stores: { ...current.stores, [other]: store },
          });
          return {
            ok: saved.ok,
            active: saved.value.state.context.providerId,
          };
        }, other);
        expect(picked).toEqual({ ok: true, active });
        await page.reload();
        await nav(tr("Ostoslista", "Shopping list")).click();
        await expect(hint).toHaveText(
          tr(
            `Vertailu: kirjaudu sisään ketjuun ${activeName}`,
            `Compare: sign in to ${activeName}`,
          ),
        );
        const after = await load();
        expect(after.state.context.providerId).toBe(active);
        expect(after.developmentRequests).toBe(before.developmentRequests);
      }

      // A sign-in that opens the store tab keeps a way back in Settings and the navigation.
      await nav(tr("Asetukset", "Settings")).click();
      await settingsCategory(page, "stores", tr("Kaupat", "Stores"));
      await page
        .getByRole("button", {
          name: new RegExp(`^S-kaupat: .*(${tr("Kirjaudu", "Sign in")})`, "i"),
        })
        .first()
        .click();
      await expect(page.locator(".store-frame")).toBeVisible({
        timeout: 15000,
      });
      await nav(tr("Asetukset", "Settings")).click();
      await expect(nav(/S-kaupat/)).toContainText(tr("palaa", "return"));
      await settingsCategory(page, "stores", tr("Kaupat", "Stores"));
      await page
        .getByRole("button", { name: tr("Palaa kauppaan", "Return to store") })
        .click();
      await expect(page.locator(".store-frame")).toBeVisible();
      const end = await load();
      expect(end.developmentStoreWrites).toBe(0);
      expect(end.state.context.providerId).toBe("s-kaupat");

      // Narrow width keeps the prerequisite and the way back reachable.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      await nav(tr("Ostoslista", "Shopping list")).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
}
