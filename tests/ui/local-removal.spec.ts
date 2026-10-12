import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("removing a row and a meal in the list is immediate, keeps other prices and reads nothing", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-removal-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.evaluate(async () => {
      const api = window.korikone;
      // The start button's own save may still be landing; save against the settled revision.
      let saved = { ok: false, error: "draftStale" } as Awaited<
        ReturnType<typeof api.save>
      >;
      for (let i = 0; i < 20 && !saved.ok; i++) {
        const state = (await api.load()).value.state;
        saved = await api.save({
          ...state,
          staples: [],
          meals: [
            {
              id: "m-pasta",
              recipeId: "pasta",
              day: 0,
              servings: 4,
              leftovers: false,
            },
            {
              id: "m-soup",
              recipeId: "soup",
              day: 1,
              servings: 4,
              leftovers: false,
            },
          ],
          extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
        });
      }
      if (!saved.ok) throw new Error(saved.error);
    });
    await page.reload();
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    const before = await load();
    expect(before.quotedAt).not.toBeNull();
    const total = (id: string, snapshot: typeof before) =>
      snapshot.basket.find((l) => l.requirement.id === id)?.total ?? null;
    const list = page.getByRole("complementary");

    await list
      .getByRole("button", { name: "Poista: Maito", exact: true })
      .click();
    await expect(
      list.getByRole("button", { name: "Poista: Maito", exact: true }),
    ).toHaveCount(0);
    const afterRow = await load();
    expect(afterRow.state.removed).toEqual(["milk:ml"]);
    expect(afterRow.quotedAt).toBe(before.quotedAt);
    expect(afterRow.developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
    for (const id of ["pasta", "tomato", "potato", "cream"])
      expect(total(id, afterRow)).toBe(total(id, before));

    // The soup goes: its rows leave, the pasta rows keep their prices, and nothing is searched.
    await page
      .locator("article", { hasText: "Peruna-porkkanakeitto" })
      .getByRole("button", { name: "Poista", exact: true })
      .click();
    await expect(
      list.getByRole("button", { name: "Poista: Peruna", exact: true }),
    ).toHaveCount(0);
    const afterMeal = await load();
    expect(afterMeal.state.meals.map((m) => m.id)).toEqual(["m-pasta"]);
    expect(afterMeal.basket.map((l) => l.requirement.id).sort()).toEqual([
      "pasta",
      "tomato",
    ]);
    expect(total("pasta", afterMeal)).toBe(total("pasta", before));
    expect(afterMeal.quotedAt).toBe(before.quotedAt);
    expect([
      afterMeal.developmentCatalogueRequests -
        before.developmentCatalogueRequests,
      afterMeal.developmentRequests,
      afterMeal.developmentStoreWrites,
    ]).toEqual([0, 0, 0]);
    expect(afterMeal.editUndoAvailable).toBe(true);

    // Marking a row at home is local as well.
    const home = list.getByRole("button", {
      name: "Löytyy kotoa: Pasta",
      exact: true,
    });
    await page.mouse.move(0, 0);
    const beforeHover = await home.boundingBox();
    await home.hover();
    await expect(home.locator("..").locator(".home-help")).toBeVisible();
    // Help is out of flow: showing it cannot move the actual pointer target.
    expect(await home.boundingBox()).toEqual(beforeHover);
    await home.click();
    await expect
      .poll(async () => (await load()).state.skipped)
      .toEqual(["pasta:g"]);
    expect((await load()).developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );

    // After a restart the list and its remaining price are as they were left.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = (await page.evaluate(() => window.korikone.load())).value;
    expect(restarted.state.meals.map((m) => m.id)).toEqual(["m-pasta"]);
    expect(restarted.basket.map((l) => l.requirement.id)).toEqual(["tomato"]);
    expect(restarted.quotedAt).toBe(before.quotedAt);
    expect(restarted.developmentCatalogueRequests).toBe(0);
  } finally {
    await app.close();
  }
});
