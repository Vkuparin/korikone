import { completeFixtureLogin } from "./store-helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// B5.11: the store site is a native view drawn over the window. Progress and Cancel for a running
// plan must not sit under it, and the view must follow its frame when something above it appears.
test("a plan running while the Kauppa view is open keeps its progress and Cancel outside the store view", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-store-progress-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const viewBounds = () =>
    app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children[0];
      return view ? view.getBounds() : null;
    });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
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
    await page.evaluate(() =>
      window.korikone.developmentScenario("pendingSuccess"),
    );
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("500 g suodatinjauhettua kahvia");
    await note.press("Control+Enter");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^Kauppa/ })
      .click();
    await expect.poll(viewBounds).not.toBeNull();
    const cancel = page.getByRole("button", { name: "Peruuta", exact: true });
    await expect(cancel).toBeVisible();
    // The view follows its frame once the progress strip has settled above it.
    await expect
      .poll(async () => {
        const box = await page.locator(".store-frame").boundingBox();
        const view = await viewBounds();
        return box && view ? Math.abs(Math.round(box.y) - view.y) : -1;
      })
      .toBeLessThanOrEqual(1);
    const button = (await cancel.boundingBox())!;
    const view = (await viewBounds())!;
    const overlaps =
      button.x < view.x + view.width &&
      button.x + button.width > view.x &&
      button.y < view.y + view.height &&
      button.y + button.height > view.y;
    expect(overlaps).toBe(false);
    await cancel.click();
    await expect(cancel).toBeHidden({ timeout: 10000 });
    // When the strip goes, the frame moves up without resizing; the view follows it.
    await expect(page.locator(".operation-fallback")).toHaveCount(0, {
      timeout: 10000,
    });
    const frame = (await page.locator(".store-frame").boundingBox())!;
    await expect
      .poll(async () => Math.abs(Math.round(frame.y) - (await viewBounds())!.y))
      .toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
});
