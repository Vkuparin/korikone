import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("at 1366×768 the list panel shows at least three whole rows and the transfer button (B7.1)", async () => {
  const path = await mkdtemp(join(tmpdir(), "korikone-list-compact-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = path;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
    );
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const panel = page.locator(".shopping-panel");
    await expect(panel.locator(".grocery-row").first()).toBeVisible();
    // The list actions are one menu; clearing and the preference live there.
    await expect(
      panel.getByRole("button", { name: "Tyhjennä lista" }),
    ).toBeHidden();
    await panel.locator(".list-menu > summary").click();
    await expect(
      panel.getByRole("button", { name: "Tyhjennä lista" }),
    ).toBeVisible();
    await expect(panel.locator(".list-menu .product-preference")).toBeVisible();
    await panel.locator(".list-menu > summary").click();
    await expect(
      panel.getByRole("button", { name: "Viimeistele lista tekoälykentässä" }),
    ).toBeVisible();

    const button = panel.locator(".transfer-button");
    await expect(button).toBeInViewport();
    const counts = await page.evaluate(() => {
      const button = document
        .querySelector(".shopping-panel .transfer-button")!
        .getBoundingClientRect();
      const rows = [
        ...document.querySelectorAll(".shopping-panel .grocery-row"),
      ].map((row) => row.getBoundingClientRect());
      const whole = rows.filter(
        (r) => r.top >= 0 && r.bottom <= Math.min(innerHeight, button.top),
      );
      return { whole: whole.length, bottom: button.bottom, innerHeight };
    });
    expect(counts.whole).toBeGreaterThanOrEqual(3);
    expect(counts.bottom).toBeLessThanOrEqual(counts.innerHeight);
  } finally {
    await app.close();
  }
});
