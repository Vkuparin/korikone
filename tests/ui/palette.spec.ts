import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function contrast(a: string, b: string) {
  const luminance = (colour: string) => {
    if (/^#[0-9a-f]{3}$/i.test(colour)) {
      colour =
        "#" +
        colour
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("");
    }
    const values = colour.startsWith("#")
      ? colour
          .slice(1)
          .match(/../g)!
          .map((n) => parseInt(n, 16) / 255)
      : colour
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((n) => Number(n) / 255);
    const [r, g, blue] = values.map((v) =>
      v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("app palette tokens keep text and keyboard focus readable without generation", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-palette-"));
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Kokeile esimerkkiä" }).click();
    const catalogueRequests = await page.evaluate(
      async () =>
        (await window.korikone.load()).value.developmentCatalogueRequests,
    );
    for (const theme of ["light", "dark"]) {
      // U14.2 exposes resolved palettes; U15.2 supplies production mode selection.
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const tokens = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return Object.fromEntries(
          [
            "bg",
            "surface",
            "subtle",
            "text",
            "muted",
            "action",
            "on-action",
            "focus",
            "success",
            "warning",
            "warning-bg",
            "error",
            "error-bg",
            "control-border",
          ].map((key) => [key, css.getPropertyValue(`--kk-${key}`).trim()]),
        );
      });
      for (const background of ["bg", "surface", "subtle"]) {
        for (const foreground of ["text", "muted", "action"]) {
          expect(
            contrast(tokens[foreground], tokens[background]),
            `${theme} ${foreground}/${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          contrast(tokens.focus, tokens[background]),
          `${theme} focus/${background}`,
        ).toBeGreaterThanOrEqual(3);
      }
      for (const [foreground, background] of [
        ["on-action", "action"],
        ["warning", "warning-bg"],
        ["error", "error-bg"],
        ["success", "surface"],
      ]) {
        expect(
          contrast(tokens[foreground], tokens[background]),
          `${theme} ${foreground}/${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast(tokens["control-border"], tokens.surface),
      ).toBeGreaterThanOrEqual(3);
      const input = page.getByLabel("Lisää tuote", { exact: true });
      await input.focus();
      expect(
        await input.evaluate((el) => getComputedStyle(el).outlineWidth),
      ).toBe("3px");
      const list = page.locator(".shopping-panel");
      const actual = await list.evaluate((el) => {
        const css = getComputedStyle(el);
        return { text: css.color, background: css.backgroundColor };
      });
      expect(contrast(actual.text, actual.background)).toBeGreaterThanOrEqual(
        4.5,
      );
      for (const [width, height] of [
        [1280, 800],
        [800, 600],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `docs/design/0.6.0/screens/app-shopping-${theme}-${width}.png`,
        });
      }
      await page
        .getByRole("button", { name: "Asetukset", exact: true })
        .click();
      const language = page.getByRole("button", { name: "Kieli", exact: true });
      await language.click();
      const choice = page.locator(".choice-menu");
      await expect(choice).toBeVisible();
      const menu = await choice.evaluate((el) => {
        const css = getComputedStyle(el);
        const option = el.querySelector("button")!;
        return {
          background: css.backgroundColor,
          text: getComputedStyle(option).color,
        };
      });
      expect(contrast(menu.text, menu.background)).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press("Escape");
      for (const [width, height] of [
        [1280, 800],
        [800, 600],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `docs/design/0.6.0/screens/app-settings-${theme}-${width}.png`,
        });
      }
      await page
        .getByRole("button", { name: "Ostoslista", exact: true })
        .click();
    }
    const snapshot = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(snapshot.developmentMode).toBe(true);
    expect(snapshot.developmentRequests).toBe(0);
    expect(snapshot.developmentCatalogueRequests).toBe(catalogueRequests);
  } finally {
    await app.close();
  }
});
