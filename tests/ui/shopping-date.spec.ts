import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const language of ["fi", "en"] as const)
  test(`shopping date is information and skipped by the keyboard in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-shopping-date-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await page.evaluate(
        (language) => window.korikone.setLanguage(language),
        language,
      );
      await page.reload();
      const date = page.locator(".shopping-date");
      await expect(date).toContainText(language === "fi" ? "Tänään" : "Today");
      expect(await date.getAttribute("datetime")).not.toBeNull();
      const before = (await page.evaluate(() => window.korikone.load())).value;
      for (const width of [1280, 800]) {
        await page.setViewportSize({
          width,
          height: width === 800 ? 600 : 800,
        });
        await expect(date).toBeVisible();
        const info = await date.evaluate((element) => ({
          tag: element.tagName,
          tabIndex: (element as HTMLElement).tabIndex,
          cursor: getComputedStyle(element).cursor,
          border: getComputedStyle(element).borderTopWidth,
          background: getComputedStyle(element).backgroundColor,
        }));
        expect(info).toMatchObject({
          tag: "TIME",
          tabIndex: -1,
          cursor: "text",
          border: "0px",
          background: "rgba(0, 0, 0, 0)",
        });
        await date.hover();
        expect(
          await date.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        ).toBe(info.background);
        const controls = page.locator(".note-context button");
        await controls.first().focus();
        await page.keyboard.press("Tab");
        await expect(page.locator(".store-chip")).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.locator(".note-footer").screenshot({
          path: `test-results/shopping-date-${language}-${width}.png`,
        });
      }
      const after = (await page.evaluate(() => window.korikone.load())).value;
      expect(after.state).toEqual(before.state);
      expect(after.developmentRequests).toBe(0);
      expect(after.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
