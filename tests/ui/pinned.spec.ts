import { completeFixtureLogin } from "./store-helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the total and transfer bar stay in view while the list scrolls", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-pinned-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1100, 800),
    );
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await page.getByRole("textbox").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await completeFixtureLogin(app, page);
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect(
      page.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Makaronilaatikko");
    await note.press("Control+Enter");
    const list = page.getByRole("complementary");
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(
      "Ostoslista · 7",
      { timeout: 15000 },
    );
    const bar = list.getByRole("region", { name: "Yhteensä ja siirto" });
    const transfer = bar.getByRole("button", {
      name: /^Siirrä ja avaa S-kaupat-lista · 7 tuotetta · \d+,\d\d €$/,
    });
    const inView = async () => {
      const box = (await transfer.boundingBox())!;
      const height = await page.evaluate(() => window.innerHeight);
      return box.y >= 0 && box.y + box.height <= height;
    };
    // Rows scroll independently; the footer occupies a separate fixed space.
    const rows = list.locator(".shopping-rows");
    expect(await rows.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    await expect.poll(inView).toBe(true);
    await rows.evaluate((el) => el.scrollTo(0, el.scrollHeight / 2));
    await expect.poll(inView).toBe(true);
    // Scrolling the note column scrolls the page; the list column stays put.
    for (const y of [0, 10000]) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await expect.poll(inView).toBe(true);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "test-results/pinned.png" });
    // A short window uses normal flow when the footer would crowd the rows.
    await page.setViewportSize({ width: 1100, height: 600 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(list).toHaveAttribute("data-flow", "true");
    await transfer.scrollIntoViewIfNeeded();
    await transfer.focus();
    await expect(transfer).toBeFocused();
    await expect.poll(inView).toBe(true);
  } finally {
    await app.close();
  }
});
