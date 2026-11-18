import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withTransfer(
  language: "en" | "fi",
  placed: boolean,
  run: (page: Page) => Promise<void>,
) {
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
    await page.evaluate(
      async ({ language, placed }) => {
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
        const next = placed ? await api.confirmPurchase() : await api.newWeek();
        if (!next.ok) throw new Error(next.error);
      },
      { language, placed },
    );
    await page.reload();
    await run(page);
  } finally {
    await app.close();
  }
}

test("choose groceries from a placed order, adjust packs and finish in the AI field", async () => {
  await withTransfer("en", true, async (page) => {
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    const before = await load();
    const note = page.getByLabel("Edit current list");
    await note.fill("add apples tomorrow");
    await page.getByRole("button", { name: "History", exact: true }).click();
    const card = page
      .getByRole("article")
      .filter({ hasText: "Order marked as placed" });
    const choose = card.getByRole("button", {
      name: "Choose items from this order",
    });
    await choose.click();
    const start = card.getByRole("button", {
      name: "Start list with selected items",
    });
    await expect(start).toBeDisabled();
    await expect(card.getByRole("checkbox").first()).toBeFocused();
    await card.getByRole("checkbox", { name: /Kahvi/ }).check();
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(choose).toBeFocused();
    expect((await load()).state).toEqual(before.state);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    await expect(note).toHaveValue("add apples tomorrow");
    await page.getByRole("button", { name: "History", exact: true }).click();
    await choose.click();
    await card.getByRole("checkbox", { name: /Kahvi/ }).check();
    await start.click();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue("");
    await expect(page.locator(".repeat-summary")).toContainText(
      "Groceries from your order",
    );
    await page
      .getByRole("button", { name: "Adjust quantities on the list" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Shopping list · 1" }),
    ).toBeFocused();
    const coffee = page.locator('[data-row-key="coffee:g"]');
    await coffee
      .getByRole("button", { name: "Increase: Kahvi", exact: true })
      .click();
    await expect(
      coffee
        .getByRole("group", { name: "Quantity: Kahvi" })
        .getByRole("status"),
    ).toHaveText("2 packs");
    await coffee
      .getByRole("button", { name: "Decrease: Kahvi", exact: true })
      .click();
    await expect(
      coffee
        .getByRole("group", { name: "Quantity: Kahvi" })
        .getByRole("status"),
    ).toHaveText("1 pack");
    await coffee
      .getByRole("button", { name: "Increase: Kahvi", exact: true })
      .click();
    await expect(
      coffee
        .getByRole("group", { name: "Quantity: Kahvi" })
        .getByRole("status"),
    ).toHaveText("2 packs");
    await page
      .getByRole("button", { name: "Finish the list in the AI field" })
      .click();
    await expect(note).toBeFocused();
    await note.fill("add 1 l of milk");
    expect((await load()).developmentRequests).toBe(before.developmentRequests);
    await page
      .getByRole("button", { name: "Update my shopping list", exact: true })
      .click();
    await expect(page.locator(".grocery-row")).toHaveCount(2);
    const after = await load();
    expect(
      after.basket.find((row) => row.requirement.id === "coffee")?.packs,
    ).toBe(2);
    expect(after.state.listHistory).toEqual(before.state.listHistory);
    expect(after.developmentRequests).toBe(before.developmentRequests + 1);
    expect(after.developmentStoreWrites).toBe(before.developmentStoreWrites);
    const outcome = page.locator(".edit-outcome");
    await expect(outcome).toContainText("Added Maito (1000 ml)");
    await expect(outcome.locator("p").first()).toBeFocused();
    const transfer = page.locator(".transfer-button");
    await expect(outcome).toContainText("2 products ready to send");
    await outcome.getByRole("button", { name: "Go to store transfer" }).click();
    await expect(transfer).toBeFocused();
    const undo = outcome.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toHaveAccessibleDescription(/before the last edit/);
    await undo.click();
    await expect(outcome.locator("p").first()).toBeFocused();
    await expect(outcome).toContainText(
      "Your previous shopping list is restored.",
    );
    await expect(outcome).toContainText("1 product ready to send");
    await expect(undo).toHaveCount(0);
    const restored = await load();
    expect(restored.basket).toHaveLength(1);
    expect(restored.basket[0]).toMatchObject({
      requirement: { id: "coffee" },
      packs: 2,
    });
    expect(restored.state.listHistory).toEqual(before.state.listHistory);
    expect(restored.developmentRequests).toBe(after.developmentRequests);
    expect(restored.developmentCatalogueRequests).toBe(
      after.developmentCatalogueRequests,
    );
    expect(restored.developmentStoreWrites).toBe(before.developmentStoreWrites);
    await outcome.getByRole("button", { name: "Go to store transfer" }).click();
    await expect(transfer).toBeFocused();
    await transfer.press("Enter");
    await expect(page.locator(".transfer-result.verified")).toBeVisible();
    const sent = await load();
    expect(sent.state.listHistory[0].sentGroceries).toEqual([
      expect.objectContaining({ id: "coffee", amount: 1000 }),
    ]);
    expect(sent.developmentStoreWrites).toBe(
      restored.developmentStoreWrites + 1,
    );
  });
});

test("a reused list shows each AI change and the missing product before transfer", async () => {
  await withTransfer("fi", false, async (page) => {
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await button("Toista viimeksi kauppaan siirretty lista").click();
    await expect(page.locator(".repeat-summary")).toBeVisible();
    const before = await load();
    await page
      .getByLabel("Muokkaa nykyistä listaa")
      .fill("lisää 1 l maitoa ja lisää 50 g sahramia");
    await button("Taio muutokset").click();
    const outcome = page.locator(".edit-outcome");
    const changes = outcome.locator(".edit-changes li");
    await expect(changes).toHaveCount(2);
    await expect(changes.first()).toHaveText("Maito: 1000 → 2000 ml");
    await expect(changes.last()).toContainText(/Lisätty Sahrami.*50 g/);
    const handoff = outcome.locator(".edit-handoff");
    await expect(handoff).toContainText("2 tuotetta valmiina siirtoon");
    await expect(handoff).toContainText(/Jää pois siirrosta · Sahrami/);
    const review = handoff.getByRole("button", {
      name: "Tarkista puuttuvat tuotteet",
    });
    await review.click();
    await expect(
      page.getByRole("heading", { name: "Tarkista tuotevalinnat" }),
    ).toBeFocused();
    await expect(page.locator(".review-row")).toHaveCount(1);
    await expect(page.locator(".review-row")).toContainText(/Sahrami/i);
    await button("Sulje tarkistus").click();
    await expect(review).toBeFocused();
    await outcome.getByRole("button", { name: "Kumoa", exact: true }).click();
    await expect(outcome).toContainText("Edellinen ostoslista on palautettu.");
    await expect(review).toHaveCount(0);
    const restored = await load();
    expect(restored.basket).toEqual(before.basket);
    expect(restored.developmentRequests).toBe(before.developmentRequests + 1);
    expect(restored.developmentStoreWrites).toBe(before.developmentStoreWrites);
  });
});

for (const language of ["fi", "en"] as const) {
  test(`a transferred list is repeated with fresh prices, cancellable and editable in ${language}`, async () => {
    const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
    await withTransfer(language, false, async (page) => {
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const before = await load();
      expect(before.state.extras).toEqual([]);
      const requests = before.developmentRequests;

      // The shortcut identifies an unconfirmed transfer by its source.
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
        tr("Siirretyn listan ostoksia", "Groceries from your transferred list"),
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
          name: tr("Toista koko lista", "Repeat the whole list"),
          exact: true,
        })
        .first()
        .click();
      await expect(
        page.getByText(
          tr("Tämä korvaa nykyisen listan", "This replaces your current list"),
          { exact: false },
        ),
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
    });
  });
}
