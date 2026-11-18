import { settingsCategory } from "./settings-helper";
import { completeFixtureLogin } from "./store-helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const launch = (env: Record<string, string>) =>
  electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });

test("guided setup allows manual planning and remembers completion", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-setup-"));
  let app = await launch(env);
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    // One screen: every action is inside a 1280 × 800 window without scrolling.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 800),
    );
    await expect(
      page.getByRole("heading", { name: "Missä teet ruokaostokset?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Apua aterioiden suunnitteluun" }),
    ).toBeVisible();
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    for (const control of [
      page.getByRole("button", { name: "Etsi", exact: true }),
      page.getByRole("button", { name: "Continue with ChatGPT" }),
      page.getByRole("button", { name: "Valmis", exact: true }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    }
    expect(
      await page
        .getByRole("heading", { name: "Aloitetaan" })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeLessThanOrEqual(32);
    await page.screenshot({ path: "test-results/setup-v050.png" });
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    await expect(
      page.getByText("Lisää valmiita reseptejä", { exact: true }),
    ).toBeVisible();
    // Development mode can show the setup screen again without a fresh data folder.
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "advanced", "Lisäasetukset");
    await page
      .getByRole("button", { name: "Näytä aloitusnäyttö uudelleen" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Missä teet ruokaostokset?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Missä teet ruokaostokset?" }),
    ).toBeHidden();
    await app.close();
    app = await launch(env);
    await expect(
      (await app.firstWindow()).getByText("Lisää valmiita reseptejä", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("setup can change branch and detects completed sign-in without a check button", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-setup-connected-"),
  );
  const app = await launch(env);
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    const field = page.getByRole("textbox");
    await field.fill("no-results");
    await field.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Kauppoja ei löytynyt" }),
    ).toBeVisible();
    await field.fill("search-error");
    await field.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Haku epäonnistui" }),
    ).toBeVisible();
    await field.fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "K-Ruoka · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Valitse toinen kauppa" }).click();
    await expect(field).toHaveValue("Helsinki");
    await field.fill("alternate");
    await expect(
      page.getByRole("button", { name: "S-kaupat · Helsinki (fixture)" }),
    ).toHaveCount(0);
    await field.fill("Helsinki");
    await page
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await completeFixtureLogin(app, page);
    await expect(
      page
        .getByRole("region", { name: "Missä teet ruokaostokset?" })
        .getByRole("status")
        .first(),
    ).toHaveText("Kirjautunut", { timeout: 10000 });
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect(
      page.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    await expect(page.locator(".context")).toContainText(
      "S-kaupat · Helsinki (fixture)",
    );
    await expect(page.getByLabel("Mitä haluaisit valmistaa?")).toBeEnabled();
    await expect(page.locator('select[name="model"]')).not.toBeVisible();
  } finally {
    await app.close();
  }
});

test("a first-time shopper can try a note, connect and create a priced list without leaving it", async () => {
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  const app = await electron.launch({
    args: ["."],
    env: {
      ...env,
      KORIKONE_TEST_HIDDEN: "1",
      KORIKONE_TEST_DATA: await mkdtemp(join(tmpdir(), "korikone-first-note-")),
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("Kieli", { exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    const start = page.getByRole("button", {
      name: "Start with an empty week",
    });
    await expect(start).toHaveAccessibleDescription(/Add groceries by hand/);
    await start.click();
    const note = page.locator("#shopping-note");
    await expect(note).toBeFocused();
    await page.getByRole("button", { name: "Add a grocery by hand" }).click();
    await expect(page.getByLabel("Add grocery", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Try an example note" }).click();
    await expect(note).toBeFocused();
    const example = await note.inputValue();
    expect(example).toContain("Tomato pasta");
    await page
      .getByRole("button", { name: "Connect ChatGPT", exact: true })
      .click();
    const create = page.getByRole("button", {
      name: "Create my shopping list",
    });
    await expect(create).toBeEnabled();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue(example);
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    expect((await load()).developmentRequests).toBe(0);
    await expect(page.locator(".grocery-row")).toHaveCount(0);
    await create.click();
    const edit = page.getByRole("button", { name: "Try an example edit" });
    await expect(edit).toBeEnabled();
    const first = await load();
    expect(first.state.note).toBe(example);
    expect(first.basket.length).toBeGreaterThan(0);
    expect(first.basket.every((row) => row.product && row.total !== null)).toBe(
      true,
    );
    await edit.click();
    await expect(note).toHaveValue("Add 1 l of milk");
    expect((await load()).developmentRequests).toBe(first.developmentRequests);
    await note.press("Control+Enter");
    await expect
      .poll(async () =>
        (await load()).basket.some(
          (row) =>
            row.requirement.name === "Maito" && row.requirement.amount === 1000,
        ),
      )
      .toBe(true);
    expect((await load()).developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});
