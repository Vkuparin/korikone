import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

async function launch(dir?: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = dir ?? (await mkdtemp(join(tmpdir(), "korikone-inline-")));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  return { app, data, page: await app.firstWindow() };
}

const rows = [
  { id: "milk", name: "Maito", amount: 2000, unit: "ml" },
  { id: "pasta", name: "Pasta", amount: 500, unit: "g" },
  { id: "unknown", name: "Tuntematon ruoka", amount: 1, unit: "pcs" },
];

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`the transfer shows its counts beside the button and sends in one click, with the review only when switched on in ${language}`, async () => {
    const { app, page } = await launch();
    try {
      await page
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await page.evaluate(
        async ({ rows, language }) => {
          const api = window.korikone;
          await api.setLanguage(language);
          let saved = { ok: false, error: "draftStale" } as Awaited<
            ReturnType<typeof api.save>
          >;
          for (let i = 0; i < 20 && !saved.ok; i++) {
            const state = (await api.load()).value.state;
            saved = await api.save({
              ...state,
              staples: [],
              household: { ...state.household, budget: 1 },
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

      // Before the click: product and pack counts, the row left out and the budget, in place.
      const summary = page.locator(".transfer-summary");
      await expect(summary).toBeVisible();
      await expect(summary).toContainText(
        tr("2 tuotetta siirretään", "2 products will be sent"),
      );
      await expect(summary).toContainText(
        tr("1 riviä jää pois", "1 rows are left out"),
      );
      await expect(summary).toContainText("Tuntematon ruoka");
      await expect(summary).toContainText(
        tr("ylittää viikkobudjetin", "over the weekly budget"),
      );
      // Narrow width keeps it reachable without horizontal page scroll.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      await expect(summary).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);

      // Default: one click, no confirmation dialog, the result next to the list.
      await page.locator(".transfer-button").click();
      await expect
        .poll(async () => (await load()).journal?.status, { timeout: 20000 })
        .toBe("verified");
      const sent = await load();
      expect(sent.transferException).toBeNull();
      expect(sent.review ?? null).toBeNull();
      expect(sent.developmentStoreWrites).toBe(2);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.locator(".transfer-summary")).toHaveCount(0);

      // With the review switched on in Settings, the next transfer waits for its confirmation.
      await page
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(page, "advanced", tr("Lisäasetukset", "Advanced"));
      const toggle = page.getByLabel(
        tr("Tarkista ennen siirtoa", "Review before transfer"),
      );
      await expect(toggle).not.toBeChecked();
      await toggle.click();
      await expect(toggle).toBeChecked();
      expect((await load()).state.reviewBeforeTransfer).toBe(true);
      expect((await load()).developmentRequests).toBe(0);

      // A different list now stops for the review in the same place; nothing is written yet.
      const writes = (await load()).developmentStoreWrites;
      await page.evaluate(async () => {
        const api = window.korikone;
        const state = (await api.load()).value.state;
        const saved = await api.save({
          ...state,
          extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
        });
        if (!saved.ok) throw new Error(saved.error);
        await api.buildBasket();
      });
      await page.reload();
      await page
        .getByRole("button", {
          name: tr("Ostoslista", "Shopping list"),
          exact: true,
        })
        .click();
      // The first result panel is closed to make way for the next list's button.
      const close = page.getByRole("button", {
        name: tr("Sulje", "Close"),
        exact: true,
      });
      if (await close.count()) await close.first().click();
      await page.locator(".transfer-button").click();
      await expect(
        page.getByRole("region", {
          name: tr("Siirron vahvistus", "Transfer confirmation"),
        }),
      ).toBeVisible({ timeout: 20000 });
      expect((await load()).developmentStoreWrites).toBe(writes);
    } finally {
      await app.close();
    }
  });

  test(`the review setting is off by default, persists, travels in a backup and switches off again in ${language}`, async () => {
    const { app, data, page } = await launch();
    let current = app;
    let view = page;
    try {
      await view
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await view.evaluate(
        (language) => window.korikone.setLanguage(language),
        language,
      );
      const load = async () =>
        (await view.evaluate(() => window.korikone.load())).value;
      // The empty week prices itself after setup; wait so the quote is settled.
      await expect.poll(async () => (await load()).quotedAt).not.toBeNull();
      const before = await load();
      expect(before.state.reviewBeforeTransfer).toBe(false);
      const toggle = async (enabled: boolean) => {
        const r = await view.evaluate(
          (enabled) => window.korikone.setReviewBeforeTransfer({ enabled }),
          enabled,
        );
        expect(r.ok).toBe(true);
      };
      await toggle(true);
      const on = await load();
      // The setting changes neither the list nor any quote, and makes no request.
      expect(on.state.revision).toBe(before.state.revision);
      expect(on.quotedAt).toBe(before.quotedAt);
      expect([on.developmentRequests, on.developmentStoreWrites]).toEqual([
        0, 0,
      ]);

      // Restart keeps it.
      await current.close();
      ({ app: current, page: view } = await launch(data));
      expect((await load()).state.reviewBeforeTransfer).toBe(true);

      // A backup carries it.
      const file = join(data, "backup.json");
      await current.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: path,
        });
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, file);
      await view.evaluate(() => window.korikone.exportData());
      expect(await readFile(file, "utf8")).toContain("reviewBeforeTransfer");

      // Switching it off restores the two-action flow.
      await toggle(false);
      expect((await load()).state.reviewBeforeTransfer).toBe(false);
      await view.evaluate(() => window.korikone.importData());
      expect((await load()).state.reviewBeforeTransfer).toBe(true);
    } finally {
      await current.close();
    }
  });
}
