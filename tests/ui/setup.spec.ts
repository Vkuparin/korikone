import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("guided setup allows manual planning and remembers completion", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-setup-"));
  let app = await electron.launch({ args: ["."], env });
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
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    await expect(
      page.getByText("Lisää valmiita reseptejä", { exact: true }),
    ).toBeVisible();
    await app.close();
    app = await electron.launch({ args: ["."], env });
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
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await page.getByRole("textbox").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "K-Ruoka · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Valitse toinen kauppa" }).click();
    await page
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
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
