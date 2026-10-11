import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const language of ["fi", "en"] as const) {
  test(`stale Remember reloads rows and a current-note override preserves memory in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-row-override-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.meals = [];
      state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.setLanguage(language);
          await window.korikone.buildBasket();
        },
        { state, language },
      );
      await page.reload();
      const fi = language === "fi";
      const row = page.locator(".grocery-row");
      await row.locator(".row-name").click();
      await row
        .getByRole("button", { name: /^(Muista tyyppi|Remember type):/ })
        .click();
      await page.setViewportSize({ width: 800, height: 600 });
      await row
        .locator(".row-memory")
        .screenshot({ path: `test-results/row-memory-${language}.png` });
      await page.evaluate(async () => {
        const current = (await window.korikone.load()).value;
        await window.korikone.save({
          ...current.state,
          household: { ...current.state.household, budget: 123 },
        });
      });
      const before = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      const remember = row.locator(".row-memory").getByRole("button", {
        name: fi ? "Muista tyyppi" : "Remember type",
        exact: true,
      });
      await remember.click();
      await expect(row.locator(".row-memory")).toContainText(
        fi ? "Lista muuttui" : "The list changed",
      );
      await expect(remember).toBeDisabled();
      const after = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(after.state.categoryPreferences).toEqual([]);
      expect(after.developmentCatalogueRequests).toBe(
        before.developmentCatalogueRequests,
      );
      await row
        .getByRole("button", { name: fi ? "Peruuta" : "Cancel", exact: true })
        .click();
      await page.evaluate(async () => {
        let current = (await window.korikone.load()).value;
        const remembered = await window.korikone.rememberCategoryPreference({
          revision: current.state.revision,
          requirementKey: "coffee:g",
          productId: "coffee",
          preference: {
            category: "coffee",
            qualifiers: [{ kind: "coffee", value: "ground" }],
            strength: "required",
          },
        });
        if (!remembered.ok) throw new Error(remembered.error);
        current = remembered.value;
        const edited = await window.korikone.editCategoryPreference({
          revision: current.state.revision,
          preference: {
            category: "coffee",
            qualifiers: [{ kind: "coffee", value: "beans" }],
            strength: "required",
          },
        });
        if (!edited.ok) throw new Error(edited.error);
        await window.korikone.signInAI();
        const planned = await window.korikone.planShopping({
          prompt: "500 g suodatinjauhettua kahvia",
          consent: true,
        });
        if (!planned.ok) throw new Error(planned.error);
        const committed = await window.korikone.commitPlanning({
          operationId: planned.value.planning!.operationId,
        });
        if (!committed.ok) throw new Error(committed.error);
      });
      await page.reload();
      await row.locator(".row-name").click();
      await expect(row).toContainText(
        fi
          ? "Nykyisen listan tarkka pyyntö ohittaa muistetun tyypin"
          : "The specific request in this list overrides the remembered type",
      );
      const overridden = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(overridden.basket[0].product?.id).toBe("coffee");
      expect(overridden.state.categoryPreferences).toEqual([
        {
          category: "coffee",
          qualifiers: [{ kind: "coffee", value: "beans" }],
          strength: "required",
        },
      ]);
      expect(overridden.developmentRequests).toBe(1);
      expect(overridden.developmentStoreWrites).toBe(0);
      await page.setViewportSize({ width: 800, height: 600 });
      await page.screenshot({
        path: `test-results/row-override-${language}.png`,
        fullPage: true,
      });
    } finally {
      await app.close();
    }
  });
  test(`row choices require explicit memory consent and retain unavailable types in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-row-preferences-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    let app = await electron.launch({ args: ["."], env });
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.meals = [];
      state.extras = [
        { id: "cream", name: "Kerma", amount: 200, unit: "ml" },
        { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
        {
          id: "missing-fixture",
          name: "Tuntematon testiruoka",
          amount: 1,
          unit: "pcs",
        },
      ];
      await page.evaluate(
        async ({ state, language }) => {
          const saved = await window.korikone.save(state);
          if (!saved.ok) throw new Error(saved.error);
          await window.korikone.setLanguage(language);
          await window.korikone.buildBasket();
        },
        { state, language },
      );
      await page.reload();
      await page.setViewportSize({ width: 800, height: 600 });
      const fi = language === "fi";
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const cream = page.locator(".grocery-row").filter({ hasText: "Kerma" });
      await cream.locator(".row-name").click();
      await cream
        .getByRole("button", {
          name: /^(Käytä kerran|Use once): Ruokakerma 2 dl$/,
        })
        .click();
      await expect
        .poll(
          async () =>
            (await load()).basket.find(
              (line) => line.requirement.id === "cream",
            )?.product?.id,
        )
        .toBe("cream");
      expect((await load()).state.categoryPreferences).toEqual([]);
      const opener = cream.getByRole("button", {
        name: /^(Muista tyyppi|Remember type): Ruokakerma 2 dl$/,
      });
      await expect(opener).toBeEnabled();
      const reads = (await load()).developmentCatalogueRequests;
      await opener.click();
      await expect(
        cream.getByLabel(fi ? "Valinnan merkitys" : "Meaning of the choice"),
      ).toBeFocused();
      await cream
        .getByRole("button", { name: fi ? "Peruuta" : "Cancel", exact: true })
        .click();
      await expect(opener).toBeFocused();
      expect((await load()).state.categoryPreferences).toEqual([]);
      expect((await load()).developmentCatalogueRequests).toBe(reads);
      await opener.click();
      await cream
        .getByLabel(fi ? "Valinnan merkitys" : "Meaning of the choice")
        .selectOption("required");
      await cream
        .locator(".row-memory")
        .getByRole("button", {
          name: fi ? "Muista tyyppi" : "Remember type",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await load()).state.categoryPreferences.length)
        .toBe(1);
      expect((await load()).state.categoryPreferences[0]).toMatchObject({
        category: "cream",
        strength: "required",
      });
      await page
        .locator(".grocery-row")
        .filter({ hasText: "Kahvi" })
        .locator(".row-name")
        .click();
      const coffee = page.locator(".grocery-row").filter({ hasText: "Kahvi" });
      await coffee
        .getByRole("button", { name: /^(Muista tyyppi|Remember type):/ })
        .click();
      await coffee
        .locator(".row-memory")
        .getByRole("button", {
          name: fi ? "Muista tyyppi" : "Remember type",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await load()).state.categoryPreferences.length)
        .toBe(2);
      await page.evaluate(async () => {
        const current = (await window.korikone.load()).value;
        await window.korikone.editCategoryPreference({
          revision: current.state.revision,
          preference: {
            category: "coffee",
            qualifiers: [{ kind: "coffee", value: "beans" }],
            strength: "preferred",
          },
        });
      });
      await page.reload();
      const unresolved = page
        .locator(".grocery-row")
        .filter({ hasText: "Kahvi" });
      await expect(unresolved).toContainText(
        fi
          ? "Muistettua suosittua tyyppiä ei löytynyt"
          : "The remembered preferred type was not found",
      );
      await unresolved.locator(".row-name").click();
      await unresolved
        .getByRole("button", {
          name: /^(Käytä kerran|Use once): Kahvi suodatinjauhatus 500 g$/,
        })
        .click();
      await expect
        .poll(
          async () =>
            (await load()).basket.find(
              (line) => line.requirement.id === "coffee",
            )?.product?.id,
        )
        .toBe("coffee");
      expect(
        (await load()).state.categoryPreferences.find(
          (rule) => rule.category === "coffee",
        )?.qualifiers,
      ).toEqual([{ kind: "coffee", value: "beans" }]);
      await page.evaluate(async () => {
        const current = (await window.korikone.load()).value;
        await window.korikone.editCategoryPreference({
          revision: current.state.revision,
          preference: {
            category: "coffee",
            qualifiers: [{ kind: "coffee", value: "beans" }],
            strength: "required",
          },
        });
      });
      await page.reload();
      const rejected = page
        .locator(".grocery-row")
        .filter({ hasText: "Kahvi" });
      await rejected.locator(".row-name").click();
      await expect(
        rejected.getByRole("button", {
          name: /^(Käytä kerran|Use once): Kahvi suodatinjauhatus 500 g$/,
        }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          window.korikone.accept({
            ingredientId: "coffee",
            productId: "coffee",
          }),
        ),
      ).toEqual({ ok: false, error: "unresolved" });
      const missing = page
        .locator(".grocery-row")
        .filter({ hasText: "Tuntematon testiruoka" });
      await missing.locator(".row-name").click();
      await expect(missing.locator(".candidate")).toHaveCount(0);
      expect((await load()).developmentRequests).toBe(0);
      expect((await load()).developmentStoreWrites).toBe(0);
      await app.close();
      app = await electron.launch({ args: ["."], env });
      page = await app.firstWindow();
      const restarted = await load();
      expect(restarted.state.categoryPreferences).toHaveLength(2);
      expect(
        restarted.basket.find((line) => line.requirement.id === "coffee")
          ?.product,
      ).toBeNull();
      expect(restarted.developmentCatalogueRequests).toBe(0);
    } finally {
      await app.close();
    }
  });
}
