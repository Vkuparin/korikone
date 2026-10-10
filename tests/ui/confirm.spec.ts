import { approveFixtureOnion } from "./matching-helpers";
import { completeFixtureLogin } from "./store-helpers";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { settingsCategory } from "./settings-helper";
import { initialState } from "../../src/domain/model";

test("the transfer is confirmed and reported in the list column", async () => {
  test.setTimeout(120_000);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-confirm-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    if (process.env.KORIKONE_EXECUTABLE) {
      await page.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].show(),
      );
    }
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await page.getByRole("textbox").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await completeFixtureLogin(app, page);
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect(
      page.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Valmis", exact: true }).click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Makaronilaatikko");
    await note.press("Control+Enter");
    const list = page.getByRole("complementary");
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(
      "Ostoslista · 7",
      { timeout: 15000 },
    );
    await approveFixtureOnion(page);
    const bar = list.getByRole("region", { name: "Yhteensä ja siirto" });
    const transfer = bar.getByRole("button", {
      name: /^Siirrä ja avaa S-kaupat-lista/,
    });
    const panel = bar.getByRole("region", { name: "Siirron vahvistus" });
    const confirm = panel.getByRole("button", {
      name: /^Vahvista: 7 tuotetta → S-kaupat · \d+,\d\d €$/,
    });
    const setBudget = async (euros: string) => {
      await page
        .getByRole("button", { name: "Asetukset", exact: true })
        .click();
      await settingsCategory(page, "household", "Kotitalous");
      const budget = page.getByLabel("Viikkobudjetti (€)");
      await budget.fill(euros);
      await page
        .locator("form", { has: budget })
        .getByRole("button", { name: "Tallenna" })
        .click();
      await page
        .getByRole("button", { name: "Ostoslista", exact: true })
        .click();
      await expect(transfer).toBeEnabled({ timeout: 10000 });
    };

    // Over budget: the panel says so and asks for a separate acceptance.
    await setBudget("1");
    await transfer.click();
    await expect(panel).toContainText("Viikkobudjetti ylittyy");
    await expect(confirm).toBeDisabled();
    await panel.getByLabel("Hyväksyn näytetyn budjetin ylityksen.").check();
    await expect(confirm).toBeEnabled();
    await page.screenshot({ path: "test-results/transfer-decision-1280.png" });
    await panel.getByRole("button", { name: "Peru" }).click();
    await expect(panel).toHaveCount(0);
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value.journal,
      ),
    ).toBeNull();

    // The initial click approves a normal batch and opens the destination.
    await setBudget("1000");
    await transfer.click();
    await expect(
      page.getByRole("button", { name: "Kauppa", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    const result = bar.getByRole("region", { name: "Siirron tulos" });
    await expect(result.getByRole("status")).toHaveText(
      "Ostoskori päivitetty ja tarkistettu",
    );
    await expect(panel).toHaveCount(0);
    const evidence = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(evidence.developmentHandoffs).toEqual(["s-kaupat:list"]);
    await expect(result).toContainText("Oikeaa kaupan ikkunaa ei avata.");
    await expect(result).toContainText("Testatut avaukset: 1");
    await page.setViewportSize({ width: 800, height: 600 });
    await result.scrollIntoViewIfNeeded();
    await result.screenshot({ path: "test-results/transfer-result-800.png" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await result
      .getByRole("button", { name: "Avaa S-kaupat-lista uudelleen" })
      .click();
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(result).toContainText("Testatut avaukset: 2");
    const reopened = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(reopened.journal).toEqual(evidence.journal);
    expect(evidence.developmentStoreWrites).toBeGreaterThan(0);
    expect(reopened.developmentStoreWrites).toBe(
      evidence.developmentStoreWrites,
    );
    await page.evaluate(() =>
      window.korikone.developmentScenario("handoffFailed"),
    );
    await result
      .getByRole("button", { name: "Avaa S-kaupat-lista uudelleen" })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    const failedOpen = (await page.evaluate(() => window.korikone.load()))
      .value;
    expect(failedOpen.journal).toEqual(evidence.journal);
    expect(failedOpen.developmentHandoffs).toHaveLength(2);
    expect(failedOpen.developmentStoreWrites).toBe(
      evidence.developmentStoreWrites,
    );
    await page.evaluate(() => window.korikone.developmentScenario("success"));
    await result
      .getByRole("button", { name: "Avaa S-kaupat-lista uudelleen" })
      .click();
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.korikone.load())).value.journal,
    ).toEqual(evidence.journal);

    await expect(result.getByRole("status")).toHaveText(
      "Ostoskori päivitetty ja tarkistettu",
    );
    await expect(result).toContainText("7 / 7");
    await expect(
      result.getByRole("button", { name: "Avaa S-kaupat-lista uudelleen" }),
    ).toBeVisible();
    await result.getByRole("button", { name: "Sulje" }).click();
    await expect(result).toHaveCount(0);

    // A second transfer names what changed: one new, one dropped and one changed product.
    await page.getByLabel("Lisää tuote", { exact: true }).fill("Kahvi");
    await page.getByLabel("Tuotteen määrä").fill("500");
    await page.getByLabel("Tuotteen yksikkö").selectOption("g");
    await page
      .getByRole("button", { name: "Lisää tuote listaan", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Poista: Suola", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Lisää: Makaroni", exact: true })
      .click();
    await expect(transfer).toBeEnabled({ timeout: 10000 });
    await transfer.click();
    const changes = panel.locator("details", {
      hasText: "Muutokset edelliseen",
    });
    await expect(changes).toHaveAttribute("open", "");
    await expect(changes).toContainText("Uusi: Kahvi suodatinjauhatus 500 g");
    await expect(changes).toContainText(
      "Pois: JOZO 125g suola jodioitu sirotin",
    );
    await expect(changes).toContainText(
      "Määrä: Myllyn Paras Makaroni 400g 1 → 2",
    );
    await panel.getByRole("button", { name: "Peru" }).click();

    // The store raises its prices after that purchase: the next confirmation names the rise.
    await page.evaluate(async () => {
      await window.korikone.scenario("price");
      await window.korikone.buildBasket();
    });
    await page.reload();
    await expect(transfer).toBeEnabled({ timeout: 10000 });
    await transfer.click();
    await expect(panel).toContainText(
      "Hinta noussut: Myllyn Paras Makaroni 400g",
    );
    await expect(panel).toContainText("0,65 € → 0,85 €");
    // Falling back to the earlier prices is not a rise.
    await panel.getByRole("button", { name: "Peru" }).click();
    await page.evaluate(async () => {
      await window.korikone.scenario("price");
      await window.korikone.buildBasket();
    });
    await page.reload();
    await expect(transfer).toBeEnabled({ timeout: 10000 });
    await transfer.click();
    await expect(panel).not.toContainText("Hinta noussut");
  } finally {
    await app.close();
  }
});

