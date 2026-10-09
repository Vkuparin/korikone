import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("calendar moves meals by drag and keyboard, saves leftovers and survives restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-calendar-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    state.meals = [
      {
        id: "meal-pasta",
        recipeId: "pasta",
        day: 0,
        servings: 4,
        leftovers: false,
      },
      {
        id: "meal-soup",
        recipeId: "soup",
        day: 0,
        servings: 4,
        leftovers: false,
      },
      {
        id: "old-leftovers",
        recipeId: "pasta",
        day: 0,
        servings: 4,
        leftovers: true,
      },
    ];
    // Saved references to removed meals must not become visible calendar cards.
    const today = await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });
    state.calendar = {
      [today]: { mealIds: ["removed-meal"], leftovers: false },
    };
    await page.evaluate(async (state) => {
      const saved = await window.korikone.save(state);
      if (!saved.ok) throw new Error(saved.error);
    }, state);
    await page.reload();
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await expect(page.locator(".shopping-total .warning")).toHaveCount(0);
    const total = await page
      .locator(".shopping-total strong")
      .first()
      .textContent();
    const before = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    await page
      .getByRole("button", { name: "Viikkosuunnitelma", exact: true })
      .click();
    const days = page.locator(".calendar-day");
    await expect(days).toHaveCount(7);
    await expect(page.locator(".calendar-meal")).toHaveCount(2);
    await days.nth(0).evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-korikone-meal", "removed-meal");
      element.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    });
    expect(
      (await page.evaluate(async () => (await window.korikone.load()).value))
        .state.calendar,
    ).toEqual(before.state.calendar);
    const pasta = page.getByRole("button", {
      name: "Tomaattipasta 4 annosta",
      exact: true,
    });
    const soup = page.getByRole("button", {
      name: "Peruna-porkkanakeitto 4 annosta",
      exact: true,
    });
    await pasta.dragTo(days.nth(1));
    await expect(
      days.nth(1).getByRole("button", { name: "Tomaattipasta 4 annosta" }),
    ).toBeVisible();
    await pasta.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      days.nth(2).getByRole("button", { name: "Tomaattipasta 4 annosta" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(
      days.nth(1).getByRole("button", { name: "Tomaattipasta 4 annosta" }),
    ).toBeFocused();
    await soup.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      days
        .nth(0)
        .getByRole("button", { name: "Peruna-porkkanakeitto 4 annosta" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(
      days
        .nth(0)
        .getByRole("button", { name: "Peruna-porkkanakeitto 4 annosta" }),
    ).toBeFocused();
    await days.nth(3).getByRole("checkbox", { name: "Tähteitä" }).click();
    await expect(days.nth(3).getByRole("checkbox")).toBeChecked();
    await expect(days.nth(3).getByRole("checkbox")).toBeEnabled();
    await page.screenshot({
      path: "test-results/calendar-desktop.png",
      fullPage: true,
    });
    const saved = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(saved.state.meals).toEqual(before.state.meals);
    expect(saved.state.revision).toBe(before.state.revision);
    expect(saved.basket).toEqual(before.basket);
    expect(saved.state.calendar).not.toEqual(before.state.calendar);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await expect(page.locator(".shopping-total strong").first()).toHaveText(
      total!,
    );
    await page
      .getByRole("button", { name: "Viikkosuunnitelma", exact: true })
      .click();
    await expect(
      page
        .locator(".calendar-day")
        .nth(1)
        .getByRole("button", { name: "Tomaattipasta 4 annosta" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".calendar-day")
        .nth(3)
        .getByRole("checkbox", { name: "Tähteitä" }),
    ).toBeChecked();
    expect(
      (await page.evaluate(async () => (await window.korikone.load()).value))
        .state.calendar,
    ).toEqual(saved.state.calendar);
    await page.getByLabel("Kieli", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("heading", { name: "Meal schedule" }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Leftovers" })).toHaveCount(
      7,
    );
    const restartedPasta = page.getByRole("button", {
      name: "Tomaattipasta 4 portions",
      exact: true,
    });
    await restartedPasta.focus();
    await page.keyboard.press("Delete");
    await expect(
      page
        .locator(".calendar-unscheduled")
        .getByRole("button", { name: "Tomaattipasta 4 portions" }),
    ).toBeFocused();
  } finally {
    await app.close();
  }
});
