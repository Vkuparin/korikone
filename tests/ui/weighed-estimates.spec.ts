import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("weighed estimates show split totals, requested mass and survive restart without transfer", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-weighed-estimate-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.staples = [];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.signInAI();
      const reply = await window.korikone.planShopping({
        prompt: "500 g omenaa ja 1 l maitoa",
        consent: true,
      });
      if (!reply.ok) throw new Error(reply.error);
      const saved = await window.korikone.commitPlanning({
        operationId: reply.value.planning!.operationId,
      });
      if (!saved.ok) throw new Error(saved.error);
    }, state);
    await page.reload();
    const apple = page.locator(".grocery-row").filter({ hasText: "Omena" });
    await expect(apple.locator(".row-price")).toHaveText(/noin.*1,25/);
    await expect(apple.locator(".quantity-control")).toContainText("500");
    await expect(apple.locator(".quantity-control")).toContainText("g");
    await expect(page.locator(".shopping-total .total-line strong")).toHaveText(
      /1,19.*\+.*noin.*1,25/,
    );
    await expect(
      page.getByText("Punnittavien tuotteiden hinnat ovat arvioita.", {
        exact: false,
      }),
    ).toBeVisible();
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(page.locator(".shopping-total .total-line strong")).toHaveText(
      /1,19.*\+.*noin.*1,25/,
    );
    const result = await page.evaluate(() => window.korikone.prepare());
    expect(result).toEqual({ ok: false, error: "unresolved" });
    await page
      .getByRole("button", { name: /Siirrä ja avaa kaupan ostoskori/ })
      .click();
    await expect(
      page.getByRole("region", { name: "Siirron vahvistus" }),
    ).toContainText("Omena");
    expect(
      (await page.evaluate(() => window.korikone.load())).value
        .developmentStoreWrites,
    ).toBe(0);
  } finally {
    await app.close();
  }
});
