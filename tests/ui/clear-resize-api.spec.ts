import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("clear list and household size run through the real IPC, locally, and survive a restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-clear-"));
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
              servings: 6,
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
    const amount = (id: string, snapshot: typeof before) =>
      snapshot.basket.find((l) => l.requirement.id === id)?.requirement.amount;

    // Household size: preview, apply, refuse a stale or invalid request.
    const result = await page.evaluate(async (revision) => {
      const api = window.korikone;
      return {
        preview: await api.previewHouseholdSize({ servings: 2 }),
        invalid: await api.setHouseholdSize({ revision, servings: 0 }),
        stale: await api.setHouseholdSize({
          revision: revision - 1,
          servings: 2,
        }),
        applied: await api.setHouseholdSize({ revision, servings: 2 }),
      };
    }, before.state.revision);
    expect(result.preview).toMatchObject({
      ok: true,
      value: {
        from: 4,
        to: 2,
        scaled: [{ mealId: "m-pasta", before: 4, after: 2 }],
        kept: [{ mealId: "m-soup", servings: 6 }],
      },
    });
    expect(result.invalid.ok).toBe(false);
    expect(result.stale).toMatchObject({ ok: false, error: "draftStale" });
    expect(result.applied.ok).toBe(true);
    const resized = await load();
    expect(resized.state.household.servings).toBe(2);
    expect(resized.state.meals.map((m) => m.servings)).toEqual([2, 6]);
    expect(amount("pasta", resized)).toBe(amount("pasta", before)! / 2);
    expect(amount("potato", resized)).toBe(amount("potato", before));
    expect(amount("milk", resized)).toBe(1000);
    expect(resized.edit).toMatchObject({ status: "resized" });
    expect(resized.quotedAt).toBe(before.quotedAt);

    // Clear list, then restart: the list stays empty and the undo is still offered.
    const cleared = await page.evaluate(
      (revision) => window.korikone.clearList({ revision }),
      resized.state.revision,
    );
    expect(cleared.ok).toBe(true);
    const empty = await load();
    expect([empty.state.meals, empty.state.extras, empty.basket]).toEqual([
      [],
      [],
      [],
    ]);
    expect(empty.state.recurringPaused).toBe(true);
    expect(empty.state.household.servings).toBe(2);
    expect(empty.state.recipes).toEqual(before.state.recipes);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = await load();
    expect(restarted.state.meals).toEqual([]);
    expect(restarted.basket).toEqual([]);
    expect(restarted.editUndoAvailable).toBe(true);
    const undone = await page.evaluate(
      (revision) => window.korikone.undoEdit({ revision }),
      restarted.state.revision,
    );
    expect(undone.ok).toBe(true);
    const back = await load();
    expect(back.state.meals.map((m) => m.id)).toEqual(["m-pasta", "m-soup"]);
    expect(back.state.recurringPaused).toBe(false);
    expect(back.quotedAt).toBe(before.quotedAt);
    expect([
      back.developmentCatalogueRequests,
      back.developmentRequests,
      back.developmentStoreWrites,
    ]).toEqual([0, 0, 0]);
  } finally {
    await app.close();
  }
});
