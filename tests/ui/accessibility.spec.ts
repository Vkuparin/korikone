import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";
import { settingsSections } from "../../src/ui/settings-contract";
import { sectionLabels } from "../../src/ui/settings";
import { fi, en } from "../../src/ui/i18n";

// Inspect the real rendered controls, then traverse them with native Tab events.
// A missing name, negative tabindex, trap or invisible focus fails the audit.
async function auditTabOrder(page: Page, view: string) {
  const candidates = page.locator(
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]',
  );
  const controls = [];
  for (const control of await candidates.all()) {
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    const tabIndex = await control.evaluate(
      (node) => (node as HTMLElement).tabIndex,
    );
    // Section headings are programmatic focus destinations, not controls.
    if (await control.evaluate((node) => /^H[1-6]$/.test(node.tagName)))
      continue;
    expect(tabIndex, `${view}: control must be reachable by Tab`).toBe(0);
    await expect(control, `${view}: accessible name`).toHaveAccessibleName(
      /\S/,
    );
    controls.push(control);
  }
  expect(controls.length, `${view}: has controls`).toBeGreaterThan(0);
  await controls[0].focus();
  for (let index = 1; index < controls.length; index++) {
    await page.keyboard.press("Tab");
    await expect(
      controls[index],
      `${view}: Tab position ${index}`,
    ).toBeFocused();
    const focus = await controls[index].evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        keyboard: node.matches(":focus-visible"),
        outline: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        color: style.outlineColor,
        opacity: style.opacity,
      };
    });
    expect(focus.keyboard, `${view}: keyboard focus`).toBe(true);
    expect(focus.outline, `${view}: visible outline`).not.toBe("none");
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.color).not.toBe("rgba(0, 0, 0, 0)");
    expect(Number(focus.opacity)).toBeGreaterThan(0);
  }
  // Reverse travel must return to the previous control, without a focus trap.
  if (controls.length > 1) {
    await page.keyboard.press("Shift+Tab");
    await expect(controls[controls.length - 2]).toBeFocused();
  }
}

for (const language of ["fi", "en"] as const) {
  test(`keyboard order, names and focus across desktop views in ${language}`, async () => {
    test.setTimeout(180_000);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-a11y-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const t = language === "fi" ? fi : en;
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .waitFor();
      await page.evaluate(async (language) => {
        await window.korikone.setLanguage(language);
        await window.korikone.setAppearance(
          language === "fi" ? "light" : "dark",
        );
      }, language);
      await page.reload();
      await page.setViewportSize({
        width: language === "fi" ? 1280 : 800,
        height: 800,
      });
      await auditTabOrder(page, "welcome");
      await page
        .getByRole("button", { name: t.setupStart, exact: true })
        .click();
      // Clicking starts an async save; audit only after the setup controls have replaced welcome.
      await expect(page.locator(".setup")).toBeVisible();
      await expect(
        page.getByRole("button", { name: t.search, exact: true }),
      ).toBeEnabled();
      await auditTabOrder(page, "setup");
      // Populate the ordinary example through the real saved-state boundary.
      await page.evaluate(async () => {
        const result = await window.korikone.load();
        if (!result.ok) throw new Error(result.error);
        const state = result.value.state;
        state.onboarded = false;
        await window.korikone.save(state);
      });
      await page.reload();
      await page.getByRole("button", { name: t.start, exact: true }).click();
      await expect(page.locator(".grocery-row .row-name")).toHaveCount(6);
      const nav = (name: string) =>
        page
          .getByRole("navigation")
          .first()
          .getByRole("button", { name, exact: true });
      await auditTabOrder(page, "shopping list");
      await page.locator(".grocery-row .row-name").first().click();
      await auditTabOrder(page, "product details");
      await nav(t.weekPlan).click();
      await auditTabOrder(page, "calendar");
      await nav(t.recipes).click();
      await auditTabOrder(page, "recipes");
      await page
        .getByRole("button", { name: t.newRecipe, exact: true })
        .click();
      await auditTabOrder(page, "recipe editor");
      await nav(t.history).click();
      await auditTabOrder(page, "history");
      await nav(t.store).click();
      await auditTabOrder(page, "store");
      await nav(t.settings).click();
      for (const section of settingsSections) {
        if (section !== "general")
          await settingsCategory(page, section, t[sectionLabels[section]]);
        await expect(
          page.locator(`#settings-section-${section}`),
        ).toBeFocused();
        await auditTabOrder(page, `settings ${section}`);
      }
      await settingsCategory(page, "household", t.settingsHousehold);
      await page
        .getByRole("button", { name: t.editStaples, exact: true })
        .click();
      await auditTabOrder(page, "regular items");
      await page.evaluate(() =>
        window.korikone.setReviewBeforeTransfer({ enabled: true }),
      );
      await page.reload();
      await page.locator(".transfer-button").click();
      await expect(page.locator(".transfer-decision")).toBeVisible();
      await auditTabOrder(page, "transfer confirmation");
      await expect(page.locator(".transfer-decision")).toHaveAccessibleName(
        language === "fi" ? "Siirron vahvistus" : "Transfer confirmation",
      );
      const evidence = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(evidence.developmentRequests).toBe(0);
      expect(evidence.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}
