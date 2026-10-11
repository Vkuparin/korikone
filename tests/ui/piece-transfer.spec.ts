import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const chain of ["demo-k", "demo-s"] as const) {
  test(`${chain} piece estimates survive SQLite restart and transfer exact whole pieces once`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-pieces-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    let app = await electron.launch({ args: ["."], env });
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.context = { ...state.context, providerId: chain };
      state.extras = [
        { id: "banana", name: "Banaani", amount: 500, unit: "g" },
      ];
      await page.evaluate(async (state) => {
        const saved = await window.korikone.save(state);
        if (!saved.ok) throw new Error(saved.error);
        const built = await window.korikone.buildBasket();
        if (!built.ok) throw new Error(built.error);
      }, state);
      const pieces = chain === "demo-k" ? 3 : 4;
      const price = chain === "demo-k" ? /noin.*1,20/ : /noin.*2,00/;
      await page.reload();
      let row = page.locator(".grocery-row").filter({ hasText: "Banaani" });
      await expect(row.locator(".row-price")).toHaveText(price);
      await expect(row.locator(".piece-order-summary")).toContainText(
        `Tilataan ${pieces} kpl`,
      );
      await expect(row.locator(".quantity-control")).toContainText("500");
      await app.close();
      app = await electron.launch({ args: ["."], env });
      page = await app.firstWindow();
      row = page.locator(".grocery-row").filter({ hasText: "Banaani" });
      await expect(row.locator(".row-price")).toHaveText(price);
      await expect(row.locator(".piece-order-summary")).toContainText(
        `Tilataan ${pieces} kpl`,
      );
      const loaded = (await page.evaluate(() => window.korikone.load())).value;
      expect(loaded.developmentMode).toBe(true);
      expect(loaded.developmentRequests).toBe(0);
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
        expect.objectContaining({
          productId: "loose-banana",
          quantity: pieces,
          unit: "kpl",
        }),
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
}
