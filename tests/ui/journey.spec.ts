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
    const list = page.getByRole("complementary");
    // Rows without a product are resolved from their details.
    const needing = list.locator(".grocery-row", {
      hasText: "Needs a product",
    });
    for (let i = 0; i < 6 && (await needing.count()); i++) {
      const count = await needing.count();
      const row = needing.first();
      await row.locator(".row-name").click();
      await row
        .getByRole("button", { name: /^Choose this product: / })
        .and(page.locator(":enabled"))
        .first()
        .click();
      await expect(needing).toHaveCount(count - 1);
    }
    await list.getByText("Demo", { exact: true }).click();
    await list
      .getByRole("button", { name: "Demo: interrupt next transfer" })
      .click();
    const bar = list.getByRole("region", { name: "Total and transfer" });
    await bar.getByRole("button", { name: /^Transfer to store cart/ }).click();
    const panel = bar.getByRole("region", { name: "Transfer confirmation" });
    await expect(panel).toContainText(
      "Already in the cart: Pasta 500 g 1 → 2 kpl",
    );
    await panel.getByRole("button", { name: /^Confirm: / }).click();
    const result = bar.getByRole("region", { name: "Transfer result" });
    await expect(result.getByRole("status")).toHaveText("Transfer interrupted");
    await result
      .getByRole("button", { name: "Check cart and review remaining changes" })
      .click();
    await panel.getByRole("button", { name: /^Confirm: / }).click();
    await expect(result.getByRole("status")).toHaveText(
      "Cart updated and verified",
    );
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
