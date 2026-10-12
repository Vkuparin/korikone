import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeFixtureLogin } from "./store-helpers";

test("order import API needs a sign-in, keeps evidence out of the shopping state and repeats safely", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-order-import-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    // Signed out: refused before any read.
    const refused = await page.evaluate(() => window.korikone.importOrders());
    expect(refused).toMatchObject({ ok: false, error: "ordersUnavailable" });

    await page.evaluate(async () => {
      const api = window.korikone;
      const search = (await api.searchStores("Helsinki")).value;
      const s = search.storeResults.find((c) => c.providerId === "s-kaupat")!;
      const changed = await api.changeContext({
        context: s,
        revision: search.state.revision,
      });
      if (!changed.ok) throw new Error(changed.error);
    });
    await page.reload();
    await page.evaluate(() => window.korikone.loginStore("s-kaupat"));
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^Kauppa/ })
      .click();
    await completeFixtureLogin(app, page, "s-kaupat");
    await expect
      .poll(async () =>
        page.evaluate(
          async () =>
            (await window.korikone.checkStoreLogin("s-kaupat")).value
              .storeLogins["s-kaupat"],
        ),
      )
      .toBe("signedIn");

    const before = (await page.evaluate(() => window.korikone.load())).value;
    const first = await page.evaluate(() => window.korikone.importOrders());
    expect(first.ok).toBe(true);
    expect(first.value.purchaseImport).toEqual({
      source: "orders",
      added: 4,
      updated: 0,
      duplicate: 0,
    });
    // Purchases are not shopping state: the list, quote and revision are untouched.
    expect(first.value.state).toEqual(before.state);
    expect(first.value.basket).toEqual(before.basket);
    expect(first.value.developmentStoreWrites).toBe(0);
    expect(first.value.developmentRequests).toBe(0);
    expect(first.value.developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
    const again = await page.evaluate(() => window.korikone.importOrders());
    expect(again.value.purchaseImport).toEqual({
      source: "orders",
      added: 0,
      updated: 0,
      duplicate: 4,
    });

    // The backup carries the sanitized records and no order identifier.
    const backup = join(data, "backup.json");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, backup);
    await page.evaluate(() => window.korikone.exportData());
    const saved = JSON.parse(await readFile(backup, "utf8"));
    expect(
      saved.purchases.events.map((e: { status: string }) => e.status),
    ).toEqual(["completed", "pending", "cancelled", "completed"]);
    expect(saved.purchases.consent).toEqual({ automatic: null, asked: false });
    expect(JSON.stringify(saved)).not.toContain("fixture-order");

    // After a restart the same orders are still duplicates.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await page.evaluate(() => window.korikone.checkStoreLogin("s-kaupat"));
    const restarted = await page.evaluate(() => window.korikone.importOrders());
    expect(restarted.value.purchaseImport).toMatchObject({
      added: 0,
      duplicate: 4,
    });
  } finally {
    await app.close();
  }
});
