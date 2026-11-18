import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("a saved recipe goes on this week's list from Reseptit at household portions (B7.5)", async () => {
  const path = await mkdtemp(join(tmpdir(), "korikone-recipe-add-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = path;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByRole("button", { name: "Reseptit", exact: true }).click();
    const card = page.locator(".recipe-grid article").first();
    const name = (await card.locator("h2").textContent())!;
    await expect(card.locator(".recipe-on-list")).toHaveCount(0);
    await card
      .getByRole("button", { name: `Lisää ostoslistalle: ${name}` })
      .click();
    await expect(card.locator(".recipe-on-list")).toHaveText("Listalla");
    const { state } = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    const recipe = state.recipes.find(
      (r: { name: string }) => r.name === name,
    )!;
    const meals = state.meals.filter(
      (m: { recipeId: string }) => m.recipeId === recipe.id,
    );
    expect(meals).toHaveLength(1);
    expect(meals[0].servings).toBe(state.household.servings);
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(
      page.locator(".meal-card, article", { hasText: name }).first(),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
