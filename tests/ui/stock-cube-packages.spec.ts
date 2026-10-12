import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
test("cube count confirmation is explicit, local, retained and displayed in individual cubes", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-stock-cubes-"),
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
      { id: "cube", name: "Knorr Lihaliemikuutio", amount: 2, unit: "pcs" },
    ];
    await page.evaluate(async (state) => {
      const saved = await window.korikone.save(state);
      if (!saved.ok) throw new Error(saved.error);
      const result = await window.korikone.buildBasket();
      if (!result.ok) throw new Error(result.error);
    }, state);
    await page.reload();
    let row = page.locator(".grocery-row");
    await row.locator(".row-name").click();
    await expect(row.locator(".row-details")).toContainText("12 kpl");
    await expect(row.locator(".row-details")).toContainText("10 kpl");
    await page.evaluate(async () => {
      const state = (await window.korikone.load()).value.state;
      const saved = await window.korikone.save({
        ...state,
        extras: [
          { id: "cube", name: "Testi Lihaliemikuutio", amount: 2, unit: "pcs" },
        ],
      });
      if (!saved.ok) throw new Error(saved.error);
      const built = await window.korikone.buildBasket();
      if (!built.ok) throw new Error(built.error);
    });
    await page.reload();
    row = page.locator(".grocery-row");
    await row.locator(".row-name").click();
    const form = row.locator(".pack-size");
    await expect(form).toContainText("Vahvista kuutioiden määrä pakkauksessa");
    await expect(form.locator("input")).toHaveValue("");
    await expect(form.locator("select")).toHaveValue("pcs");
    await expect(form.locator("select")).toBeDisabled();
    expect(
      (await page.evaluate(() => window.korikone.load())).value.basket[0]
        .product,
    ).toBeNull();
    await form.locator("input").fill("12");
    await form.getByRole("button", { name: "Vahvista pakkauskoko" }).click();
    await expect(row.locator(".row-price")).toHaveText(/3,09/);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const loaded = (await page.evaluate(() => window.korikone.load())).value;
    expect(loaded.state.packSizes["stock-cube-unconfirmed"]).toEqual({
      amount: 12,
      unit: "pcs",
    });
    expect(loaded.basket[0]).toMatchObject({
      packs: 1,
      total: 309,
      product: { packAmount: 12, unit: "pcs" },
    });
    expect(loaded.developmentRequests).toBe(0);
    await page.locator(".grocery-row .row-name").click();
    await expect(page.locator(".row-details")).toContainText("12 kpl");
    await expect(page.locator(".pack-size input")).toHaveValue("12");
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
    expect(after.journal!.review.targets[0]).toMatchObject({
      productId: "stock-cube-unconfirmed",
      quantity: 1,
      unit: "kpl",
    });
    expect(after.developmentStoreWrites).toBe(1);
    expect(after.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
