import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("real memory IPC requires explicit actions, restores an unavailable Required type and keeps Forget/Reset local", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-preferences-ui-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.buildBasket();
    }, state);
    await page.reload();
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    const before = await load();
    const remembered = await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      return window.korikone.rememberCategoryPreference({
        revision: current.state.revision,
        requirementKey: "coffee:g",
        productId: "coffee",
        preference: {
          category: "coffee",
          qualifiers: [{ kind: "coffee", value: "ground" }],
          strength: "required",
        },
      });
    });
    expect(remembered.ok).toBe(true);
    expect(remembered.value.state.categoryPreferences).toEqual([
      {
        category: "coffee",
        qualifiers: [{ kind: "coffee", value: "ground" }],
        strength: "required",
      },
    ]);
    const ordinary = await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      return window.korikone.save({
        ...current.state,
        categoryPreferences: [],
      });
    });
    expect(ordinary).toEqual({ ok: false, error: "preferenceActionRequired" });
    const edited = await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      return window.korikone.editCategoryPreference({
        revision: current.state.revision,
        preference: {
          category: "coffee",
          qualifiers: [{ kind: "coffee", value: "beans" }],
          strength: "required",
        },
      });
    });
    expect(edited.ok).toBe(true);
    expect(edited.value.basket[0].product).toBeNull();
    await page.reload();
    await expect(page.locator(".grocery-row")).toHaveClass(/unresolved/);
    const rejected = await page.evaluate(() =>
      window.korikone.accept({ ingredientId: "coffee", productId: "coffee" }),
    );
    expect(rejected).toEqual({ ok: false, error: "unresolved" });
    const stale = await page.evaluate(
      (revision) => window.korikone.resetCategoryPreferences({ revision }),
      before.state.revision,
    );
    expect(stale).toEqual({ ok: false, error: "draftStale" });
    const saved = await load();
    expect(saved.developmentRequests).toBe(0);
    expect(saved.developmentStoreWrites).toBe(0);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restored = await load();
    expect(restored.state.categoryPreferences).toEqual(
      saved.state.categoryPreferences,
    );
    expect(restored.basket).toEqual(saved.basket);
    expect(restored.developmentCatalogueRequests).toBe(0);
    await expect(page.locator(".grocery-row")).toHaveClass(/unresolved/);
    const forgotten = await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      return window.korikone.forgetCategoryPreference({
        revision: current.state.revision,
        category: "coffee",
      });
    });
    expect(forgotten.ok).toBe(true);
    expect(forgotten.value.state.categoryPreferences).toEqual([]);
    expect(forgotten.value.basket[0].product?.id).toBe("coffee");
    await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      await window.korikone.rememberCategoryPreference({
        revision: current.state.revision,
        requirementKey: "coffee:g",
        productId: "coffee",
        preference: {
          category: "coffee",
          qualifiers: [{ kind: "coffee", value: "ground" }],
          strength: "preferred",
        },
      });
      const updated = (await window.korikone.load()).value;
      await window.korikone.resetCategoryPreferences({
        revision: updated.state.revision,
      });
    });
    const final = await load();
    expect(final.state.categoryPreferences).toEqual([]);
    expect(final.developmentRequests).toBe(0);
    expect(final.developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});
