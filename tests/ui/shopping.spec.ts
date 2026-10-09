import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-redesign-"));
  const app = await electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
  // Packaged Windows builds need a visible compositor surface for screenshots.
  if (process.env.KORIKONE_EXECUTABLE) {
    await (await app.firstWindow()).waitForLoadState("domcontentloaded");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
  }
  return app;
}

test("manual groceries accept decimal units and merge into quoted ingredient rows", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    state.meals = [
      { id: "meal", recipeId: "soup", day: 0, servings: 4, leftovers: false },
    ];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
    }, state);
    await page.reload();
    const add = async (name: string, amount: string, unit: string) => {
      await page.getByLabel("Lisää tuote", { exact: true }).fill(name);
      await page.getByLabel("Tuotteen määrä").fill(amount);
      await page.getByLabel("Tuotteen yksikkö").selectOption(unit);
      await page
        .getByRole("button", { name: "Lisää tuote listaan", exact: true })
        .click();
    };
    await expect(page.locator(".grocery-row")).toHaveCount(3);
    await add("PERUNA", "0,5", "kg");
    const potato = page
      .locator(".grocery-row")
      .filter({ hasText: "Peruna 1 kg" });
    await expect(page.locator(".grocery-row")).toHaveCount(3);
    await expect(potato).toContainText("1300 g");
    await expect(potato.locator(".quantity-control span")).toHaveText("2");
    await expect(page.locator(".shopping-total .warning")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Lisää: Peruna", exact: true })
      .click();
    await expect(potato).toContainText("2300 g");
    await add("Peruna", "200", "g");
    await expect(potato).toContainText("2500 g");
    await add("Maito", "1.25", "l");
    await expect(page.locator(".grocery-row")).toHaveCount(4);
    await expect(
      page.locator(".grocery-row").filter({ hasText: "Maito 1 l" }),
    ).toContainText("1250 ml");
    await add("Banaani", "1,5", "pcs");
    await expect(page.getByRole("alert")).toContainText(
      "Anna positiivinen määrä",
    );
    await expect(page.locator(".grocery-row")).toHaveCount(4);
    await expect(page.getByLabel("Tuotteen määrä")).toHaveValue("1,5");
    await add("Banaani", "2", "pcs");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await page.reload();
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await expect(potato).toContainText("2500 g");
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value!.developmentRequests,
      ),
    ).toBe(0);
  } finally {
    await app.close();
  }
});

