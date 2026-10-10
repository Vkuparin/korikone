import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("manual query miss uses bounded aliases and keeps quoted rows and evidence after restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-candidates-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    state.meals = [];
    await page.evaluate((state) => window.korikone.save(state), state);
    await page.reload();
    await page.getByLabel("Lisää tuote", { exact: true }).fill("Sipulia");
    await page.getByLabel("Tuotteen määrä").fill("0,4");
    await page.getByLabel("Tuotteen yksikkö").selectOption("kg");
    await page
      .getByRole("button", { name: "Lisää tuote listaan", exact: true })
      .click();
    const row = page.locator(".grocery-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Kotimaista sipuli 500 g");
    await expect(row).toContainText("400 g");
    const saved = (await page.evaluate(() => window.korikone.load())).value!;
    expect(saved.developmentCatalogueRequests).toBe(2);
    expect(saved.developmentRequests).toBe(0);
    expect(saved.basket[0].product?.evidence).toMatchObject({
      category: "onion",
      family: "onion",
    });
    await row
      .getByRole("button", { name: "Kotimaista sipuli 500 g", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Tiedot: Sipulia" }),
    ).toContainText("Ostetaan: 1 pakkaus, 500 g");
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(page.locator(".grocery-row")).toContainText(
      "Kotimaista sipuli 500 g",
    );
    const restored = (await page.evaluate(() => window.korikone.load())).value!;
    expect(restored.basket).toEqual(saved.basket);
    expect(restored.developmentCatalogueRequests).toBe(0);
    expect(restored.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
