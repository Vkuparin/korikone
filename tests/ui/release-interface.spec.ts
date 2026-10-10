import {
  test,
  expect,
  _electron as electron,
  type Page,
  type Locator,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { settingsSections } from "../../src/ui/settings-contract";
import { sectionLabels } from "../../src/ui/settings";
import { fi, en } from "../../src/ui/i18n";

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 160; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Keyboard could not reach ${(await target.getAttribute("aria-label")) ?? (await target.innerText())}`,
  );
}

async function keyboardSection(
  page: Page,
  section: (typeof settingsSections)[number],
  label: string,
) {
  const select = page.locator(".settings-category select");
  if (await select.isVisible()) {
    const wanted = settingsSections.indexOf(section);
    while ((await select.inputValue()) !== section) {
      const current = settingsSections.indexOf(
        (await select.inputValue()) as typeof section,
      );
      await tabTo(page, select);
      await page.keyboard.press(current < wanted ? "ArrowDown" : "ArrowUp");
    }
  } else {
    const button = page
      .locator(".settings-navigation")
      .getByRole("button", { name: label, exact: true });
    await tabTo(page, button);
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(`#settings-section-${section}`)).toBeFocused();
}

for (const language of ["fi", "en"] as const) {
  for (const appearance of ["light", "dark"] as const) {
    for (const size of [
      { width: 1280, height: 800 },
      { width: 800, height: 600 },
    ]) {
      test(`combined interface audit ${language} ${appearance} ${size.width}`, async () => {
        test.setTimeout(120000);
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        );
        delete env.ELECTRON_RUN_AS_NODE;
        env.KORIKONE_TEST_DATA = await mkdtemp(
          join(tmpdir(), "korikone-interface-audit-"),
        );
        env.KORIKONE_TEST_HIDDEN = "1";
        const app = await electron.launch({ args: ["."], env });
        const prefix = `${language}-${appearance}-${size.width}`;
        const output = join("test-results", "interface-audit");
        await mkdir(output, { recursive: true });
        const captures: string[] = [];
        try {
          const page = await app.firstWindow();
          await page.setViewportSize(size);
          await page.emulateMedia({ reducedMotion: "reduce" });
          const t = language === "fi" ? fi : en;
          const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
          const state = initialState();
          state.onboarded = state.setupComplete = true;
          state.staples = [];
          state.meals = [];
          state.extras = [];
          state.appearance = appearance;
          await page.evaluate(
            async ({ state, language }) => {
              const saved = await window.korikone.save(state);
              if (!saved.ok) throw new Error(saved.error);
              await window.korikone.setLanguage(language);
              await window.korikone.signInAI();
            },
            { state, language },
          );
          await page.reload();
          const load = () =>
            page
              .evaluate(() => window.korikone.load())
              .then((result) => result.value);
          const capture = async (name: string, locator?: Locator) => {
            const file = `${prefix}-${name}.png`;
            if (locator) await locator.screenshot({ path: join(output, file) });
            else await page.screenshot({ path: join(output, file) });
            captures.push(file);
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
          };
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            appearance,
          );
          await expect(page.locator(".grocery-row")).toHaveCount(0);
          await expect(page.locator(".shopping-total")).toHaveCount(0);
          const rail = page.getByRole("navigation").first();
          if (await page.locator(".update-banner").count()) {
            const bannerLeft = await page
              .locator(".update-banner")
              .evaluate((el) => el.getBoundingClientRect().left);
            expect(bannerLeft).toBeGreaterThanOrEqual(
              await rail.evaluate((el) => el.getBoundingClientRect().right),
            );
          }
          expect(
            await page
              .getByLabel(tr("Lisää tuote", "Add grocery"), { exact: true })
              .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
          ).toBeGreaterThanOrEqual(16);
          expect(
            await page
              .locator(".product-preference")
              .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
          ).toBeGreaterThanOrEqual(14);
          await capture("shopping-empty");
          const note = page.getByLabel(
            tr("Mitä haluaisit valmistaa?", "What would you like to cook?"),
          );
          await tabTo(page, note);
          await page.keyboard.type("Makaronilaatikko");
          await expect(page.locator("#note-unapplied")).toBeVisible();
          expect((await load()).developmentRequests).toBe(0);
          const fulfillment = page.getByRole("button", {
            name:
              language === "fi" ? /Vaihda toimitustapaa/ : /Change fulfillment/,
          });
          const beforeContext = await load();
          await tabTo(page, fulfillment);
          await page.keyboard.press("Enter");
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(fulfillment).toBeFocused();
          expect((await load()).state).toEqual(beforeContext.state);
          expect((await load()).developmentCatalogueRequests).toBe(
            beforeContext.developmentCatalogueRequests,
          );
          await page.evaluate(() =>
            window.korikone.developmentScenario("pendingSuccess"),
          );
          await tabTo(page, note);
          await page.keyboard.press("Control+Enter");
          await expect(page.locator("#note-update-help")).toHaveText(
            tr("Muodostetaan listaa…", "Building your list…"),
          );
          expect(
            await page
              .locator(".note-box")
              .evaluate((el) => getComputedStyle(el).animationName),
          ).toBe("none");
          await capture("shopping-working", page.locator(".note-box"));
          const cancel = page.locator(".note-actions").getByRole("button", {
            name: tr("Peruuta listan päivitys", "Cancel list update"),
            exact: true,
          });
          await tabTo(page, cancel);
          await page.keyboard.press("Enter");
          await expect(page.locator("#note-update-help")).toHaveText(
            tr("Listan päivitys peruutettu", "List update cancelled"),
          );
          await expect(note).toBeFocused();
          expect((await load()).developmentRequests).toBe(1);
          expect((await load()).state.meals).toEqual([]);
          await expect(page.locator(".shopping-total")).toHaveCount(0);

          const mealName =
            "Pitkä aterian nimi, jonka kaikki sanat pitää voida lukea myös kapeassa näkymässä";
          state.household.budget = 1;
          state.recipes = [
            {
              id: "audit-meal",
              name: mealName,
              servings: 2,
              instructions: "",
              kind: "meal",
              ingredients: [
                {
                  id: "layout-long",
                  name: "layout-long",
                  amount: 500,
                  unit: "g",
                },
              ],
            },
          ];
          state.meals = [
            {
              id: "audit-serving",
              recipeId: "audit-meal",
              day: 0,
              servings: 2,
              leftovers: false,
            },
          ];
          state.extras = [
            "layout-unknown-pack",
            "layout-unknown-price",
            "carrot",
          ].map((id) => ({ id, name: id, amount: 500, unit: "g" as const }));
          await page.evaluate(async (state) => {
            state.revision = (
              await window.korikone.load()
            ).value.state.revision;
            const saved = await window.korikone.save(state);
            if (!saved.ok) throw new Error(saved.error);
          }, state);
          await page.reload();
          await expect(note).toHaveValue("Makaronilaatikko");
          const meal = page
            .locator(".meal-select")
            .filter({ hasText: mealName });
          await tabTo(page, meal);
          await page.keyboard.press("Enter");
          await expect(meal).toHaveAttribute("aria-pressed", "true");
          await capture("shopping-populated");
          await capture("shopping-list", page.locator(".shopping-panel"));
          const row = (id: string) =>
            page.locator(".grocery-row").filter({
              has: page.locator(`.home-button[aria-label$=": ${id}"]`),
            });
          await expect(row("layout-long")).toHaveClass(/highlighted/);
          await expect(
            row("layout-unknown-price").locator(".row-price"),
          ).toHaveText(tr("Hinta puuttuu", "Price unknown"));
          const unknownPrice = row("layout-unknown-price").locator(".row-name");
          await tabTo(page, unknownPrice);
          await page.keyboard.press("Enter");
          await expect(
            row("layout-unknown-price")
              .getByRole("region")
              .getByRole("button", {
                name: /^(Valitse tuote|Choose this product)/,
              }),
          ).toBeDisabled();
          await capture("shopping-unresolved", row("layout-unknown-price"));
          const packName = row("layout-unknown-pack").locator(".row-name");
          await tabTo(page, packName);
          await page.keyboard.press("Enter");
          const amount = row("layout-unknown-pack").getByRole("spinbutton");
          await tabTo(page, amount);
          await page.keyboard.type("500");
          await page.keyboard.press("Enter");
          await expect(row("layout-unknown-pack")).not.toHaveClass(
            /unresolved/,
          );
          const increase = row("layout-unknown-pack").getByRole("button", {
            name: `${tr("Lisää", "Increase")}: layout-unknown-pack`,
            exact: true,
          });
          await tabTo(page, increase);
          await page.keyboard.press("Enter");
          await expect(
            row("layout-unknown-pack").locator(".quantity-control span"),
          ).toHaveText("2");
          await expect(meal).toHaveAttribute("aria-pressed", "true");
          const transfer = page.locator(".transfer-button");
          await expect(transfer).toBeEnabled();
          await tabTo(page, transfer);
          await page.keyboard.press("Enter");
          const decision = page.getByRole("region", {
            name: tr("Siirron vahvistus", "Transfer confirmation"),
          });
          await expect(decision).toContainText(
            tr("Viikkobudjetti ylittyy", "Over the weekly budget"),
          );
          await expect(
            decision.getByRole("button", { name: /^(Vahvista|Confirm):/ }),
          ).toBeDisabled();
          await capture("shopping-exception", decision);
          const acceptBudget = decision.getByRole("checkbox");
          await tabTo(page, acceptBudget);
          await page.keyboard.press("Space");
          await expect(
            decision.getByRole("button", { name: /^(Vahvista|Confirm):/ }),
          ).toBeEnabled();
          const cancelDecision = decision.getByRole("button", {
            name: tr("Peru", "Cancel"),
            exact: true,
          });
          await tabTo(page, cancelDecision);
          await page.keyboard.press("Enter");
          await expect(decision).toHaveCount(0);
          const quoted = await load();

          const settings = page
            .getByRole("navigation")
            .first()
            .getByRole("button", {
              name: tr("Asetukset", "Settings"),
              exact: true,
            });
          await tabTo(page, settings);
          await page.keyboard.press("Enter");
          await expect(page.locator("#settings-section-general")).toBeFocused();
          for (const section of settingsSections) {
            if (section !== "general")
              await keyboardSection(page, section, t[sectionLabels[section]]);
            const heading = page.locator(`#settings-section-${section}`);
            expect(
              await heading.evaluate((el) =>
                parseFloat(getComputedStyle(el).fontSize),
              ),
            ).toBeGreaterThanOrEqual(20);
            await expect(
              page.locator(".settings-content > section:visible"),
            ).toHaveCount(1);
            if (section === "household") {
              const budget = page.getByLabel(t.budget);
              await tabTo(page, budget);
              await page.keyboard.press("Control+A");
              await page.keyboard.type("-1");
              const save = page
                .locator(".settings-content > section:visible")
                .getByRole("button", { name: t.save, exact: true });
              await tabTo(page, save);
              await page.keyboard.press("Enter");
              const error = page.locator("#root > .error");
              await expect(error).toBeVisible();
              expect(
                await error.evaluate((el) => el.getBoundingClientRect().left),
              ).toBeGreaterThanOrEqual(
                await rail.evaluate((el) => el.getBoundingClientRect().right),
              );
              expect((await load()).state.household.budget).toBe(1);
              await capture("settings-validation");
              await tabTo(page, budget);
              await page.keyboard.press("Control+A");
              await page.keyboard.type("123.45");
            }
            if (section === "data") {
              const receipt = page.locator(
                ".settings-content > section:visible textarea",
              );
              await tabTo(page, receipt);
              await page.keyboard.type("Retained receipt draft");
            }
            if (section === "advanced")
              await expect(
                page.getByLabel(t.developmentMode, { exact: true }),
              ).toBeDisabled();
            await capture(
              `settings-${section}`,
              page.locator(".settings-page"),
            );
          }
          await keyboardSection(page, "household", t.settingsHousehold);
          await expect(page.getByLabel(t.budget)).toHaveValue("123.45");
          await expect(
            page.getByText(t.householdUnapplied, { exact: true }),
          ).toBeVisible();
          await keyboardSection(page, "data", t.settingsData);
          await expect(
            page.locator(".settings-content > section:visible textarea"),
          ).toHaveValue("Retained receipt draft");
          const afterSettings = await load();
          expect(afterSettings.state).toEqual(quoted.state);
          expect(afterSettings.basket).toEqual(quoted.basket);
          expect(afterSettings.developmentRequests).toBe(1);
          expect(afterSettings.developmentStoreWrites).toBe(0);
          expect(afterSettings.developmentCatalogueRequests).toBe(
            quoted.developmentCatalogueRequests,
          );
          await writeFile(
            join(output, `${prefix}.json`),
            JSON.stringify(
              {
                language,
                appearance,
                ...size,
                reducedMotion: true,
                keyboardOnly: true,
                developmentMode: afterSettings.developmentMode,
                runtimeVersion: (
                  await page.evaluate(() => window.korikone.getAppInfo())
                ).value.version,
                fixtureGenerations: 1,
                storeWrites: 0,
                captures,
              },
              null,
              2,
            ),
          );
        } finally {
          await app.close();
        }
      });
    }
  }
}
