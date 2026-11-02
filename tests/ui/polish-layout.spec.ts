import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

for (const language of ["fi", "en"] as const) {
  test(`small layout fixes: price time, day headings and Advanced settings in ${language} (B6.7)`, async () => {
    const fi = language === "fi";
    const tr = (a: string, b: string) => (fi ? a : b);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-polish-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      await page.evaluate(
        (language) => window.korikone.setLanguage(language),
        language,
      );
      await page.reload();
      const nav = (name: string) =>
        page
          .getByRole("navigation")
          .first()
          .getByRole("button", { name, exact: true });

      // The price time shows hours and minutes, no seconds.
      const quoted = page.getByText(
        new RegExp(tr("Viimeksi haetut hinnat", "Last quoted prices")),
      );
      await expect(quoted).toBeVisible({ timeout: 15000 });
      // The time follows "klo" in Finnish and the comma in English: hours and minutes only.
      expect(await quoted.textContent()).toMatch(
        /(klo |, )\d{1,2}[.:]\d{2}(?![.:]\d)/,
      );

      // A day heading names the day, not "on Sunday".
      await nav(tr("Viikkosuunnitelma", "Meal schedule")).click();
      const heading = page.locator(".calendar-day h2").first();
      await expect(heading).toBeVisible();
      if (fi)
        await expect(heading).toHaveText(
          /^(Maanantai|Tiistai|Keskiviikko|Torstai|Perjantai|Lauantai|Sunnuntai) \d{1,2}\.\d{1,2}\.$/,
        );

      // Advanced settings: each checkbox sits beside its label, and no backup is offered
      // while no product type is remembered.
      await nav(tr("Asetukset", "Settings")).click();
      await settingsCategory(page, "advanced", tr("Lisäasetukset", "Advanced"));
      for (const name of [
        tr("Tarkista ennen siirtoa", "Review before transfer"),
      ]) {
        const box = page.getByRole("checkbox", { name, exact: true });
        const label = page.locator("label", { has: box });
        const [input, text] = await label.evaluate((el) => {
          const control = el.querySelector("input")!.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const all = [...range.getClientRects()].filter(
            (r) => r.left > control.right,
          );
          return [control, all[0] ?? control].map((r) => ({
            top: r.top,
            bottom: r.bottom,
          }));
        });
        // The text's first line overlaps the checkbox vertically: one line, not stacked.
        expect(text.top).toBeLessThan(input.bottom);
        expect(text.bottom).toBeGreaterThan(input.top);
      }
      await expect(
        page.getByRole("button", {
          name: tr(
            "Tallenna varmuuskopio ennen muutoksia",
            "Save a backup before changes",
          ),
        }),
      ).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}
