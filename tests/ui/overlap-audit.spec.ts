import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { settingsSections } from "../../src/ui/settings-contract";
import { composer } from "./composer-helper";
import { layoutFindings, type LayoutFinding } from "./overlap-helper";
import { knownOverlaps } from "./overlap-known";

const sizes = [
  { width: 1280, height: 800 },
  // 1280x800 at 125 % desktop scaling.
  { width: 1024, height: 640 },
  { width: 800, height: 600 },
];
const longMeal =
  "Pitkä aterian nimi, jonka kaikki sanat pitää voida lukea myös kapeassa näkymässä";
const longItem =
  "Luomu täysjyväruisleipä auringonkukansiemenillä ja kurpitsansiemenillä viipaloitu";

for (const language of ["fi", "en"] as const)
  for (const size of sizes)
    test(`layout audit ${language} ${size.width}x${size.height}`, async () => {
      test.setTimeout(180000);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      env.KORIKONE_TEST_DATA = await mkdtemp(
        join(tmpdir(), "korikone-overlap-"),
      );
      env.KORIKONE_TEST_HIDDEN = "1";
      const app = await electron.launch({ args: ["."], env });
      const output = join("test-results", "overlap-audit");
      await mkdir(output, { recursive: true });
      const prefix = `${language}-${size.width}`;
      const found: Record<string, LayoutFinding[]> = {};
      try {
        const page = await app.firstWindow();
        await page.setViewportSize(size);
        await page.emulateMedia({ reducedMotion: "reduce" });
        const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
        const measure = async (name: string) => {
          found[name] = await layoutFindings(page);
          await page.screenshot({
            path: join(output, `${prefix}-${name}.png`),
            fullPage: true,
          });
        };
        const load = () =>
          page.evaluate(() => window.korikone.load()).then((r) => r.value);
        const save = async (state: ReturnType<typeof initialState>) => {
          await page.evaluate(async (state) => {
            state.revision = (
              await window.korikone.load()
            ).value.state.revision;
            const saved = await window.korikone.save(state);
            if (!saved.ok) throw new Error(saved.error);
          }, state);
          await page.reload();
        };
        const nav = (index: number) =>
          page.locator("nav").first().getByRole("button").nth(index).click();

        const state = initialState();
        state.onboarded = state.setupComplete = true;
        state.staples = [];
        state.reviewBeforeTransfer = true;
        state.meals = [];
        state.extras = [];
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
        await composer(page).waitFor();
        // The measurement itself: a control planted over the composer is reported both ways.
        await page.evaluate(() => {
          const planted = document.createElement("button");
          planted.id = "planted-overlap";
          planted.textContent = "Planted";
          const box = document
            .querySelector(".note-box textarea")!
            .getBoundingClientRect();
          planted.style.cssText = `position:absolute;left:${box.left + scrollX}px;top:${box.top + scrollY}px;width:${box.width}px;height:${box.height}px;z-index:5`;
          document.body.append(planted);
        });
        const planted = await layoutFindings(page);
        expect(planted.map((f) => f.kind)).toEqual(
          expect.arrayContaining(["overlap", "covered"]),
        );
        await page.evaluate(() =>
          document.getElementById("planted-overlap")!.remove(),
        );
        await measure("shopping-empty");

        // A list with long names, a meal, priced, unknown-pack, unknown-price and unfound rows.
        state.household.budget = 1;
        // Plain exclusion words only: a dietary term would leave every row unresolved.
        state.household.exclusions = "sianliha, äyriäiset, selleri, lupiini";
        state.recipes = [
          ...state.recipes,
          {
            id: "audit-meal",
            name: longMeal,
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
            id: "a1",
            recipeId: "audit-meal",
            day: 0,
            servings: 2,
            leftovers: false,
          },
          {
            id: "a2",
            recipeId: "pasta",
            day: 1,
            servings: 4,
            leftovers: false,
          },
          {
            id: "a3",
            recipeId: "soup",
            day: 2,
            servings: 12,
            leftovers: false,
          },
        ];
        state.extras = [
          { id: "mince", name: "Jauheliha", amount: 500, unit: "g" },
          {
            id: "layout-unknown-price",
            name: "layout-unknown-price",
            amount: 500,
            unit: "g",
          },
          { id: "long-bread", name: longItem, amount: 1500, unit: "g" },
          { id: "milk", name: "Maito", amount: 12000, unit: "ml" },
          { id: "egg", name: "Kananmuna", amount: 30, unit: "pcs" },
        ];
        await save(state);
        await expect(page.locator(".grocery-row").first()).toBeVisible();
        await measure("shopping-list");

        // Row details with product alternatives, one row at a time.
        const names = page.locator(".grocery-row .row-name");
        const rows = await names.count();
        for (const index of [0, Math.floor(rows / 2), rows - 1]) {
          await names.nth(index).click();
          await measure(`row-details-${index}`);
          await names.nth(index).click();
        }

        // A local edit outcome with Undo.
        await page.evaluate(async () => {
          const value = (await window.korikone.load()).value;
          await window.korikone.editLocally({
            revision: value.state.revision,
            operations: [
              { op: "changeServings", mealId: "a2", servings: 6 },
              { op: "removeItem", rowKey: "egg:pcs" },
            ],
          });
        });
        await page.reload();
        await expect(page.locator(".edit-outcome")).toBeVisible();
        await measure("edit-outcome");

        // Export actions with the QR code open.
        const qr = page.getByRole("button", {
          name: tr("Näytä QR-koodi", "Show QR code"),
        });
        if (await qr.count()) {
          await qr.click();
          await measure("exports-qr");
          await page
            .getByRole("button", {
              name: tr("Piilota QR-koodi", "Hide QR code"),
            })
            .click();
        }

        // The composer with an unsent instruction, then working.
        await composer(page).fill(
          tr(
            "Lisää vielä kaksi litraa kevytmaitoa, litra vaniljajäätelöä ja vaihda keitto lohikeittoon kuudelle hengelle",
            "Add two litres of semi-skimmed milk, a litre of vanilla ice cream and swap the soup for salmon soup for six",
          ),
        );
        await measure("composer-unsent");
        await page.evaluate(() =>
          window.korikone.developmentScenario("pendingSuccess"),
        );
        await composer(page).press("Control+Enter");
        await page.locator(".note-actions").scrollIntoViewIfNeeded();
        const activeStatus = page.locator(
          '[data-operation-status][role="status"]',
        );
        await expect(activeStatus).toHaveCount(1);
        await expect(activeStatus).toBeVisible();
        await measure("composer-working");
        await page
          .getByRole("button", {
            name: new RegExp(
              tr("^(Peruuta muutos|Peruuta)$", "^(Cancel change|Cancel)$"),
            ),
          })
          .click();
        await measure("composer-cancelled");
        await composer(page).fill("");

        // The transfer control with the budget exceeded.
        const transfer = page.locator(".transfer-button");
        if ((await transfer.count()) && (await transfer.first().isEnabled())) {
          await transfer.first().click();
          await page.waitForTimeout(500);
          await measure("transfer-pressed");
        }
        expect((await load()).developmentStoreWrites).toBe(0);

        // The other pages.
        for (const [index, name] of [
          [0, "list-return"],
          [1, "week-plan"],
          [2, "recipes"],
          [3, "history"],
          [4, "store"],
        ] as const) {
          await nav(index);
          await page.waitForTimeout(200);
          await measure(name);
        }
        await nav(5);
        const settings = page.locator(".settings-page");
        for (const section of settingsSections) {
          const select = settings.locator(".settings-category select");
          if (await select.isVisible()) await select.selectOption(section);
          else
            await settings
              .locator(".settings-navigation")
              .getByRole("button")
              .nth(settingsSections.indexOf(section))
              .click();
          await expect(
            page.locator(`#settings-section-${section}`),
          ).toBeVisible();
          await measure(`settings-${section}`);
        }
        const external = await load();
        expect([
          external.developmentStoreWrites,
          external.developmentHandoffs,
        ]).toEqual([0, []]);
      } finally {
        await writeFile(
          join(output, `${prefix}.json`),
          JSON.stringify(found, null, 2),
        );
        await app.close();
      }
      // Every measured state is either clean or exactly the recorded, confirmed failure.
      const actual = Object.fromEntries(
        Object.entries(found)
          .map(([name, list]) => [
            name,
            [
              ...new Set(
                list.map((f) => `${f.kind}: ${f.element.replace(/ ".*$/, "")}`),
              ),
            ].sort(),
          ])
          .filter(([, list]) => list.length),
      );
      expect(actual).toEqual(knownOverlaps[prefix] ?? {});
    });
