import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("fixed pizza pieces use package steps, retain SQLite facts and transfer whole packages once", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-pizza-packages-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.staples = [];
    state.context = { ...state.context, providerId: "demo-s" };
    state.extras = [
      { id: "pizza", name: "Pakastepizza", amount: 5, unit: "pcs" },
    ];
    await page.evaluate(async (state) => {
      const saved = await window.korikone.save(state);
      if (!saved.ok) throw new Error(saved.error);
      const built = await window.korikone.buildBasket();
      if (!built.ok) throw new Error(built.error);
    }, state);
    await page.reload();
    const row = page
      .locator(".grocery-row")
      .filter({ hasText: "Pakastepizza" });
    await expect(row.locator(".quantity-control")).toContainText("5");
    await expect(row.locator(".row-price")).toHaveText(/12,95/);
    await row
      .getByRole("button", { name: "Lisää: Pakastepizza", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value.basket[0]
            ?.requirement.amount,
      )
      .toBe(6);
    await expect(row.locator(".quantity-control")).toContainText("6");
    await expect(row.locator(".row-price")).toHaveText(/15,54/);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const loaded = (await page.evaluate(() => window.korikone.load())).value;
    expect(loaded.basket[0]).toMatchObject({
      packs: 6,
      total: 1554,
      product: { packageContent: { count: 1, weightGrams: 350 } },
    });
    await page
      .getByRole("button", { name: /Siirrä ja avaa kaupan ostoskori/ })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value.journal
            ?.status,
      )
      .toBe("verified");
    const after = (await page.evaluate(() => window.korikone.load())).value;
    expect(after.journal!.review.targets).toEqual([
      expect.objectContaining({ productId: "pizza", quantity: 6, unit: "kpl" }),
    ]);
    expect(after.developmentStoreWrites).toBe(1);
    expect(after.developmentRequests).toBe(0);
    await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      const result = await window.korikone.transferDisplayed({
        revision: current.state.revision,
        quotedAt: current.quotedAt,
        batchKey: current.transferBatchKey,
      });
      if (!result.ok) throw new Error(result.error);
    });
    expect(
      (await page.evaluate(() => window.korikone.load())).value
        .developmentStoreWrites,
    ).toBe(1);
  } finally {
    await app.close();
  }
});
