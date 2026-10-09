import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("plan, localize, review, recover and persist in the desktop app", async () => {
  const data = await mkdtemp(join(tmpdir(), "korikone-test-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    KORIKONE_TEST_DATA: data,
    KORIKONE_TEST_HIDDEN: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = {
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  };
  let app = await electron.launch(launchOptions);
  try {
    let page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Mitä tällä viikolla syödään?" }),
    ).toBeVisible();
    await page.getByLabel("Kieli", { exact: true }).selectOption("en");
    await page.getByRole("button", { name: "Try the example" }).click();
    await expect(
      page.getByRole("heading", { name: "Tomaattipasta" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Basket", exact: true }).click();
    await page
      .getByRole("button", { name: "Review products", exact: true })
      .click();
    await expect(page.locator("article")).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      const article = page
        .locator("article")
        .filter({ has: page.locator(".warning") })
        .first();
      const missing = page
        .locator("article")
        .filter({ has: page.locator(".warning") });
      const count = await missing.count();
      if (count) {
        await article
          .getByRole("button", { name: "Choose this product" })
          .first()
          .click();
        await expect(missing).toHaveCount(count - 1);
      }
    }
    await page.getByText("Demo", { exact: true }).click();
    await page
      .getByRole("button", { name: "Demo: interrupt next transfer" })
      .click();
    await page
      .getByRole("button", { name: "Review cart changes", exact: true })
      .click();
    await expect(
      page.getByText("In cart: 1 → After transfer: 2 kpl"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Transfer to cart", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Transfer interrupted" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Check cart and review remaining changes" })
      .click();
    await page
      .getByRole("button", { name: "Transfer to cart", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Cart updated and verified" }),
    ).toBeVisible();
    // Visual capture is covered by the source build. A packaged hidden window
    // may not produce compositor frames even when DOM interaction works.
    if (!process.env.KORIKONE_EXECUTABLE)
      await page.screenshot({ path: "test-results/basket.png" });
    expect(
      await page.evaluate(() => ({
        node: typeof (window as any).require,
        process: typeof (window as any).process,
      })),
    ).toEqual({ node: "undefined", process: "undefined" });
    await app.close();
    app = await electron.launch(launchOptions);
    page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Tomaattipasta" }),
    ).toBeVisible();
    await expect(page.getByLabel("Language", { exact: true })).toHaveValue(
      "en",
    );
    if (!process.env.KORIKONE_EXECUTABLE)
      await page.screenshot({ path: "test-results/week.png" });
  } finally {
    await app.close();
  }
});
