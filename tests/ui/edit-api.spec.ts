import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("edit and undo APIs change the saved list atomically and survive a restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-edit-api-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    const planned = await page.evaluate(async () => {
      const signedIn = await window.korikone.signInAI();
      if (!signedIn.ok) throw new Error(signedIn.error);
      const state = signedIn.value.state;
      const saved = await window.korikone.save({
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
      if (!saved.ok) throw new Error(saved.error);
      return saved.value;
    });
    expect(planned.quotedAt).not.toBeNull();
    expect(planned.editUndoAvailable).toBe(false);
    const revision = planned.state.revision;
    const searches = planned.developmentCatalogueRequests;

    // Opening nothing and sending nothing: an invalid or stale request reaches no model.
    for (const invalid of [
      { revision, instruction: "tuplaa keitto", consent: false },
      { revision, instruction: " ", consent: true },
      { revision: revision - 1, instruction: "tuplaa keitto", consent: true },
      { revision, instruction: "tuplaa keitto", consent: true, model: "x" },
    ]) {
      const result = await page.evaluate(
        (request) => window.korikone.editList(request),
        invalid,
      );
      expect(result.ok).toBe(false);
    }
    expect(
      (await page.evaluate(() => window.korikone.load())).value
        .developmentRequests,
    ).toBe(0);

    const asked = await page.evaluate(
      (request) => window.korikone.editList(request),
      { revision, instruction: "poista tämä", consent: true },
    );
    expect(asked.ok).toBe(true);
    expect(asked.value.edit).toMatchObject({
      status: "clarification",
      unsupported: ["poista tämä"],
    });
    expect(asked.value.state).toEqual(planned.state);

    const edited = await page.evaluate(
      (request) => window.korikone.editList(request),
      {
        revision,
        instruction: "tuplaa keitto, lisää 2 tölkkiä maitoa ja poista tämä",
        focusTargetId: "row:pasta:g",
        consent: true,
      },
    );
    expect(edited.ok).toBe(true);
    const after = edited.value;
    expect(after.state.revision).toBe(revision + 1);
    expect(after.state.meals[1].servings).toBe(8);
    expect(after.state.removed).toEqual(["pasta:g"]);
    expect(after.state.extras[0]).toMatchObject({ id: "milk", amount: 3000 });
    expect(after.edit).toMatchObject({
      status: "applied",
      applied: [
        { op: "changeServings", targetId: "meal:m-soup" },
        { op: "addItem", targetId: "row:milk:ml", before: 1000, after: 3000 },
        { op: "removeItem", targetId: "row:pasta:g" },
      ],
      delta: { price: { status: "exact" } },
    });
    expect(after.editUndoAvailable).toBe(true);
    // One request for the clarification and one for the applied edit; none was repaired.
    expect(
      (await page.evaluate(() => window.korikone.load())).value
        .developmentRequests,
    ).toBe(2);
    expect(after.developmentStoreWrites).toBe(0);
    // Tomato was not read again; only the changed rows were.
    const tomato = (snapshot: typeof after) =>
      snapshot.basket.find((line) => line.requirement.id === "tomato");
    expect(tomato(after)).toEqual(tomato(planned));
    expect(after.quotedAt).toBe(planned.quotedAt);
    expect(after.developmentCatalogueRequests).toBeGreaterThan(searches);

    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = (await page.evaluate(() => window.korikone.load())).value;
    expect(restarted.state).toEqual(after.state);
    expect(restarted.editUndoAvailable).toBe(true);
    expect(restarted.edit).toMatchObject({ status: "applied" });
    const undone = await page.evaluate(
      (revision) => window.korikone.undoEdit({ revision }),
      restarted.state.revision,
    );
    expect(undone.ok).toBe(true);
    expect(undone.value.state).toEqual({
      ...planned.state,
      revision: revision + 2,
    });
    expect(undone.value.basket).toEqual(planned.basket);
    expect(undone.value.editUndoAvailable).toBe(false);
    expect(undone.value.developmentCatalogueRequests).toBe(0);
    expect(undone.value.developmentRequests).toBe(0);
    expect(undone.value.developmentStoreWrites).toBe(0);
    const again = await page.evaluate(
      (revision) => window.korikone.undoEdit({ revision }),
      undone.value.state.revision,
    );
    expect(again).toMatchObject({ ok: false, error: "undoUnavailable" });
  } finally {
    await app.close();
  }
});

test("a plain list of dishes and groceries adds to the current list through real IPC, in both languages", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-edit-list-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    const run = (instruction: string) =>
      page.evaluate(async (instruction) => {
        const api = window.korikone;
        const state = (await api.load()).value.state;
        return api.editList({
          revision: state.revision,
          instruction,
          consent: true,
        });
      }, instruction);
    const empty = await page.evaluate(async () => {
      const api = window.korikone;
      await api.signInAI();
      const state = (await api.load()).value.state;
      const saved = await api.save({ ...state, staples: [] });
      return saved.value;
    });
    expect(empty.state.meals).toEqual([]);
    // The owner's prompt on an empty list.
    const first = await run(
      "Lihamakaronilaatikko, siskonmakkarakeitto, kaksi litraa kevytmaitoa, litra vaniljajäätelöä",
    );
    expect(first.ok).toBe(true);
    expect(first.value.edit).toMatchObject({
      status: "applied",
      applied: [
        { op: "addMeal", name: "Makaronilaatikko" },
        { op: "addMeal", name: "Siskonmakkarakeitto" },
        { op: "setItem", name: "Kevytmaito", after: 2000 },
        { op: "setItem", name: "Vaniljajäätelö", after: 1000 },
      ],
    });
    expect(first.value.state.meals).toHaveLength(2);
    // In English on the now non-empty list: one more dish, a stated amount and an explicit addition.
    const second = await run("chicken pasta, 500 g coffee, add 1 l kevytmaito");
    expect(second.ok).toBe(true);
    expect(second.value.edit).toMatchObject({
      applied: [
        { op: "addMeal", name: "Kanapasta" },
        { op: "setItem", name: "Kahvi", after: 500 },
        { op: "addItem", name: "Kevytmaito", before: 2000, after: 3000 },
      ],
    });
    expect(second.value.state.meals).toHaveLength(3);
    // The earlier dishes and the ice cream are all still there.
    expect(
      second.value.state.extras.map((i) => [i.name, i.amount]).sort(),
    ).toEqual(
      [
        ["Kahvi", 500],
        ["Kevytmaito", 3000],
        ["Vaniljajäätelö", 1000],
      ].sort(),
    );
    // Repeating the first prompt now changes the milk back to the stated two litres only.
    const again = await run(
      "Lihamakaronilaatikko, siskonmakkarakeitto, kaksi litraa kevytmaitoa, litra vaniljajäätelöä",
    );
    expect(again.value.edit).toMatchObject({
      applied: [{ op: "changeQuantity", name: "Kevytmaito", after: 2000 }],
    });
    expect(again.value.state.meals).toHaveLength(3);
    const counts = (await page.evaluate(() => window.korikone.load())).value;
    expect(counts.developmentRequests).toBe(3);
    expect(counts.developmentStoreWrites).toBe(0);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = (await page.evaluate(() => window.korikone.load())).value;
    expect(restarted.state.meals).toHaveLength(3);
    const undone = await page.evaluate(
      (revision) => window.korikone.undoEdit({ revision }),
      restarted.state.revision,
    );
    expect(
      undone.value.state.extras.find((i) => i.name === "Kevytmaito"),
    ).toBeDefined();
  } finally {
    await app.close();
  }
});
