import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-links-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  return { app, data, page: await app.firstWindow() };
}

/** A verified transfer of four groceries and a receipt that shares only two of them. */
async function setup(language: "fi" | "en") {
  const { app, data, page } = await launch();
  await page
    .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
    .click();
  const transferred = await page.evaluate(async (language) => {
    const api = window.korikone;
    await api.setLanguage(language);
    const state = (await api.load()).value.state;
    const saved = await api.save({
      ...state,
      staples: [],
      meals: [],
      household: { ...state.household, budget: 1_000_000 },
      extras: [
        { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
        { id: "ruisleipä", name: "Ruisleipä", amount: 500, unit: "g" },
        { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
        { id: "pasta", name: "Pasta", amount: 500, unit: "g" },
        { id: "mince", name: "Jauheliha", amount: 400, unit: "g" },
        { id: "onion", name: "Sipuli", amount: 500, unit: "g" },
      ],
    });
    if (!saved.ok) throw new Error(saved.error);
    const built = (await api.buildBasket()).value;
    const requested = await api.transferDisplayed({
      revision: built.state.revision,
      quotedAt: built.quotedAt,
      batchKey: built.transferBatchKey,
    });
    if (!requested.ok) throw new Error(requested.error);
    const review = requested.value.review;
    const done = review
      ? await api.execute({ id: review.id, acknowledged: true })
      : requested;
    if (!done.ok) throw new Error(done.error);
    return done.value.state.listHistory[0].transferred.map(
      (t: { name: string }) => t.name,
    );
  }, language);
  expect(transferred.length).toBeGreaterThanOrEqual(4);
  // Today's receipt names two of the transferred products and two others.
  const now = new Date();
  const date = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  // Half of the transferred products, rounded up, appear on the receipt: a weak match.
  const shared = transferred.slice(0, Math.ceil(transferred.length / 2));
  const prices = shared.map((_, i) => 119 + i * 110);
  const money = (cents: number) =>
    `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
  const total = prices.reduce((sum, p) => sum + p, 0) + 350 + 210;
  const lines = [
    "K-Market Esimerkki",
    "Näytekuja 2, 00200 Helsinki",
    `${date} 12:00  Kuitti 99  Kassa 1`,
    ...shared.map(
      (name, i) => `${name.toUpperCase().padEnd(28)} ${money(prices[i])}`,
    ),
    "KUKKAKAALI                   3,50",
    "PAPRIKA PUNAINEN             2,10",
    `Yhteensä                      ${money(total)}`,
  ];
  const file = join(data, "partial.txt");
  await writeFile(file, lines.join("\n"), "utf8");
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, file);
  const imported = await page.evaluate(() =>
    window.korikone.importPurchaseReceipt(),
  );
  expect(imported.value.purchaseImport).toMatchObject({ outcome: "added" });
  return { app, page };
}

for (const language of ["fi", "en"] as const) {
  test(`a half match is offered for review, never merged by a guess, and the answer is kept in ${language}`, async () => {
    const fi = language === "fi";
    const tr = (a: string, b: string) => (fi ? a : b);
    const { app, page } = await setup(language);
    try {
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      // The old half-the-items rule would have confirmed this; it is only a review candidate.
      expect((await load()).purchaseSignals).toEqual([
        expect.objectContaining({ strength: "review" }),
      ]);
      await page.reload();
      await page
        .getByRole("navigation")
        .getByRole("button", { name: tr("Historia", "History"), exact: true })
        .click();
      const review = page.locator(".link-review");
      await expect(review).toBeVisible();
      await expect(review.locator(".link-candidate")).toHaveCount(1);
      await expect(review).toContainText(
        tr("tuotetta vastaa", "products match"),
      );
      await expect(page.locator(".transfer-signal").first()).toContainText(
        tr("odottaa vahvistustasi", "waiting for your answer"),
      );
      // Showing the question confirmed nothing and made no request.
      const staples = (await load()).state.staples;
      expect((await load()).developmentRequests).toBe(0);

      await review
        .getByRole("button", {
          name: tr("Eri ostos", "Different purchase"),
          exact: true,
        })
        .click();
      await expect(page.locator(".link-review")).toHaveCount(0);
      const rejected = await load();
      expect(rejected.purchaseSignals).toEqual([]);
      expect(rejected.state.staples).toEqual(staples);
      await expect(page.locator(".transfer-signal").first()).toContainText(
        tr("ei vielä vahvistettu ostos", "not a confirmed purchase"),
      );
      // The answer is kept: the same pair is not offered again.
      await page.reload();
      await page
        .getByRole("navigation")
        .getByRole("button", { name: tr("Historia", "History"), exact: true })
        .click();
      await expect(page.locator(".link-review")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}

test("the shopper can confirm a half match, which then counts once", async () => {
  const { app, page } = await setup("fi");
  try {
    await page.reload();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Historia", exact: true })
      .click();
    await page
      .locator(".link-review")
      .getByRole("button", { name: "Sama ostos", exact: true })
      .click();
    await expect(page.locator(".link-review")).toHaveCount(0);
    await expect(page.locator(".transfer-signal").first()).toContainText(
      "vahvistettu ostetuksi",
    );
    const after = (
      await page.evaluate(() => window.korikone.purchaseInsights())
    ).value as unknown as {
      insights: { actualPurchases: { total: number }[] };
    };
    // One actual purchase from the receipt; the transfer adds none.
    expect(after.insights.actualPurchases).toHaveLength(1);
    expect(after.insights.actualPurchases[0].total).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
