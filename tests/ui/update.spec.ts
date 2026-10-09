import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("a newer release is announced with a link and nothing is downloaded", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-update-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    const banner = page.getByRole("status").filter({
      hasText: "Uusi versio saatavilla: 99.0.0",
    });
    await expect(banner).toBeVisible();
    // In development mode the link is not opened; the app stays as it was.
    await banner.getByRole("button", { name: "Avaa julkaisusivu" }).click();
    await expect(banner).toBeVisible();
  } finally {
    await app.close();
  }
});