for (const language of ["fi", "en"] as const) {
  test(`total remains separate from keyboard-focused rows in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-footer-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.meals = [];
      state.extras = Array.from({ length: 18 }, (_, i) => ({
        id: `footer-${i}`,
        name: "Kahvi",
        amount: 500,
        unit: "g" as const,
      }));
      state.extras.push({
        id: "layout-unknown-price",
        name: "layout-unknown-price",
        amount: 500,
        unit: "g",
      });
      expect(
        await page.evaluate(
          async (state) => (await window.korikone.save(state)).ok,
          state,
        ),
      ).toBe(true);
      await page.evaluate(
        (language) => window.korikone.setLanguage(language),
        language,
      );
      await page.reload();
      const rows = page.locator(".shopping-rows");
      const footer = page.getByRole("region", {
        name: language === "fi" ? "Yhteensä ja siirto" : "Total and transfer",
      });
      await expect(footer).toContainText(
        language === "fi"
          ? "Tunnettujen hintojen välisumma"
          : "Subtotal of known prices",
      );
      for (const appearance of ["light", "dark"] as const) {
        await page.evaluate(
          (appearance) => window.korikone.setAppearance(appearance),
          appearance,
        );
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(page.locator(".shopping-panel")).toHaveAttribute(
          "data-flow",
          "false",
        );
        const remove = rows.locator(".delete-row").last();
        await remove.focus();
        await expect
          .poll(() =>
            footer.evaluate((el) => el.getBoundingClientRect().bottom),
          )
          .toBeLessThanOrEqual(800);
        const boxes = await page.evaluate(() => {
          const rows = document.querySelector(".shopping-rows")!;
          const footer = document.querySelector(".shopping-total")!;
          const focus = document.activeElement!;
          return {
            rowBottom: rows.getBoundingClientRect().bottom,
            footerTop: footer.getBoundingClientRect().top,
            footerBottom: footer.getBoundingClientRect().bottom,
            focusBottom: focus.getBoundingClientRect().bottom,
            scroll: rows.scrollHeight > rows.clientHeight,
          };
        });
        expect(boxes.scroll).toBe(true);
        expect(boxes.rowBottom).toBeLessThanOrEqual(boxes.footerTop);
        expect(boxes.focusBottom).toBeLessThanOrEqual(boxes.rowBottom);
        expect(boxes.footerBottom).toBeLessThanOrEqual(800);
        await page.screenshot({
          path: `test-results/footer-${language}-${appearance}-1280.png`,
        });
        await page.setViewportSize({ width: 800, height: 600 });
        await expect(page.locator(".shopping-panel")).toHaveAttribute(
          "data-flow",
          "true",
        );
        expect(
          await footer.evaluate((el) => getComputedStyle(el).position),
        ).toBe("static");
        await footer.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/footer-${language}-${appearance}-800.png`,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      expect(
        (await page.evaluate(() => window.korikone.load())).value
          .developmentRequests,
      ).toBe(0);
    } finally {
      await app.close();
    }
  });
}
