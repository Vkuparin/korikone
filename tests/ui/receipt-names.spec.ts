import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

const receipt = [
  "S-market Esimerkki",
  "Testikatu 1, 00100 Helsinki",
  "14.10.2026 10:05  Kassa 2  Kuitti 0500",
  "--------------------------------",
  "VALIO JOG 1KG                2,49",
  "PIRKKA KEVYTM 1L             1,19",
  "RAINBOW RASVATON MAITO 1L    1,29",
  "--------------------------------",
  "YHTEENSÄ                     4,97",
].join("\n");

async function launch(data: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  return electron.launch({ args: ["."], env });
}

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`an imported receipt shows readable names without a review list, corrects one chosen row inline and keeps preferences in ${language}`, async () => {
    const data = await mkdtemp(join(tmpdir(), "korikone-names-"));
    const file = join(data, "names.txt");
    await writeFile(file, receipt, "utf8");
    let app = await launch(data);
    try {
      let page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      await page.evaluate(
        (language) => window.korikone.setLanguage(language),
        language,
      );
      await page.reload();
      const load = async () =>
        (await page.evaluate(() => window.korikone.load())).value;
      await expect.poll(async () => (await load()).quotedAt).not.toBeNull();
      const before = await load();
      const open = async () => {
        await page
          .getByRole("button", {
            name: tr("Asetukset", "Settings"),
            exact: true,
          })
          .click();
        await settingsCategory(page, "data", tr("Tiedot", "Data"));
      };
      await open();
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, file);
      await page
        .getByRole("button", {
          name: tr(
            "Tuo kuitti (PDF, teksti tai CSV)",
            "Import receipt (PDF, text or CSV)",
          ),
          exact: true,
        })
        .click();
      const card = page.locator(".receipt-card");
      await expect(card).toHaveCount(1);
      // Collapsed after an ordinary import; no model-only or name warning in the summary.
      await expect(card).not.toHaveJSProperty("open", true);
      const summary = card.locator(":scope > summary");
      await expect(summary).toContainText(tr("Summa täsmää", "Total matches"));
      await expect(summary).not.toContainText(tr("huomioitavaa", "to check"));
      await expect(page.locator(".receipt-review")).toHaveCount(0);
      expect((await load()).developmentRequests).toBe(0);

      // Opened with the keyboard: readable names first, printed rows only on request.
      await summary.focus();
      await page.keyboard.press("Enter");
      const names = card.locator(".receipt-name");
      await expect(names).toHaveText([
        "Valio jogurtti 1 kg",
        "PIRKKA KEVYTM 1L",
        "Rainbow rasvaton maito 1 l",
      ]);
      await expect(card.locator(".receipt-printed")).toHaveCount(0);
      await card
        .getByLabel(
          tr("Näytä kuittiin painetut rivit", "Show the printed rows"),
        )
        .check();
      await expect(card.locator(".receipt-printed").first()).toContainText(
        "VALIO JOG 1KG",
      );

      // The evidence, retention and deletion are optional details with accurate copy.
      await card.locator(".receipt-more summary").click();
      await expect(card.locator(".receipt-retention")).toContainText(
        tr("PDF-tiedostoa", "PDF file"),
      );

      // Correct one chosen row inline; Escape closes it and focus returns to the control.
      const row = card.locator("tr", { hasText: "PIRKKA KEVYTM 1L" });
      const opener = row.getByRole("button", {
        name: new RegExp(`^${tr("Korjaa rivi", "Correct row")}`),
      });
      await opener.focus();
      await page.keyboard.press("Enter");
      const group = row.getByRole("group", {
        name: new RegExp(`^${tr("Korjaa rivi", "Correct row")}`),
      });
      await expect(group).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(group).toHaveCount(0);
      await expect(opener).toBeFocused();
      await opener.click();
      await group
        .getByLabel(tr("Mitä tämä on", "What this is"))
        .fill("Kevytmaito");
      await group
        .getByRole("button", {
          name: tr("Tallenna nimi", "Save name"),
          exact: true,
        })
        .click();
      await expect(row.locator(".receipt-name")).toHaveText("Kevytmaito");
      await expect(opener).toBeFocused();

      // Nothing about preferences, the list or requests changed.
      const after = await load();
      expect(after.state.categoryPreferences).toEqual(
        before.state.categoryPreferences,
      );
      expect(after.state.extras).toEqual(before.state.extras);
      expect(after.developmentRequests).toBe(0);
      expect(after.developmentStoreWrites).toBe(0);

      // Narrow and dark layouts stay usable without horizontal scrolling.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      await page.emulateMedia({ colorScheme: "dark" });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.emulateMedia({ colorScheme: "light" });

      // The names and the correction survive a restart.
      await app.close();
      app = await launch(data);
      page = await app.firstWindow();
      await open();
      const restarted = page.locator(".receipt-card");
      await restarted.locator(":scope > summary").click();
      await expect(restarted.locator(".receipt-name")).toHaveText([
        "Valio jogurtti 1 kg",
        "Kevytmaito",
        "Rainbow rasvaton maito 1 l",
      ]);
    } finally {
      await app.close();
    }
  });
}
