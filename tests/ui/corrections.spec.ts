import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("real correction IPC saves quantity and unresolved holds across SQLite restart without external calls", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-correction-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.staples = [];
    state.extras = [
      { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
      { id: "pasta", name: "Makaroni", amount: 400, unit: "g" },
    ];
    await page.evaluate(async (state) => {
      const saved = await window.korikone.save(state);
      if (!saved.ok) throw new Error(saved.error);
      await window.korikone.buildBasket();
    }, state);
    const approval = await page.evaluate(() => window.korikone.prepare());
    expect(approval.ok).toBe(true);
    const before = (await page.evaluate(() => window.korikone.load())).value;
    expect(before.review).not.toBeNull();
    const corrected = await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      return window.korikone.correctRow({
        revision: current.state.revision,
        requirementKey: "milk:ml",
        reason: "wrong-quantity",
        amount: 2300,
      });
    });
    expect(corrected.ok).toBe(true);
    expect(corrected.value.review).toBeNull();
    expect(corrected.value.basket[0]).toMatchObject({
      requirement: { amount: 2300 },
      packs: 3,
      total: 357,
    });
    expect(corrected.value.basket[1]).toEqual(before.basket[1]);
    const held = await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      return window.korikone.correctRow({
        revision: current.state.revision,
        requirementKey: "milk:ml",
        reason: "wrong-product-type",
        replacementProductId: null,
      });
    });
    expect(held.ok).toBe(true);
    expect(held.value.basket[0].product).toBeNull();
    expect(held.value.developmentCatalogueRequests).toEqual(
      before.developmentCatalogueRequests,
    );
    await page.reload();
    await expect(
      page.locator(".grocery-row").filter({ hasText: "Maito" }),
    ).toHaveClass(/unresolved/);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restored = (await page.evaluate(() => window.korikone.load())).value;
    expect(restored.basket[0]).toMatchObject({
      product: null,
      requirement: { amount: 2300 },
      matching: { reason: "owner-correction" },
    });
    expect(restored.state.categoryPreferences).toEqual([]);
    const stale = await page.evaluate(
      (revision) =>
        window.korikone.correctRow({
          revision,
          requirementKey: "milk:ml",
          reason: "wrong-quantity",
          amount: 1000,
        }),
      before.state.revision,
    );
    expect(stale).toEqual({ ok: false, error: "draftStale" });
    const cleared = await page.evaluate(async () => {
      const current = (await window.korikone.load()).value;
      return window.korikone.correctRow({
        revision: current.state.revision,
        requirementKey: "milk:ml",
        reason: "unsuitable-alternative",
        replacementProductId: "milk",
      });
    });
    expect(cleared.ok).toBe(true);
    expect(cleared.value.basket[0].product?.id).toBe("milk");
    expect(cleared.value.developmentRequests).toBe(0);
    expect(cleared.value.developmentStoreWrites).toBe(0);
    const fresh = await page.evaluate(() => window.korikone.newWeek());
    expect(fresh.ok).toBe(true);
    expect(fresh.value.state.correctionHolds).toEqual([]);
    expect(fresh.value.state.correctionChoices).toEqual([]);
    expect(Object.values(fresh.value.state.accepted)).not.toContainEqual([
      "milk",
    ]);
  } finally {
    await app.close();
  }
});
