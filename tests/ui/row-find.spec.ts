import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rows = [
  { id: "unknown", name: "Tuntematon ruoka", amount: 400, unit: "g" },
  { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
  { id: "pasta", name: "Pasta", amount: 500, unit: "g" },
];

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`an unresolved row is recovered with the explicit Find product action, and an empty result is explained in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-find-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await page.evaluate(
        async ({ rows, language }) => {
          const api = window.korikone;
          await api.setLanguage(language);
          await api.signInAI();
          let saved = { ok: false, error: "draftStale" } as Awaited<
            ReturnType<typeof api.save>
          >;
          for (let i = 0; i < 20 && !saved.ok; i++) {
            const state = (await api.load()).value.state;
            saved = await api.save({
              ...state,
              staples: [],
              extras: rows as typeof state.extras,
            });
          }
          if (!saved.ok) throw new Error(saved.error);
        },
        { rows, language },
      );
      await page.reload();
      const load = async () =>
        (await page.evaluate(() => window.korikone.load())).value;
      const row = page.locator('[data-row-key="unknown:g"]');
      await expect(row).toHaveClass(/unresolved/);
      // The other rows have a product and no Find action.
      await expect(
        page.getByRole("button", {
          name: `${tr("Etsi tuote", "Find a product")}: Maito`,
        }),
      ).toHaveCount(0);
      const before = await load();
      const milkBefore = before.basket.find((l) => l.requirement.id === "milk");

      const opener = page.getByRole("button", {
        name: `${tr("Etsi tuote", "Find a product")}: Tuntematon ruoka`,
      });
      await opener.click();
      const form = page.getByRole("form", {
        name: new RegExp(
          `^${tr("Etsi tuote riville", "Find a product for the row")}`,
        ),
      });
      await expect(form).toBeVisible();
      // The row context is shown and typing alone searches nothing.
      await expect(form).toContainText("Tuntematon ruoka");
      await expect(form).toContainText("400 g");
      const field = form.getByLabel(
        tr("Tuotteen nimi, merkki tai tyyppi", "Product name, brand or type"),
      );
      await expect(field).toBeFocused();
      await field.pressSequentially("Zzzxx qqqq", { delay: 5 });
      expect((await load()).developmentRequests).toBe(
        before.developmentRequests,
      );

      // An empty candidate result keeps the row, its amount and the form, and says what to do.
      await form.getByRole("button", { name: tr("Etsi", "Find") }).click();
      await expect(form.getByRole("alert")).toContainText(
        tr("ei löytynyt sopivaa tuotetta", "No suitable product was found"),
      );
      await expect(row).toHaveClass(/unresolved/);
      const empty = await load();
      expect(empty.state.extras).toEqual(before.state.extras);
      expect(empty.basket.find((l) => l.requirement.id === "milk")).toEqual(
        milkBefore,
      );
      expect(empty.state.categoryPreferences).toEqual(
        before.state.categoryPreferences,
      );

      // A usable wording resolves the row; amount and the other rows are preserved.
      await field.fill("Kanan jauheliha");
      await form.getByRole("button", { name: tr("Etsi", "Find") }).click();
      await expect(form).toHaveCount(0);
      await expect(row).not.toHaveClass(/unresolved/);
      await expect(row.locator(".row-name")).toBeFocused();
      const after = await load();
      expect(after.state.specifications).toEqual({
        "unknown:g": "Kanan jauheliha",
      });
      expect(after.state.extras).toEqual(before.state.extras);
      expect(after.state.categoryPreferences).toEqual(
        before.state.categoryPreferences,
      );
      expect(after.basket.find((l) => l.requirement.id === "milk")).toEqual(
        milkBefore,
      );
      expect(after.developmentStoreWrites).toBe(0);
      // The Find action is gone once the row has a product.
      await expect(opener).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}
