import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-context-ui-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await page
    .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
    .click();
  await expect(page.getByText(/Viimeksi haetut hinnat/)).toBeVisible();
  return { app, page };
}

test("header selectors cancel, search, confirm and preserve the typed note without AI requests", async () => {
  const { app, page } = await launch();
  try {
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Nakkikeitto, edited but not applied");
    const before = await load();
    const store = page.getByRole("button", { name: /Vaihda kauppaa/ });
    const fulfillment = page.getByRole("button", {
      name: /Vaihda toimitustapaa/,
    });
    await store.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog", {
      name: "Vaihda kauppaa",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Etsi", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(store).toBeFocused();
    await fulfillment.click();
    dialog = page.getByRole("dialog", {
      name: "Vaihda toimitustapaa",
      exact: true,
    });
    await expect(
      dialog.getByRole("radio", { name: "Toimitus", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("radio", { name: "Toimitus", exact: true }).check();
    await dialog.getByRole("button", { name: "Peruuta", exact: true }).click();
    await expect(fulfillment).toBeFocused();
    expect((await load()).state).toEqual(before.state);
    expect((await load()).basket).toEqual(before.basket);
    expect((await load()).developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
    expect((await load()).developmentRequests).toBe(0);
    await store.click();
    dialog = page.getByRole("dialog", { name: "Vaihda kauppaa", exact: true });
    const search = dialog.getByRole("textbox", {
      name: "Etsi kauppa",
      exact: true,
    });
    await expect(search).toBeEnabled();
    await search.fill("no-results");
    await search.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText(
      "Kauppoja ei löytynyt.",
    );
    await search.fill("search-error");
    await search.press("Enter");
    await expect(dialog.getByRole("alert")).toContainText(
      "Kauppojen haku epäonnistui",
    );
    await search.fill("alternate");
    await dialog.getByRole("button", { name: "Etsi", exact: true }).click();
    await dialog
      .getByRole("radio", {
        name: "S-kaupat · Alternate (fixture)",
        exact: true,
      })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Vahvista valinta", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Vahvista valinta", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(store).toContainText("S-kaupat · Alternate");
    await expect(store).toBeFocused();
    await expect(note).toHaveValue("Nakkikeitto, edited but not applied");
    const switched = await load();
    expect(switched.state.meals).toEqual(before.state.meals);
    expect(switched.state.note).toBe(before.state.note);
    expect(switched.pickupFee).toEqual({ min: 390, max: 590 });
    expect(switched.developmentCatalogueRequests).toBeGreaterThan(
      before.developmentCatalogueRequests,
    );
    expect(switched.developmentRequests).toBe(0);
    await fulfillment.click();
    dialog = page.getByRole("dialog", {
      name: "Vaihda toimitustapaa",
      exact: true,
    });
    const delivery = dialog.getByRole("radio", {
      name: "Toimitus",
      exact: true,
    });
    await expect(delivery).toBeEnabled();
    await delivery.focus();
    await page.keyboard.press("Space");
    await dialog
      .getByRole("button", { name: "Vahvista valinta", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect((await load()).state.context.fulfillment).toBe("delivery");
    expect((await load()).pickupFee).toBeNull();
    expect((await load()).developmentRequests).toBe(0);
    await expect(note).toHaveValue("Nakkikeitto, edited but not applied");
    await page.getByLabel("Kieli", { exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await page.getByRole("button", { name: /Change fulfillment/ }).click();
    dialog = page.getByRole("dialog", {
      name: "Change fulfillment",
      exact: true,
    });
    await expect(
      dialog.getByRole("radio", { name: "Pickup", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: "test-results/context-selector-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 720, height: 900 });
    await page.screenshot({
      path: "test-results/context-selector-narrow.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await app.close();
  }
});

test("unavailable fulfillment and adapter errors keep the current selection and offer retry", async () => {
  const { app, page } = await launch();
  try {
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    await page.getByRole("button", { name: /Vaihda kauppaa/ }).click();
    let dialog = page.getByRole("dialog", {
      name: "Vaihda kauppaa",
      exact: true,
    });
    const search = dialog.getByRole("textbox", {
      name: "Etsi kauppa",
      exact: true,
    });
    await expect(search).toBeEnabled();
    await search.fill("pickup-only");
    await search.press("Enter");
    await dialog
      .getByRole("radio", {
        name: "S-kaupat · Pickup only (fixture)",
        exact: true,
      })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Vahvista valinta", exact: true }),
    ).toBeEnabled();
    const before = await load();
    await dialog
      .getByRole("radio", {
        name: "K-Ruoka · Pickup only (fixture)",
        exact: true,
      })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Vahvista valinta", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Vahvista valinta", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: /Vaihda toimitustapaa/ }).click();
    dialog = page.getByRole("dialog", {
      name: "Vaihda toimitustapaa",
      exact: true,
    });
    await expect(
      dialog.getByRole("radio", { name: "Toimitus", exact: true }),
    ).toBeDisabled();
    await expect(dialog).toContainText(
      "Osoite ja toimitusaika valitaan kaupan sivulla",
    );
    await page.keyboard.press("Escape");
    const selected = await load();
    await page.evaluate(() => window.korikone.scenario("context"));
    await page.getByRole("button", { name: /Vaihda toimitustapaa/ }).click();
    dialog = page.getByRole("dialog", {
      name: "Vaihda toimitustapaa",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "Vaihtoehtojen haku epäonnistui",
    );
    await page.evaluate(() => window.korikone.scenario("context"));
    await dialog
      .getByRole("button", { name: "Yritä uudelleen", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Peruuta", exact: true }).click();
    expect((await load()).state).toEqual(selected.state);
    expect((await load()).basket).toEqual(selected.basket);
    expect((await load()).developmentRequests).toBe(0);
    expect(selected.state.meals).toEqual(before.state.meals);
    await page.getByRole("button", { name: /Vaihda kauppaa/ }).click();
    dialog = page.getByRole("dialog", { name: "Vaihda kauppaa", exact: true });
    const nextSearch = dialog.getByRole("textbox", {
      name: "Etsi kauppa",
      exact: true,
    });
    await expect(nextSearch).toBeEnabled();
    await nextSearch.fill("Helsinki");
    await nextSearch.press("Enter");
    await dialog
      .getByRole("radio", { name: "K-Ruoka · Helsinki (fixture)", exact: true })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Vahvista valinta", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => window.korikone.scenario("catalogue"));
    await dialog
      .getByRole("button", { name: "Vahvista valinta", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Nykyinen kauppa ja hinnat säilyivät",
    );
    expect((await load()).state).toEqual(selected.state);
    expect((await load()).basket).toEqual(selected.basket);
    await page.evaluate(() => window.korikone.scenario("catalogue"));
    await dialog
      .getByRole("button", { name: "Vahvista valinta", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect((await load()).state.context.storeId).toBe("demo-helsinki");
    expect((await load()).developmentRequests).toBe(0);
    const beforeSettings = await load();
    await page.evaluate(() => window.korikone.scenario("context"));
    await page.getByRole("button", { name: /Vaihda toimitustapaa/ }).click();
    dialog = page.getByRole("dialog", {
      name: "Vaihda toimitustapaa",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog
      .getByRole("button", { name: "Avaa kauppojen asetukset", exact: true })
      .click();
    await expect(page.locator("#settings-section-stores")).toBeFocused();
    await expect(dialog).toHaveCount(0);
    expect((await load()).state).toEqual(beforeSettings.state);
    expect((await load()).basket).toEqual(beforeSettings.basket);
  } finally {
    await app.close();
  }
});
