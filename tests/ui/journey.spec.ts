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
    // The meals render before pricing finishes. Wait for all quoted rows rather
    // than treating transient "Needs a product" labels as manual choices.
    await expect(list.locator(".grocery-row")).toHaveCount(6);
    await expect(list.locator(".grocery-row .row-name")).toHaveCount(6);
    await expect(
      list.locator(".grocery-row", { hasText: "Needs a product" }),
    ).toHaveCount(0);
    // The unavailable 1 kg carrot pack must use the available alternative.
    await expect(
      list.getByRole("button", { name: "Porkkana 500 g", exact: true }),
    ).toBeVisible();
    await list.getByText("Demo", { exact: true }).click();
    await list
      .getByRole("button", { name: "Demo: interrupt next transfer" })
      .click();
    const bar = list.getByRole("region", { name: "Total and transfer" });
    await bar
      .getByRole("button", { name: /^Transfer and open store basket/ })
      .click();
    const panel = bar.getByRole("region", { name: "Transfer confirmation" });
    await expect(panel).toContainText(
      "Already in the cart: Pasta 500 g 1 → 2 kpl",
    );
    await panel.getByRole("button", { name: /^Confirm: / }).click();
    const result = bar.getByRole("region", { name: "Transfer result" });
    await expect(result.getByRole("status")).toHaveText("Transfer interrupted");
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value.developmentHandoffs,
      ),
    ).toEqual([]);
    await result
      .getByRole("button", { name: "Check cart and review remaining changes" })
      .click();
    await panel.getByRole("button", { name: /^Confirm: / }).click();
    await expect(result.getByRole("status")).toHaveText(
      "Cart updated and verified",
    );
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value.developmentHandoffs,
      ),
    ).toHaveLength(1);
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
