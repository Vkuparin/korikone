import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";

for (const language of ["fi", "en"] as const) {
  test(`History shows twelve weeks of actual spending with budget, unknowns and a text table in ${language}`, async () => {
    const fi = language === "fi";
    const tr = (a: string, b: string) => (fi ? a : b);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    const data = await mkdtemp(join(tmpdir(), "korikone-spending-"));
    env.KORIKONE_TEST_DATA = data;
    env.KORIKONE_TEST_HIDDEN = "1";
    // A receipt with a printed food and non-food breakdown, dated today.
    const today = new Date();
    const dated = fixtureText(
      receiptFixtures.find((f) => f.id === "s-non-food-subtotals")!,
    ).replace(
      "19.10.2026 11:30",
      `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()} 11:30`,
    );
    const file = join(data, "today.txt");
    await writeFile(file, dated, "utf8");
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      await page.evaluate(async (language) => {
        const api = window.korikone;
        await api.setLanguage(language);
        const state = (await api.load()).value.state;
        const saved = await api.save({
          ...state,
          context: {
            providerId: "demo-s",
            storeId: "demo-helsinki",
            storeName: "S-kaupat · Helsinki (demo)",
            fulfillment: "pickup",
          },
        });
        if (!saved.ok) throw new Error(saved.error);
        await api.scenario("history");
        const orders = await api.importOrders();
        if (!orders.ok) throw new Error(orders.error);
      }, language);
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, file);
      const imported = await page.evaluate(() =>
        window.korikone.importPurchaseReceipt(),
      );
      expect(imported.value.purchaseImport).toMatchObject({
        outcome: "added",
      });
      const before = await load();
      await page.reload();
      await page
        .getByRole("navigation")
        .getByRole("button", { name: tr("Historia", "History"), exact: true })
        .click();
      const chart = page.locator(".spending");
      await expect(chart).toBeVisible();
      await expect(chart.locator("svg[role=img]")).toHaveAttribute(
        "aria-label",
        /./,
      );
      // Twelve weeks, each with a row in the text table.
      await expect(chart.locator(".spending-table tbody tr")).toHaveCount(12);
      // Budget label from the household's weekly budget.
      await expect(chart.locator("svg")).toContainText(
        tr("Viikkobudjetti", "Weekly budget"),
      );
      // This week holds today's receipt with its printed total and breakdown.
      const current = chart.locator(".spending-table tbody tr").last();
      await expect(current).toContainText(/8[,.]93/);
      await expect(current).toContainText(/5[,.]68/);
      await expect(current).toContainText(/3[,.]25/);
      // Weeks of the weekly order sequence show order totals; the order without a date is apart.
      await expect(
        chart.locator('tr[data-coverage="complete"]').first(),
      ).toBeVisible();
      await expect(chart).toContainText(tr("Ilman päivämäärää", "Undated"));
      // Scope and the transfer caveat are stated, and no estimate column fabricates a value.
      await expect(chart).toContainText(
        tr("Toteutuneet ostot", "Actual purchases"),
      );
      await expect(chart).toContainText(
        tr("eivätkä ole ostoja", "are not purchases"),
      );
      await expect(
        chart.locator(".spending-table tbody tr td:last-child").first(),
      ).toHaveText("–");
      // Viewing it changes nothing and sends nothing.
      const after = await load();
      expect(after.state).toEqual(before.state);
      expect([after.developmentRequests, after.developmentStoreWrites]).toEqual(
        [0, 0],
      );
      // Narrow layout keeps the table readable without horizontal scrolling of the page.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
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
