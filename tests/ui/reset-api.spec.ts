import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("New list reset runs through the real IPC, locally, and stays empty after a restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-reset-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.evaluate(async () => {
      const api = window.korikone;
      let saved = { ok: false, error: "draftStale" } as Awaited<
        ReturnType<typeof api.save>
      >;
      for (let i = 0; i < 20 && !saved.ok; i++) {
        const state = (await api.load()).value.state;
        saved = await api.save({
          ...state,
          note: "pastaa",
          meals: [
            {
              id: "m-pasta",
              recipeId: "pasta",
              day: 0,
              servings: 4,
              leftovers: false,
            },
          ],
          extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
        });
      }
      if (!saved.ok) throw new Error(saved.error);
    });
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    const before = await load();
    expect(before.quotedAt).not.toBeNull();
    const result = await page.evaluate(async (revision) => {
      const api = window.korikone;
      return {
        stale: await api.resetList({ revision: revision - 1 }),
        done: await api.resetList({ revision }),
      };
    }, before.state.revision);
    expect(result.stale).toMatchObject({ ok: false, error: "draftStale" });
    expect(result.done.ok).toBe(true);
    const empty = await load();
    expect(empty).toMatchObject({
      basket: [],
      quotedAt: null,
      pricingState: "empty",
      edit: null,
      editUndoAvailable: false,
      planning: null,
      reset: { revision: before.state.revision + 1 },
    });
    expect([empty.state.meals, empty.state.extras, empty.state.note]).toEqual([
      [],
      [],
      "",
    ]);
    expect(empty.state.recipes).toEqual(before.state.recipes);
    expect(empty.state.history[0].meals).toEqual(before.state.meals);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = await load();
    expect(restarted.state.meals).toEqual([]);
    expect(restarted.basket).toEqual([]);
    expect(restarted.reset).toBeNull();
    expect([
      restarted.developmentCatalogueRequests,
      restarted.developmentRequests,
      restarted.developmentStoreWrites,
    ]).toEqual([0, 0, 0]);
  } finally {
    await app.close();
  }
});
