import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeFixtureLogin } from "./store-helpers";

for (const from of ["store", "transfer result", "history"] as const)
  test(`mark an order from the ${from}, find it in history and start the next list`, async () => {
    const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
    const app = await electron.launch({
      args: ["."],
      env: {
        ...env,
        KORIKONE_TEST_HIDDEN: "1",
        KORIKONE_TEST_DATA: await mkdtemp(join(tmpdir(), "korikone-checkout-")),
      },
    });
    try {
      const page = await app.firstWindow();
      const button = (name: string) =>
        page.getByRole("button", { name, exact: true });
      const load = async () =>
        (await page.evaluate(() => window.korikone.load())).value;
      const fi = from === "store";
      if (fi) {
        await button("Ota käyttöön").click();
        await page.getByRole("textbox").fill("Helsinki");
        await button("Etsi").click();
        await button("S-kaupat · Helsinki (fixture)").click();
        await button("Kirjaudu kauppaan").click();
        await completeFixtureLogin(app, page, "s-kaupat");
        await button("Valmis").click();
      } else {
        await page.getByLabel("Kieli", { exact: true }).click();
        await page
          .getByRole("option", { name: "English", exact: true })
          .click();
        await button("Start with an empty week").click();
      }
      await page
        .getByLabel(fi ? "Lisää tuote" : "Add grocery", { exact: true })
        .fill("Maito");
      await page
        .getByLabel(fi ? "Tuotteen yksikkö" : "Grocery unit")
        .selectOption("l");
      await button(fi ? "Lisää tuote listaan" : "Add grocery to list").click();
      await page.locator(".transfer-button").click();
      if (from === "history") {
        await expect(page.locator(".transfer-result")).toBeVisible();
        await button("History").click();
      }
      const source =
        from === "history"
          ? page.getByRole("article")
          : page.locator(fi ? ".store-handoff" : ".transfer-result");
      const mark = source.getByRole("button", {
        name: fi ? "Merkitse tilaus tehdyksi" : "Mark order as placed",
      });
      await expect(mark).toBeEnabled();
      const before = await load();
      expect(before.state.listHistory[0].orderPlacedAt).toBeNull();
      await mark.click();
      const id = before.state.listHistory[0].id;
      const heading = page.locator(`[id="order-history-${id}"]`);
      await expect(heading).toBeFocused();
      const card = page.getByRole("article").filter({ has: heading });
      const status = fi ? "Tilaus merkitty tehdyksi" : "Order marked as placed";
      await expect(card).toContainText(status);
      if (from === "store") {
        await page
          .getByRole("navigation")
          .getByRole("button", { name: /^Kauppa/ })
          .click();
        await source
          .getByRole("button", { name: "Näytä tilaus historiassa" })
          .click();
        await expect(heading).toBeFocused();
        await page.setViewportSize({ width: 800, height: 600 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await card
        .locator("summary")
        .filter({ hasText: fi ? "Siirretyt tuotteet" : "Transferred products" })
        .click();
      await expect(
        card.getByRole("listitem").filter({ hasText: /maito/i }).first(),
      ).toBeVisible();
      const next = card.getByRole("button", {
        name: fi
          ? "Aloita seuraava ostoslista"
          : "Start the next shopping list",
      });
      await next.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: fi ? "Peruuta" : "Cancel", exact: true })
        .click();
      await expect(heading).toBeFocused();
      expect((await load()).state.extras).toEqual(before.state.extras);
      await next.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", {
          name: fi ? "Aloita uusi lista" : "Start new list",
          exact: true,
        })
        .click();
      await expect(page.locator("#shopping-note")).toBeFocused();
      await expect(page.locator(".grocery-row")).toHaveCount(0);
      await button(fi ? "Historia" : "History").click();
      await expect(card).toContainText(status);
      await expect(next).toHaveCount(0);
      const after = await load();
      expect(after.state.listHistory).toMatchObject([
        { id, orderPlacedAt: expect.any(String) },
      ]);
      expect(after.developmentRequests).toBe(before.developmentRequests);
      expect(after.developmentStoreWrites).toBe(before.developmentStoreWrites);
      expect(after.developmentCatalogueRequests).toBe(
        before.developmentCatalogueRequests,
      );
    } finally {
      await app.close();
    }
  });
