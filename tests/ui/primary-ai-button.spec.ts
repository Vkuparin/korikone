import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { composer } from "./composer-helper";

for (const language of ["fi", "en"] as const) {
  test(`primary AI action distinguishes create, edit and new list in ${language}`, async () => {
    test.setTimeout(120000);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-primary-ai-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      Object.assign(state, {
        onboarded: true,
        setupComplete: true,
        language,
        staples: [],
        appearance: "light",
      });
      await page.evaluate(async (state) => {
        await window.korikone.save(state);
        await window.korikone.setLanguage(state.language);
        await window.korikone.signInAI();
      }, state);
      await page.reload();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value!);
      const primary = page.locator(".update-note");
      const note = composer(page);
      const createName =
        language === "fi" ? "Taio ostoslista" : "Create my shopping list";
      const editName =
        language === "fi" ? "Taio muutokset" : "Update my shopping list";
      await expect(primary).toHaveAccessibleName(createName);
      await expect(primary).toBeDisabled();
      await note.fill("500 g suodatinjauhettua kahvia");
      await expect(primary).toBeEnabled();
      await page.setViewportSize({ width: 800, height: 650 });
      for (const chain of ["k-ruoka", "s-kaupat"] as const) {
        const changed = await page.evaluate(async (chain) => {
          const result = (await window.korikone.searchStores("alternate"))
            .value!;
          const context = result.storeResults.find(
            (context) => context.providerId === chain,
          )!;
          return window.korikone.changeContext({
            context,
            revision: (await window.korikone.load()).value!.state.revision,
          });
        }, chain);
        expect(changed.ok).toBe(true);
        for (const theme of ["light", "dark"] as const) {
          await page.evaluate(
            (theme) => window.korikone.setAppearance(theme),
            theme,
          );
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          await expect(page.locator("html")).toHaveAttribute(
            "data-chain",
            chain === "s-kaupat" ? "s" : "k",
          );
          await expect(primary).toBeInViewport();
          const appearance = await primary.evaluate((button) => {
            const style = getComputedStyle(button),
              root = getComputedStyle(document.documentElement);
            const luminance = (color: string) => {
              const parts = color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
                .map((value) => {
                  const n = value / 255;
                  return n <= 0.04045
                    ? n / 12.92
                    : ((n + 0.055) / 1.055) ** 2.4;
                });
              return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
            };
            const a = luminance(style.color),
              b = luminance(style.backgroundColor);
            const probe = document.createElement("span");
            probe.style.color = root.getPropertyValue("--kk-action");
            document.body.append(probe);
            const accent = getComputedStyle(probe).color;
            probe.remove();
            return {
              background: style.backgroundColor,
              accent,
              contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
              height: button.getBoundingClientRect().height,
              animation: style.animationName,
            };
          });
          expect(appearance.background).toBe(appearance.accent);
          expect(appearance.contrast).toBeGreaterThanOrEqual(4.5);
          expect(appearance.height).toBeGreaterThanOrEqual(44);
          expect(appearance.animation).toBe("none");
          await primary.focus();
          await page.keyboard.press("Tab");
          await page.keyboard.press("Shift+Tab");
          await expect(primary).toBeFocused();
          expect(
            await primary.evaluate(
              (button) => getComputedStyle(button).outlineWidth,
            ),
          ).toBe("3px");
          await page.locator(".note-box").screenshot({
            path: `test-results/primary-ai-${language}-${chain}-${theme}.png`,
          });
        }
      }
      await note.fill("Pitkä muistiinpano / A long note. ".repeat(200));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await load()).developmentRequests).toBe(0);
      await note.fill("500 g suodatinjauhettua kahvia");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedSuccess"),
      );
      const readyBox = await primary.boundingBox();
      await primary.click();
      await expect(primary).toHaveAttribute("aria-busy", "true");
      await expect(primary).toBeDisabled();
      await expect(primary).toHaveAccessibleName(createName);
      expect((await primary.boundingBox())!.width).toBe(readyBox!.width);
      expect(
        await page
          .locator(".note-box")
          .evaluate((box) => getComputedStyle(box).animationName),
      ).toBe("none");
      await primary.evaluate((button) => (button as HTMLButtonElement).click());
      await note.press("Control+Enter");
      await expect(primary).toHaveAttribute("aria-busy", "false", {
        timeout: 20000,
      });
      await expect(primary).toHaveAccessibleName(editName);
      expect((await load()).developmentRequests).toBe(1);
      await expect(page.locator(".grocery-row")).toHaveCount(1);
      await expect(page.locator(".quantity-control").first()).toBeVisible();

      // Editing uses the current-list path once, then explicit New list restores creation.
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedSuccess"),
      );
      await note.fill(
        language === "fi" ? "lisää 500 g kahvia" : "add 500 g coffee",
      );
      await expect(primary).toHaveAccessibleName(editName);
      await primary.click();
      await expect(primary).toHaveAttribute("aria-busy", "true");
      await expect(primary).toBeDisabled();
      await note.press("Control+Enter");
      await expect(primary).toHaveAttribute("aria-busy", "false", {
        timeout: 20000,
      });
      await expect(page.locator(".edit-outcome > p").first()).toContainText(
        language === "fi" ? "Lista päivitetty" : "List updated",
      );
      const edited = await load();
      expect(edited.developmentRequests).toBe(1);
      expect(edited.state.extras[0].amount).toBe(1000);
      await page
        .getByRole("button", {
          name: language === "fi" ? "Uusi lista" : "New list",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: language === "fi" ? "Aloita uusi lista" : "Start new list",
          exact: true,
        })
        .click();
      await expect(primary).toHaveAccessibleName(createName);
      await expect(primary).toBeDisabled();
      // The confirmed reset leaves the empty workspace.
      expect((await load()).state.extras).toEqual([]);
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedSuccess"),
      );
      await note.fill("500 g suodatinjauhettua kahvia");
      await note.press("Control+Enter");
      await expect(primary).toHaveAttribute("aria-busy", "true");
      await note.press("Control+Enter");
      await expect(primary).toHaveAttribute("aria-busy", "false", {
        timeout: 20000,
      });
      const replaced = await load();
      expect(replaced.state.extras[0].amount).toBe(500);
      expect(replaced.developmentRequests).toBe(1);
      expect(replaced.developmentStoreWrites).toBe(0);
      await expect(primary).toHaveAccessibleName(editName);
    } finally {
      await app.close();
    }
  });
}
