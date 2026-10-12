import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function start(language: "fi" | "en") {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-suggest-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await page
    .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
    .click();
  await page.evaluate(async (language) => {
    const api = window.korikone;
    await api.setLanguage(language);
    const state = (await api.load()).value.state;
    // The S-kaupat sample store has the development order history.
    const saved = await api.save({
      ...state,
      context: {
        providerId: "demo-s",
        storeId: "demo-helsinki",
        storeName: "S-kaupat · Helsinki (demo)",
        fulfillment: "pickup",
      },
      staples: [],
      extras: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
    });
    if (!saved.ok) throw new Error(saved.error);
  }, language);
  await page.reload();
  return { app, page };
}

for (const language of ["fi", "en"] as const) {
  test(`history suggestions show their evidence, add nothing by themselves and can be accepted or dismissed in ${language}`, async () => {
    const fi = language === "fi";
    const tr = (a: string, b: string) => (fi ? a : b);
    const { app, page } = await start(language);
    try {
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const before = await load();
      // Two visits, no history at all: nothing is suggested.
      await expect(page.locator(".suggestions")).toHaveCount(0);

      await page.evaluate(async () => {
        await window.korikone.scenario("history");
        const imported = await window.korikone.importOrders();
        if (!imported.ok) throw new Error(imported.error);
      });
      await page.reload();
      const section = page.locator(".suggestions");
      await expect(section).toBeVisible();
      await expect(section.locator(".suggestion")).toHaveCount(1);
      const card = section.locator(".suggestion").first();
      await expect(card).toContainText(/Kevytmaito/i);
      await expect(card).toContainText(
        tr("viikolla viimeisestä kahdeksasta", "of the last 8 weeks"),
      );
      await expect(card).toContainText(
        tr("Tyypillinen määrä: 2 kpl", "Typical quantity: 2 pcs"),
      );
      // Nothing was added, asked or sent by showing it.
      const shown = await load();
      expect(shown.state.staples).toEqual(before.state.staples);
      expect(shown.state.extras).toEqual(before.state.extras);
      expect([shown.developmentRequests, shown.developmentStoreWrites]).toEqual(
        [0, 0],
      );

      // Dismissal is explicit and stays dismissed after a reload.
      await card
        .getByRole("button", { name: tr("Ei nyt", "Not now"), exact: true })
        .click();
      await expect(page.locator(".suggestions")).toHaveCount(0);
      await page.reload();
      await expect(page.locator(".suggestions")).toHaveCount(0);
      expect((await load()).state.staples).toEqual(before.state.staples);
    } finally {
      await app.close();
    }
  });
}

test("accepting a suggestion is the explicit recurring-item save with the shopper's amount", async () => {
  const { app, page } = await start("fi");
  try {
    await page.evaluate(async () => {
      await window.korikone.scenario("history");
      const imported = await window.korikone.importOrders();
      if (!imported.ok) throw new Error(imported.error);
    });
    await page.reload();
    const card = page.locator(".suggestion").first();
    await expect(card).toBeVisible();
    await card.getByLabel("Määrä").fill("3");
    await card
      .getByRole("button", { name: "Lisää vakiotuotteeksi", exact: true })
      .click();
    await expect(page.locator(".suggestion")).toHaveCount(0);
    const after = (await page.evaluate(() => window.korikone.load())).value;
    expect(after.state.staples).toHaveLength(1);
    expect(after.state.staples[0]).toMatchObject({
      amount: 3,
      unit: "pcs",
      enabled: true,
      lastPurchased: null,
    });
    expect(after.state.staples[0].everyDays).toBeGreaterThanOrEqual(1);
    expect(after.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
