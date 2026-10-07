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
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env });
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
    await page
      .getByRole("button", { name: "Review products", exact: true })
      .click();
    for (let i = 0; i < 6; i++) {
      const article = page
        .locator("article")
        .filter({ has: page.locator(".warning") })
        .first();
      if (await article.count())
        await article
          .getByRole("button", { name: "Choose this product" })
          .first()
          .click();
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
    await page.screenshot({ path: "test-results/basket.png", fullPage: true });
    expect(
      await page.evaluate(() => ({
        node: typeof (window as any).require,
        process: typeof (window as any).process,
      })),
    ).toEqual({ node: "undefined", process: "undefined" });
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Tomaattipasta" }),
    ).toBeVisible();
    await expect(page.getByLabel("Language", { exact: true })).toHaveValue(
      "en",
    );
    await page.screenshot({ path: "test-results/week.png", fullPage: true });
  } finally {
    await app.close();
  }
});
