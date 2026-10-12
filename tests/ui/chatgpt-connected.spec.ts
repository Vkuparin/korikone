import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { settingsCategory } from "./settings-helper";

test("ChatGPT sign-in reflects fixture authentication states in both languages and themes", async () => {
  test.setTimeout(120000);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-connected-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    for (const language of ["fi", "en"] as const) {
      const connectedLabel =
        language === "fi"
          ? "Kirjautunut ChatGPT:llä"
          : "Signed in with ChatGPT";
      const openAI = async () => {
        await page.reload();
        await page
          .getByRole("button", {
            name: language === "fi" ? "Asetukset" : "Settings",
            exact: true,
          })
          .click();
        await settingsCategory(
          page,
          "ai",
          language === "fi" ? "ChatGPT ja tekoäly" : "ChatGPT and AI",
        );
      };
      await page.evaluate(async (language) => {
        await window.korikone.setLanguage(language);
        await window.korikone.developmentScenario("success");
        await window.korikone.signOutAI();
      }, language);
      await openAI();
      const signIn = page.getByRole("button", {
        name: "Continue with ChatGPT",
        exact: true,
      });
      await expect(signIn).toBeEnabled();
      await signIn.click();
      const connected = page.getByRole("button", {
        name: connectedLabel,
        exact: true,
      });
      await expect(connected).toBeDisabled();
      const before = (await page.evaluate(() => window.korikone.load())).value!;
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate(
          (theme) => window.korikone.setAppearance(theme),
          theme,
        );
        await openAI();
        await expect(connected).toBeDisabled();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const colors = await connected.evaluate((button) => {
          const style = getComputedStyle(button);
          const luminance = (color: string) => {
            const values = color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((v) => {
                const n = v / 255;
                return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
              });
            return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
          };
          const a = luminance(style.color),
            b = luminance(style.backgroundColor);
          return {
            opacity: style.opacity,
            contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        });
        expect(colors.opacity).toBe("1");
        expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
        await connected.evaluate((button) =>
          (button as HTMLButtonElement).click(),
        );
        await page.locator(".settings-page").screenshot({
          path: `test-results/chatgpt-connected-${language}-${theme}.png`,
        });
      }
      const after = (await page.evaluate(() => window.korikone.load())).value!;
      expect(after.developmentSignInCalls).toBe(before.developmentSignInCalls);
      await page
        .getByRole("button", {
          name: language === "fi" ? "Kirjaudu ulos" : "Sign out",
          exact: true,
        })
        .click();
      await expect(signIn).toBeEnabled();
      for (const scenario of [
        "authWaiting",
        "authExpired",
        "authRestored",
      ] as const) {
        await page.evaluate(
          (scenario) => window.korikone.developmentScenario(scenario),
          scenario,
        );
        await openAI();
        if (scenario === "authRestored") await expect(connected).toBeDisabled();
        else if (scenario === "authWaiting")
          await expect(signIn).toBeDisabled();
        else {
          await expect(signIn).toBeEnabled();
          await expect(page.locator(".settings-page")).toContainText(
            "fixture@korikone.local",
          );
        }
      }
      const final = (await page.evaluate(() => window.korikone.load())).value!;
      expect(final.developmentRequests).toBe(0);
      expect(final.developmentStoreWrites).toBe(0);
      expect(final.developmentSignInCalls).toBe(before.developmentSignInCalls);
    }
  } finally {
    await app.close();
  }
});
