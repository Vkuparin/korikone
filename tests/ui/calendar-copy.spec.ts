import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("copy week writes Finnish and English calendar text through the real clipboard", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-calendar-copy-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const dates = await page.evaluate(() =>
      Array.from({ length: 7 }, (_, index) => {
        const now = new Date();
        const date = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + index,
          12,
        );
        return {
          iso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
          fi: date.toLocaleDateString("fi-FI", { weekday: "long" }),
          en: date.toLocaleDateString("en-FI", { weekday: "long" }),
        };
      }),
    );
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    state.recipes.push({
      ...state.recipes[0],
      id: "ready",
      name: "Ready food",
      kind: "ready",
    });
    state.meals = [
      {
        id: "pasta-meal",
        recipeId: "pasta",
        day: 0,
        servings: 4,
        leftovers: false,
      },
      {
        id: "soup-meal",
        recipeId: "soup",
        day: 0,
        servings: 4,
        leftovers: false,
      },
      {
        id: "ready-meal",
        recipeId: "ready",
        day: 0,
        servings: 4,
        leftovers: false,
      },
      {
        id: "leftovers-meal",
        recipeId: "soup",
        day: 0,
        servings: 4,
        leftovers: true,
      },
    ];
    state.calendar = {
      [dates[0].iso]: {
        mealIds: [
          "removed",
          "pasta-meal",
          "soup-meal",
          "ready-meal",
          "leftovers-meal",
        ],
        leftovers: false,
      },
      [dates[1].iso]: { mealIds: [], leftovers: true },
    };
    await page.evaluate(async (state) => {
      const saved = await window.korikone.save(state);
      if (!saved.ok) throw new Error(saved.error);
    }, state);
    await page.reload();
    await page
      .getByRole("button", { name: "Viikkosuunnitelma", exact: true })
      .click();
    const copy = page.getByRole("button", {
      name: "Kopioi viikko",
      exact: true,
    });
    await expect(copy).toBeEnabled();
    const before = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    await copy.click();
    await expect(
      page.getByRole("button", { name: "Viikko kopioitu", exact: true }),
    ).toBeVisible();
    const readClipboard = () =>
      app.evaluate(({ clipboard }) => clipboard.readText());
    const fi = dates
      .map(
        (date, index) =>
          `${date.fi} ${date.iso}: ${index === 0 ? "Tomaattipasta, Peruna-porkkanakeitto" : index === 1 ? "Tähteitä" : "Vapaa"}`,
      )
      .join("\n");
    expect(await readClipboard()).toBe(fi);
    const after = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(after.state).toEqual(before.state);
    expect(after.basket).toEqual(before.basket);
    expect(after.developmentRequests).toBe(0);
    await page.getByLabel("Kieli", { exact: true }).selectOption("en");
    await page.getByRole("button", { name: "Copy week", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Week copied", exact: true }),
    ).toBeVisible();
    const en = dates
      .map(
        (date, index) =>
          `${date.en} ${date.iso}: ${index === 0 ? "Tomaattipasta, Peruna-porkkanakeitto" : index === 1 ? "Leftovers" : "Open"}`,
      )
      .join("\n");
    expect(await readClipboard()).toBe(en);
    // An empty saved calendar can still be copied, without including unscheduled meals.
    await page.evaluate(async () => {
      const loaded = await window.korikone.load();
      const saved = await window.korikone.save({
        ...loaded.value.state,
        calendar: {},
      });
      if (!saved.ok) throw new Error(saved.error);
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Meal schedule", exact: true })
      .click();
    await page.getByRole("button", { name: "Copy week", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Week copied", exact: true }),
    ).toBeVisible();
    expect(await readClipboard()).toBe(
      dates.map((date) => `${date.en} ${date.iso}: Open`).join("\n"),
    );
  } finally {
    await app.close();
  }
});
