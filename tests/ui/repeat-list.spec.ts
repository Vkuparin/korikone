import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const language of ["fi", "en"] as const) {
  test(`a transferred list is repeated with fresh prices, no AI request, cancellable and editable in ${language}`, async () => {
    const fi = language === "fi";
    const tr = (a: string, b: string) => (fi ? a : b);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-repeat-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      // A verified transfer of a small list, then an empty list.
      await page.evaluate(async (language) => {
        const api = window.korikone;
        await api.setLanguage(language);
        await api.signInAI();
        const state = (await api.load()).value.state;
        const saved = await api.save({
          ...state,
          staples: [],
          meals: [],
          household: { ...state.household, budget: 1_000_000 },
          extras: [
            { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
            { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
          ],
        });
        if (!saved.ok) throw new Error(saved.error);
        const built = (await api.buildBasket()).value;
        const requested = await api.transferDisplayed({
          revision: built.state.revision,
          quotedAt: built.quotedAt,
          batchKey: built.transferBatchKey,
        });
        if (!requested.ok) throw new Error(requested.error);
        const review = requested.value.review;
        const done = review
          ? await api.execute({ id: review.id, acknowledged: true })
          : requested;
        if (!done.ok) throw new Error(done.error);
        const cleared = await api.newWeek();
        if (!cleared.ok) throw new Error(cleared.error);
      }, language);
      await page.reload();
      const before = await load();
      expect(before.state.extras).toEqual([]);
      const requests = before.developmentRequests;

      // Empty list: the one contextual action, labelled as a transfer, not a purchase.
      const repeat = page.getByRole("button", {
        name: tr(
          "Toista viimeksi kauppaan siirretty lista",
          "Repeat the list last transferred to the store",
        ),
        exact: true,
      });
      await expect(repeat).toBeVisible();
      await repeat.click();
      const summary = page.locator(".repeat-summary");
      await expect(summary).toBeVisible();
      await expect(summary).toContainText(
        tr("Siirto ei ole osto", "A transfer is not a purchase"),
      );
      const repeated = await load();
      expect(repeated.state.extras.map((e) => e.id).sort()).toEqual([
        "coffee",
        "milk",
      ]);
      expect(repeated.developmentRequests).toBe(requests);
      expect(repeated.repeat).toMatchObject({ rows: 2 });
      expect(repeated.basket).toHaveLength(2);

      // A list in progress needs a confirmation, and cancelling keeps it exactly.
      await page
        .getByRole("navigation")
        .getByRole("button", { name: tr("Historia", "History"), exact: true })
        .click();
      await page
        .getByRole("button", {
          name: tr("Toista tämä lista", "Repeat this list"),
          exact: true,
        })
        .first()
        .click();
      await expect(
        page.getByText(tr("arkistoidaan", "archived")),
      ).toBeVisible();
      const stateBefore = (await load()).state;
      await page
        .getByRole("button", { name: tr("Peruuta", "Cancel"), exact: true })
        .click();
      expect((await load()).state).toEqual(stateBefore);

      // The repeated list takes an ordinary edit that targets its reused rows.
      await page
        .getByRole("navigation")
        .getByRole("button", {
          name: tr("Ostoslista", "Shopping list"),
          exact: true,
        })
        .click();
      await page
        .getByLabel(tr("Muokkaa nykyistä listaa", "Edit current list"))
        .fill(tr("poista kahvi", "remove coffee"));
      await page
        .getByRole("button", {
          name: tr("Taio muutokset", "Update my shopping list"),
          exact: true,
        })
        .click();
      await expect(page.locator(".edit-outcome > p").first()).toContainText(
        tr("Poistettu", "Removed"),
      );
      const edited = await load();
      expect(edited.state.removed).toEqual(["coffee:g"]);
      expect(edited.developmentRequests).toBe(requests + 1);
      expect(edited.developmentStoreWrites).toBe(before.developmentStoreWrites);
    } finally {
      await app.close();
    }
  });
}
