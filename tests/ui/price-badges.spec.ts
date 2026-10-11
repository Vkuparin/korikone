import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const language of ["fi", "en"] as const) {
  test(`campaign and independent history badges survive restart in ${language}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "korikone-price-badges-"));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = directory;
    env.KORIKONE_TEST_HIDDEN = "1";
    const launch = () => electron.launch({ args: ["."], env });
    let app = await launch();
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.onboarded = true;
      state.setupComplete = true;
      state.staples = [];
      state.meals = [];
      state.extras = [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }];
      state.context = {
        providerId: "s-kaupat",
        storeId: "demo-campaign",
        storeName: "Synthetic campaign store",
        fulfillment: "pickup",
      };
      const history = Array.from({ length: 4 }, (_, index) => ({
        productId: "campaign-milk",
        providerId: "s-kaupat",
        storeId: "demo-campaign",
        date: new Date(Date.now() - (index + 1) * 86_400_000)
          .toISOString()
          .slice(0, 10),
        price: 149,
        unitPrice: 0.149,
      }));
      const backup = join(directory, "synthetic-backup.json");
      await writeFile(
        backup,
        JSON.stringify({ ...state, priceHistory: history }),
      );
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, backup);
      await page.evaluate(async (language) => {
        const restored = await window.korikone.importData();
        if (!restored.ok) throw new Error(restored.error);
        await window.korikone.setLanguage(language);
        const priced = await window.korikone.buildBasket();
        if (!priced.ok) throw new Error(priced.error);
      }, language);
      await page.reload();
      await page.setViewportSize({ width: 800, height: 600 });
      const check = async () => {
        await expect(
          page
            .locator(".row-price-badges")
            .getByText(language === "fi" ? "Tarjous" : "Offer", {
              exact: true,
            }),
        ).toBeVisible();
        await expect(
          page
            .locator(".row-price-badges")
            .getByText(
              language === "fi"
                ? "Halvempi kuin yleensä"
                : "Cheaper than usual",
              { exact: true },
            ),
        ).toBeVisible();
        const snapshot = await page.evaluate(
          async () => (await window.korikone.load()).value,
        );
        expect(snapshot.basket[0].product?.price).toBe(109);
        expect(snapshot.developmentRequests).toBe(0);
        expect(snapshot.developmentStoreWrites).toBe(0);
      };
      await check();
      await page.screenshot({
        path: `test-results/price-badges-${language}.png`,
        fullPage: true,
      });
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await check();
      expect(
        (await page.evaluate(async () => (await window.korikone.load()).value))
          .developmentCatalogueRequests,
      ).toBe(0);
    } finally {
      await app.close();
    }
  });
}
