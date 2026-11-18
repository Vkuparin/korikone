import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the update notice sits in the sidebar, not above the page (B7.7)", async () => {
  const path = await mkdtemp(join(tmpdir(), "korikone-update-notice-"));
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
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await page.reload();
    // Development mode announces a fixture release without any network request.
    const notice = page.getByRole("navigation").locator(".update-notice");
    await expect(notice).toContainText("99.0.0");
    await expect(
      notice.getByRole("button", { name: "Avaa julkaisusivu" }),
    ).toBeVisible();
    await expect(page.locator(".update-banner")).toHaveCount(0);
    // The workspace starts right under the banners that remain.
    const context = page.locator(".app-main > .context");
    await expect(context).toBeVisible();
  } finally {
    await app.close();
  }
});
