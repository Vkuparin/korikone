import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

const text = [
  "S-market Esimerkki",
  "Testikatu 1, 00100 Helsinki",
  "14.10.2026 10:05  Kassa 2  Kuitti 0500",
  "--------------------------------",
  "KEVYTMAITO 1L                1,19",
  "PIRKKA BANAANI               1,42",
  "VALIO JOG 1KG                2,49",
  "--------------------------------",
  "YHTEENSÄ                     5,10",
].join("\n");

async function start(data: string, language: "fi" | "en") {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  const example = page.getByRole("button", {
    name: "Kokeile esimerkkiä",
    exact: true,
  });
  await example.or(page.getByRole("navigation").first()).first().waitFor();
  if (await example.count()) await example.click();
  await page.evaluate(async (language) => {
    await window.korikone.setLanguage(language);
    await window.korikone.signInAI();
  }, language);
  await page.reload();
  return { app, page };
}
const load = (page: Page) =>
  page.evaluate(async () => (await window.korikone.load()).value);

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const nav = (page: Page, name: string) =>
    page
      .getByRole("navigation")
      .first()
      .getByRole("button", { name, exact: true });

  test(`names read honestly in the import summary and the purchase memory, tentative when only a model read them, and survive restart and deletion in ${language}`, async () => {
    const data = await mkdtemp(join(tmpdir(), "korikone-views-"));
    const file = join(data, "r.txt");
    await writeFile(file, text, "utf8");
    let { app, page } = await start(data, language);
    try {
      await expect.poll(async () => (await load(page)).quotedAt).not.toBeNull();
      const before = await load(page);
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, file);
      await nav(page, tr("Historia", "History")).click();
      await page
        .getByRole("button", {
          name: tr("Tuo kuitteja", "Import receipts"),
          exact: true,
        })
        .click();
      const surface = page.getByRole("region", {
        name: tr("Kuittien tuonti", "Receipt import"),
      });
      // The summary says how the names read, never that everything was identified.
      await expect(surface.locator(".receipt-intake-names")).toContainText(
        tr("luettavaa", "readable"),
      );
      await expect(surface).not.toContainText(
        tr("kaikki tunnistettu", "all identified"),
      );
      // One-time permission names the rows; the model's reading is tentative.
      await surface
        .getByRole("button", {
          name: tr("Vain tämä tuonti", "Just this import"),
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await load(page)).developmentRequests)
        .toBe(1);

      await page
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(page, "data", tr("Tiedot", "Data"));
      let memory = page.getByRole("region", {
        name: tr("Ostohistoriasta opittu", "Learned from purchases"),
      });
      await expect(memory).toBeVisible();
      await expect(memory.locator("li").first()).toContainText(
        tr("ostoa", "purchases"),
      );
      // Each alias says how its printed names read.
      await expect(memory).toContainText(
        tr("painettua nimeä", "printed names in receipts"),
      );
      const tentative = memory.locator('li[data-reason="model-only"]');
      await expect(tentative.first()).toContainText(
        tr("tentatiivinen", "tentative"),
      );

      // Restart keeps what was learned; the shopping workspace was never touched.
      await app.close();
      ({ app, page } = await start(data, language));
      await page
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(page, "data", tr("Tiedot", "Data"));
      memory = page.getByRole("region", {
        name: tr("Ostohistoriasta opittu", "Learned from purchases"),
      });
      await expect(memory).toBeVisible();
      const after = await load(page);
      expect(after.state.extras).toEqual(before.state.extras);
      expect(after.state.categoryPreferences).toEqual(
        before.state.categoryPreferences,
      );

      // Narrow and dark.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      await page.emulateMedia({ colorScheme: "dark" });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);

      // Forgetting interpretations removes the learned view at once; the receipts stay.
      await memory
        .getByRole("button", {
          name: tr(
            "Unohda kaikki tulkinnat (kuitit säilyvät)",
            "Forget all interpretations (receipts are kept)",
          ),
        })
        .click();
      await expect(memory).toHaveCount(0);
      const listed = (
        (await page.evaluate(() => window.korikone.listPurchases()))
          .value as unknown as { receipts: { purchases: unknown[] } }
      ).receipts;
      expect(listed.purchases).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
}
