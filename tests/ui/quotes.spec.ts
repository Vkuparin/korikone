import { test, expect, _electron as electron } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("view return and restart retain quotes without searches, while explicit edits refresh", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-quotes-ui-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const state = initialState();
  state.onboarded = true;
  state.setupComplete = true;
  state.staples = [];
  state.note = "Pasta";
  state.meals = [
    {
      id: "pasta-meal",
      recipeId: "pasta",
      day: 0,
      servings: 4,
      leftovers: false,
    },
  ];
  // An older profile has a list but has never saved a quote. No IPC handlers are replaced.
  const db = new DatabaseSync(join(env.KORIKONE_TEST_DATA, "korikone.sqlite"));
  db.exec(
    "CREATE TABLE documents (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;",
  );
  db.prepare("INSERT INTO documents VALUES (?,?)").run(
    "development:state",
    JSON.stringify(state),
  );
  db.close();
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    let load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    await expect(
      page.getByText("Ei hinnoiteltu", { exact: true }),
    ).toBeVisible();
    expect((await load()).developmentCatalogueRequests).toBe(0);
    await page
      .getByRole("button", { name: "Hae tuotteet ja hinnat", exact: true })
      .click();
    await expect(page.getByText(/Viimeksi haetut hinnat/)).toBeVisible();
    const priced = await load();
    expect(priced.developmentCatalogueRequests).toBe(2);
    const total = await page.locator(".total-line strong").textContent();
    await page.getByLabel("Mitä haluaisit valmistaa?").fill("Nakkikeitto");
    await page.getByRole("button", { name: "Reseptit", exact: true }).click();
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(page.getByLabel("Mitä haluaisit valmistaa?")).toHaveValue(
      "Nakkikeitto",
    );
    expect((await load()).developmentCatalogueRequests).toBe(2);
    expect((await load()).basket).toEqual(priced.basket);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    await expect(page.getByText(/Viimeksi haetut hinnat/)).toBeVisible();
    expect((await load()).developmentCatalogueRequests).toBe(0);
    expect((await load()).basket).toEqual(priced.basket);
    await expect(page.locator(".total-line strong")).toHaveText(total!);
    await page.getByLabel("Kieli", { exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.getByText(/Last quoted prices/)).toBeVisible();
    await page.evaluate(() => window.korikone.scenario("price"));
    await page.locator(".transfer-button").click();
    await expect(page.getByRole("alert")).toContainText(
      "Prices or availability changed",
    );
    expect((await load()).basket).toEqual(priced.basket);
    expect((await load()).review).toBeNull();
    expect((await load()).journal).toBeNull();
    await page.evaluate(() => window.korikone.scenario("price"));
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByText("Advanced settings", { exact: true }).click();
    const beforeSwitch = (await load()).developmentCatalogueRequests;
    await page.getByLabel("Store", { exact: true }).selectOption("demo-s");
    await expect
      .poll(async () => (await load()).state.context.providerId)
      .toBe("demo-s");
    await expect
      .poll(async () => (await load()).basket[0]?.product?.providerId)
      .toBe("demo-s");
    const switched = await load();
    expect(switched.developmentCatalogueRequests).toBe(beforeSwitch + 2);
    await page
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    expect((await load()).developmentCatalogueRequests).toBe(
      switched.developmentCatalogueRequests,
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByText("Advanced settings", { exact: true }).click();
    await page
      .getByRole("button", { name: "Continue with ChatGPT", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    const note = page.getByLabel("What would you like to cook?");
    await note.fill("Nakkikeitto");
    await note.press("Control+Enter");
    await expect
      .poll(async () => (await load()).state.note)
      .toBe("Nakkikeitto");
    await expect.poll(async () => (await load()).basket.length).toBe(3);
    expect((await load()).developmentCatalogueRequests).toBe(
      switched.developmentCatalogueRequests + 3,
    );
    expect((await load()).developmentRequests).toBe(1);
    await page.evaluate(() => window.korikone.scenario("catalogue"));
    await page
      .getByRole("button", { name: "Increase: Peruna", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not retrieve products and prices",
    );
    await expect(page.getByText("Not priced", { exact: true })).toBeVisible();
    expect((await load()).basket).toEqual([]);
    expect((await load()).state.quantities["potato:g"]).toBeGreaterThan(800);
    expect((await load()).developmentRequests).toBe(1);
    await page.evaluate(() => window.korikone.scenario("catalogue"));
    await page
      .getByRole("button", { name: "Get products and prices", exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/Last quoted prices/)).toBeVisible();
    expect((await load()).basket).toHaveLength(3);
  } finally {
    await app.close();
  }
});