test("shopping workspace adds recipes, marks home items, removes rows, schedules and clears", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Kokeile esimerkkiä" }).click();
    await expect(page.locator(".grocery-row")).toHaveCount(6);
    await expect(page.locator(".shopping-total .warning")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/redesign-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("heading", { name: "Tomaattipasta", exact: true })
      .click();
    await expect(page.locator(".grocery-row.highlighted")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Löytyy kotoa: Pasta", exact: true })
      .click();
    await expect(page.locator(".grocery-row.at-home")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Poista: Tomaattimurska", exact: true })
      .click();
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Löytyy kotoa: Pasta", exact: true })
      .click();
    await expect(page.locator(".grocery-row.at-home")).toHaveCount(0);
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Lisää: Pasta", exact: true })
      .click();
    await expect(
      page.locator(".grocery-row").filter({ hasText: "Pasta 500 g" }),
    ).toContainText("900 g");
    await page.getByText("Lisää valmiita reseptejä", { exact: true }).click();
    await page.getByLabel("Resepti", { exact: true }).selectOption("porridge");
    await page
      .getByRole("button", { name: "Lisää resepti ostoslistaan" })
      .click();
    await expect(page.locator(".interpretation")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Viikkosuunnitelma", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Luonnostele viikko", exact: true })
      .click();
    await expect(page.locator(".schedule-grid article")).toHaveCount(7);
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await page.setViewportSize({ width: 720, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: "test-results/redesign-narrow.png",
      fullPage: true,
    });
    await page.getByLabel("Listan toiminnot").click();
    await page.getByRole("button", { name: "Tyhjennä ostoslista" }).click();
    await expect(page.locator(".grocery-row")).toHaveCount(0);
    await expect(page.locator(".interpretation")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/redesign-empty.png",
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});

test("typing, view return and restored edits never submit without an explicit action", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    state.note = "Pasta";
    state.meals = [
      {
        id: "pasta-meal",
        recipeId: "pasta",
        day: 0,
        servings: 4,
        leftovers: false,
      },
    ];
    await page.evaluate(async (state) => {
      const saved = await window.korikone.save(state);
      if (!saved.ok) throw new Error(saved.error);
      await window.korikone.signInAI();
    }, state);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Päivitä lista", exact: true }),
    ).toBeEnabled();
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    const before = await load();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Nakkikeitto");
    await expect(
      page.getByText("Muistiinpanoa ei ole päivitetty listaan", {
        exact: true,
      }),
    ).toBeVisible();
    await page.waitForTimeout(2100);
    expect((await load()).developmentRequests).toBe(0);
    expect((await load()).state).toEqual(before.state);
    expect((await load()).basket).toEqual(before.basket);
    await expect(page.locator(".note-box")).not.toHaveClass(/is-working/);
    await page.getByRole("button", { name: "Reseptit", exact: true }).click();
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(note).toHaveValue("Nakkikeitto");
    await page.waitForTimeout(2100);
    expect((await load()).developmentRequests).toBe(0);
    expect((await load()).state).toEqual(before.state);
    await page.reload();
    await expect(note).toHaveValue("Nakkikeitto");
    await page.waitForTimeout(2100);
    expect((await load()).developmentRequests).toBe(0);
    expect((await load()).state).toEqual(before.state);
    await page.getByLabel("Kieli", { exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(
      page.getByText("Note changes have not been applied to the list", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Update list", exact: true })
      .click();
    await expect
      .poll(async () => (await load()).state.note)
      .toBe("Nakkikeitto");
    await expect(
      page.getByText("Note changes have not been applied to the list", {
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await load()).developmentRequests).toBe(1);
    await expect(
      page.getByRole("button", { name: "Update list", exact: true }),
    ).toBeEnabled();
    const englishNote = page.getByLabel("What would you like to cook?");
    await englishNote.fill("Pakastepizza");
    await englishNote.press("Control+Enter");
    await expect
      .poll(async () => (await load()).state.note)
      .toBe("Pakastepizza");
    expect((await load()).developmentRequests).toBe(2);
    await expect(page.locator(".grocery-row")).toHaveCount(1);
    await page.screenshot({
      path: "test-results/explicit-update-desktop.png",
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});

test("explicit updates discard an obsolete response until the next requested update", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("delayedSuccess");
    }, state);
    await page.reload();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Old note");
    await note.press("Control+Enter");
    await expect(page.locator(".note-box")).toHaveClass(/is-working/);
    await note.press("Control+Enter");
    await expect(
      page.getByRole("button", { name: "Päivitä lista", exact: true }),
    ).toBeDisabled();
    await note.fill("Pakastepizza");
    await expect(page.locator(".note-box")).not.toHaveClass(/is-working/);
    await page.waitForTimeout(2100);
    await expect(page.locator(".grocery-row")).toHaveCount(0);
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    expect((await load()).developmentRequests).toBe(1);
    expect((await load()).state.note).toBe("");
    await page
      .getByRole("button", { name: "Päivitä lista", exact: true })
      .click();
    await expect(page.locator(".grocery-description")).toContainText(
      "Pakastepizza",
      { timeout: 10000 },
    );
    await expect(note).toHaveValue("Pakastepizza");
    await expect(page.locator(".grocery-description")).not.toContainText(
      "Old note",
    );
    expect((await load()).developmentRequests).toBe(2);
  } finally {
    await app.close();
  }
});

// Exercises the Electron IPC and its built PDF worker, not only the Node helper.
test("PDF receipt import reaches settings and invalid import preserves saved text", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const directory = await mkdtemp(join(tmpdir(), "korikone-pdf-ui-"));
    const path = join(directory, "receipt.pdf");
    const { writeFile } = await import("node:fs/promises");
    const { receiptPDF } = await import("../fixtures/receipt");
    await writeFile(path, receiptPDF("K-Market Yogurtti 2.49 Banaani 1.99"));
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, path);
    await page
      .getByRole("button", {
        name: "Tuo kuitti (PDF, teksti tai CSV)",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Kuittien ostosrivit")).toContainText(
      "Yogurtti 2.49",
    );
    await writeFile(path, "broken PDF");
    await page
      .getByRole("button", {
        name: "Tuo kuitti (PDF, teksti tai CSV)",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Kuitin lukeminen epäonnistui",
    );
    await expect(page.getByLabel("Kuittien ostosrivit")).toContainText(
      "Yogurtti 2.49",
    );
  } finally {
    await app.close();
  }
});

test("explicit multi-dish updates, cancellation and usage failure preserve the saved list", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.signInAI();
    }, state);
    await page.reload();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Nakkikeitto");
    await page.waitForTimeout(400);
    await note.fill("Nakkikeitto ja kanapasta");
    await page.waitForTimeout(400);
    const fullNote =
      "Nakkikeitto, kanapasta ja pakastepizza. Aamuksi jogurttia ja banaaneja. Herkkuja viikonlopuksi.";
    await note.fill(fullNote);
    await page.waitForTimeout(2100);
    await expect(page.locator(".interpretation")).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.korikone.load())).value
        .developmentRequests,
    ).toBe(0);
    await page
      .getByRole("button", { name: "Päivitä lista", exact: true })
      .click();
    await expect(page.locator(".interpretation")).toHaveCount(4, {
      timeout: 15000,
    });
    await expect(page.locator(".grocery-row")).toHaveCount(10);
    await expect(page.locator(".shopping-total .warning")).toHaveCount(0);
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    expect((await load()).developmentRequests).toBe(1);
    const queued = await page.evaluate(async () => {
      const api = window.korikone;
      await api.developmentScenario("delayedSuccess");
      const first = api.generate({
        prompt: "pasta",
        model: "auto",
        consent: true,
      });
      while ((await api.load()).value.developmentRequests !== 1)
        await new Promise((resolve) => setTimeout(resolve, 10));
      const second = api.generate({
        prompt: "soup",
        model: "auto",
        consent: true,
      });
      await api.cancelAI();
      return Promise.all([first, second]);
    });
    expect(queued).toEqual([
      { ok: false, error: "aiCancelled" },
      { ok: false, error: "aiCancelled" },
    ]);
    expect((await load()).developmentRequests).toBe(1);
    await page.screenshot({
      path: "test-results/multi-dish-fixture.png",
      fullPage: true,
    });

    await page.evaluate(() =>
      window.korikone.developmentScenario("delayedSuccess"),
    );
    await note.fill("pasta");
    await note.press("Control+Enter");
    await expect(page.locator(".note-box")).toHaveClass(/is-working/);
    await expect.poll(async () => (await load()).developmentRequests).toBe(1);
    await note.fill("Pakastepizza");
    await page
      .getByRole("button", { name: "Peruuta listan päivitys", exact: true })
      .click();
    await expect(page.locator(".note-box")).not.toHaveClass(/is-working/);
    await expect(
      page.getByText("Listan päivitys peruutettu", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.waitForTimeout(2100);
    const cancelled = await load();
    expect(cancelled.developmentRequests).toBe(1);
    expect(cancelled.state.note).toBe(fullNote);
    expect(cancelled.draft).toBeNull();
    await expect(page.locator(".interpretation")).toHaveCount(4);

    await page.evaluate(() =>
      window.korikone.developmentScenario("usageLimit"),
    );
    await note.press("Control+Enter");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.waitForTimeout(2100);
    const failed = await load();
    expect(failed.developmentRequests).toBe(1);
    expect(failed.state.note).toBe(fullNote);
    await expect(page.locator(".interpretation")).toHaveCount(4);

    await page.evaluate(() => window.korikone.developmentScenario("success"));
    await note.press("Control+Enter");
    await expect
      .poll(async () => (await load()).state.note)
      .toBe("Pakastepizza");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".grocery-row")).toHaveCount(1);
    expect((await load()).developmentRequests).toBe(1);
  } finally {
    await app.close();
  }
});
