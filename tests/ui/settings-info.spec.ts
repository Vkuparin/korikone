import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { settingsCategory } from "./settings-helper";

test("runtime version, language menu and unavailable ChatGPT allowance preserve edits and restart", async () => {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    KORIKONE_TEST_DATA: await mkdtemp(join(tmpdir(), "korikone-settings-")),
    KORIKONE_TEST_HIDDEN: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let sourceApp = ".";
  if (!process.env.KORIKONE_EXECUTABLE) {
    await mkdir(join(process.cwd(), ".runtime"), { recursive: true });
    sourceApp = await mkdtemp(join(process.cwd(), ".runtime", "alpha-app-"));
    await writeFile(
      join(sourceApp, "package.json"),
      JSON.stringify({
        name: "korikone",
        version: "0.4.0-alpha.1",
        type: "module",
        main: join(process.cwd(), "dist/main/main.js"),
      }),
    );
  }
  const options = {
    env,
    args: process.env.KORIKONE_EXECUTABLE ? [] : [sourceApp],
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  };
  let app = await electron.launch(options);
  try {
    // The source check uses a local alpha manifest and the real runtime getter.
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Unsaved note");
    const language = page.getByLabel("Kieli", { exact: true });
    await expect(page.locator(".language-control")).toHaveText("Suomi");
    await language.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("listbox", { name: "Kieli", exact: true });
    await expect(menu.getByRole("option")).toHaveCount(2);
    await expect(menu.getByRole("option", { name: "Suomi" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(language).toBeFocused();
    await language.click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 800),
    );
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    if (!process.env.KORIKONE_EXECUTABLE)
      await page.screenshot({ path: "test-results/language-menu.png" });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("What would you like to cook?")).toHaveValue(
      "Unsaved note",
    );
    await expect(page.getByLabel("Language", { exact: true })).toHaveText(
      "English",
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const version = await app.evaluate(({ app }) => app.getVersion());
    if (!process.env.KORIKONE_EXECUTABLE) expect(version).toBe("0.4.0-alpha.1");
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settingsCategory(page, "about", "About");
    await expect(page.getByTestId("app-version")).toHaveText(version);
    await settingsCategory(page, "ai", "ChatGPT and AI");
    const allowance = page.getByTestId("ai-allowance");
    await expect(allowance).toContainText("unavailable in Korikone");
    await expect(allowance).not.toContainText("0%");
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect(page.getByLabel("AI model", { exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Open ChatGPT usage" }).click();
    await expect(allowance).toContainText("unavailable in Korikone");
    await page.evaluate(async () => {
      await window.korikone.developmentScenario("modelsFailed");
    });
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settingsCategory(page, "ai", "ChatGPT and AI");
    await expect(
      page.getByText("Could not load models. Open the selector again.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(allowance).toContainText("unavailable in Korikone");
    await page.evaluate(async () => {
      await window.korikone.developmentScenario("success");
    });
    await page.getByRole("button", { name: "Reload models" }).click();
    await page
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    const before = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    await page.evaluate(async () => {
      await window.korikone.developmentScenario("usageLimit");
    });
    await page.getByLabel("What would you like to cook?").fill("Pasta");
    await page
      .getByRole("button", { name: "Update list", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "ChatGPT limited this request",
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByText("The latest request reached a usage or rate limit.", {
        exact: false,
      }),
    ).toBeVisible();
    const after = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(after.state).toEqual(before.state);
    expect(after.basket).toEqual(before.basket);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(allowance).toContainText("unavailable in Korikone");
    await expect(
      page.getByText("The latest request reached a usage or rate limit.", {
        exact: false,
      }),
    ).toHaveCount(0);
    await app.close();
    app = await electron.launch(options);
    page = await app.firstWindow();
    await expect(page.getByLabel("Language", { exact: true })).toHaveText(
      "English",
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settingsCategory(page, "about", "About");
    await expect(page.getByTestId("app-version")).toHaveText(
      await app.evaluate(({ app }) => app.getVersion()),
    );
  } finally {
    await app.close();
  }
});
