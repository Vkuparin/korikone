import { settingsCategory } from "./settings-helper";
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

for (const language of ["fi", "en"] as const) {
  test(`composer layout retains explicit updates and keyboard model focus in ${language}`, async () => {
    const app = await launch();
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = true;
      state.setupComplete = true;
      state.language = language;
      state.staples = [];
      await page.evaluate(async (state) => {
        await window.korikone.save(state);
        await window.korikone.setLanguage(state.language as "fi" | "en");
        await window.korikone.signInAI();
      }, state);
      await page.reload();
      const fi = language === "fi";
      const note = page.getByLabel(
        fi ? "Mitä haluaisit valmistaa?" : "What would you like to cook?",
      );
      const model = page.getByRole("button", {
        name: fi ? "AI-malli" : "AI model",
        exact: true,
      });
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      await note.fill("Nakkikeitto");
      await expect(page.locator("#note-unapplied")).toBeVisible();
      await model.focus();
      await model.press("ArrowDown");
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.getByRole("listbox").press("Escape");
      await expect(model).toBeFocused();
      await expect(page.locator(".context")).toBeVisible();
      await page.waitForTimeout(800);
      expect((await load()).developmentRequests).toBe(0);
      await page
        .getByRole("button", {
          name: fi ? "Päivitä lista" : "Update list",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await load()).state.note)
        .toBe("Nakkikeitto");
      expect((await load()).developmentRequests).toBe(1);
      await expect(page.locator("#note-unapplied")).toHaveCount(0);
      await expect(page.locator(".note-box")).not.toHaveClass(/is-working/);
      await note.fill("Kanapasta");
      await expect(
        page.getByRole("button", {
          name: fi ? "Päivitä lista" : "Update list",
          exact: true,
        }),
      ).toBeEnabled();
      await note.press("Control+Enter");
      await expect(page.locator(".note-box")).not.toHaveClass(/is-working/);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect
        .poll(async () => (await load()).state.note)
        .toBe("Kanapasta");
      await expect(note).toBeFocused();
      expect((await load()).developmentRequests).toBe(2);
      await expect(page.locator("#note-unapplied")).toHaveCount(0);
      for (const width of [1280, 800]) {
        await app.evaluate(
          ({ BrowserWindow }, width) =>
            BrowserWindow.getAllWindows()[0].setSize(
              width,
              width === 800 ? 600 : 800,
            ),
          width,
        );
        await note.focus();
        await expect(note).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/composer-${language}-${width}.png`,
          fullPage: true,
        });
      }
      expect((await load()).developmentRequests).toBe(2);
    } finally {
      await app.close();
    }
  });
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
    await settingsCategory(page, "data", "Tiedot");
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
    await page.getByLabel("Kuittien ostosrivit").fill("Unsaved receipt lines");
    await settingsCategory(page, "household", "Kotitalous");
    await settingsCategory(page, "data", "Tiedot");
    await expect(page.getByLabel("Kuittien ostosrivit")).toHaveValue(
      "Unsaved receipt lines",
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
    await expect(page.getByLabel("Kuittien ostosrivit")).toHaveValue(
      "Unsaved receipt lines",
    );
    expect(
      (await page.evaluate(async () => window.korikone.load())).value.state
        .receiptText,
    ).toContain("Yogurtti 2.49");
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

for (const language of ["fi", "en"] as const) {
  test(`update lifecycle preserves the saved list and focus in ${language}`, async () => {
    const app = await launch();
    try {
      const page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 800, height: 600 });
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.meals = [];
      state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.setLanguage(language);
          await window.korikone.signInAI();
          await window.korikone.setAppearance("dark");
        },
        { state, language },
      );
      await page.reload();
      const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
      const note = page.getByLabel(
        tr("Mitä haluaisit valmistaa?", "What would you like to cook?"),
      );
      const status = page.locator("#note-update-help");
      const load = () =>
        page
          .evaluate(() => window.korikone.load())
          .then((result) => result.value);
      const baseline = await load();
      await note.fill("Makaronilaatikko");
      await expect(status).toHaveAttribute("role", "status");
      await expect(status).toHaveAttribute("aria-atomic", "true");
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedSuccess"),
      );
      await note.press("Control+Enter");
      await expect(status).toHaveText(
        tr("Tulkitaan pyyntöä…", "Interpreting your request…"),
        { timeout: 1000 },
      );
      await page
        .getByRole("button", {
          name: tr("Tallennettu lista", "Saved list"),
          exact: true,
        })
        .click();
      await expect(page.locator(".saved-list-status")).toBeVisible();
      await note.focus();
      await expect(page.locator(".grocery-row")).toHaveCount(1);
      await expect(note).toBeFocused();
      expect(
        await page
          .locator(".note-box")
          .evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
      expect((await load()).state).toEqual(baseline.state);
      await expect(status).toHaveAttribute(
        "data-planning-phase",
        "interpreting",
      );
      expect((await load()).quotedAt).toBe(baseline.quotedAt);
      const cancel = page.locator(".note-actions").getByRole("button", {
        name: tr("Peruuta listan päivitys", "Cancel list update"),
        exact: true,
      });
      await cancel.focus();
      await page.keyboard.press("Enter");
      await expect(status).toHaveText(
        tr("Listan päivitys peruutettu", "List update cancelled"),
      );
      await expect(note).toBeFocused();
      await expect(note).toHaveValue("Makaronilaatikko");
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect((await load()).state).toEqual(baseline.state);
      expect((await load()).basket).toEqual(baseline.basket);
      expect((await load()).planning?.phase).toBe("cancelled");
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedFailure"),
      );
      await note.press("Control+Enter");
      await expect(status).toHaveText(
        tr("Tulkitaan pyyntöä…", "Interpreting your request…"),
        { timeout: 1000 },
      );
      await expect(status).toHaveText(
        tr(
          "Listan päivitys epäonnistui. Aiempi lista säilyy.",
          "List update failed. Your previous list is retained.",
        ),
      );
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(note).toBeFocused();
      expect((await load()).state).toEqual(baseline.state);
      expect((await load()).basket).toEqual(baseline.basket);
      expect((await load()).planning?.phase).toBe("failed");
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedSuccess"),
      );
      await page
        .getByRole("button", {
          name: tr("Päivitä lista", "Update list"),
          exact: true,
        })
        .click();
      await expect(status).toHaveText(
        tr("Tulkitaan pyyntöä…", "Interpreting your request…"),
        { timeout: 1000 },
      );
      await expect(page.locator(".grocery-row")).toHaveCount(1);
      await expect(page.locator(".note-box")).not.toHaveClass(/is-working/, {
        timeout: 10000,
      });
      await expect(page.locator(".grocery-row")).toHaveCount(7);
      await expect(note).toBeFocused();
      await expect(note).toHaveValue("Makaronilaatikko");
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect((await load()).state.note).toBe("Makaronilaatikko");
      await expect(status).toHaveAttribute("data-planning-phase", "committed");
      expect((await load()).developmentRequests).toBe(1);
    } finally {
      await app.close();
    }
  });
}

for (const language of ["fi", "en"] as const) {
  test(`coordinator composer phases and obsolete search preserve the quote in ${language}`, async () => {
    const app = await launch();
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.extras = [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }];
      state.context.storeId = "demo-delayed-search";
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.buildBasket();
          await window.korikone.setLanguage(language);
          await window.korikone.signInAI();
        },
        { state, language },
      );
      await page.reload();
      const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
      const note = page.getByLabel(
        tr("Mitä haluaisit valmistaa?", "What would you like to cook?"),
      );
      const status = page.locator("#note-update-help");
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const before = await load();
      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedModels"),
      );
      await note.fill("200 ml kermaa");
      await note.press("Control+Enter");
      await expect(status).toHaveAttribute(
        "data-planning-phase",
        "discovering",
      );
      await expect(status).toHaveText(
        tr("Etsitään käytettävää AI-mallia…", "Finding an available AI model…"),
      );
      await page
        .locator(".note-actions")
        .getByRole("button", {
          name: tr("Peruuta listan päivitys", "Cancel list update"),
          exact: true,
        })
        .click();
      await expect(page.locator(".note-box")).not.toHaveClass(/is-working/);
      expect((await load()).state).toEqual(before.state);
      expect((await load()).basket).toEqual(before.basket);
      expect((await load()).developmentRequests).toBe(0);
      await expect(note).toBeFocused();

      await page.evaluate(() =>
        window.korikone.developmentScenario("delayedSuccess"),
      );
      await note.press("Control+Enter");
      await expect(status).toHaveAttribute("data-planning-phase", "searching", {
        timeout: 10000,
      });
      await expect(status).toHaveText(
        tr("Haetaan tuotteita ja hintoja…", "Getting products and prices…"),
      );
      expect((await load()).quotedAt).toBe(before.quotedAt);
      await page
        .getByRole("button", {
          name: tr("Tallennettu lista", "Saved list"),
          exact: true,
        })
        .click();
      await expect(
        page.getByText(tr("Viimeksi haetut hinnat", "Last quoted prices"), {
          exact: false,
        }),
      ).toBeVisible();
      await note.fill("1 l maitoa");
      await expect(page.locator(".note-box")).not.toHaveClass(/is-working/);
      await expect(status).toHaveAttribute("data-planning-phase", "obsolete");
      await page.waitForTimeout(1500); // The fixture's outstanding catalogue read must settle.
      expect((await load()).state).toEqual(before.state);
      expect((await load()).basket).toEqual(before.basket);
      await expect(note).toHaveValue("1 l maitoa");

      await note.fill("200 ml kermaa");
      await page.evaluate(() => {
        const data = window as unknown as { phaseEvents: string[] };
        data.phaseEvents = [];
        window.korikone.onPlanningChange((event) =>
          data.phaseEvents.push(event.phase),
        );
      });
      const requestsBeforeRetry = (await load()).developmentRequests;
      await note.press("Control+Enter");
      await expect(status).toHaveAttribute("data-planning-phase", "resolving", {
        timeout: 10000,
      });
      await expect(status).toHaveText(
        tr("Tarkistetaan epäselviä tuotteita…", "Checking uncertain products…"),
      );
      expect((await load()).state).toEqual(before.state);
      await expect(
        page.locator(".note-actions").getByRole("button", {
          name: tr("Peruuta listan päivitys", "Cancel list update"),
          exact: true,
        }),
      ).toBeEnabled();
      await expect(status).toHaveAttribute("data-planning-phase", "committed", {
        timeout: 10000,
      });
      const phases = await page.evaluate(
        () => (window as unknown as { phaseEvents: string[] }).phaseEvents,
      );
      for (const phase of [
        "discovering",
        "interpreting",
        "interpreted",
        "searching",
        "resolving",
        "ready",
        "committing",
        "committed",
      ])
        expect(phases).toContain(phase);
      expect((await load()).state.note).toBe("200 ml kermaa");
      expect((await load()).developmentRequests).toBe(requestsBeforeRetry + 2);
      expect((await load()).planning?.counters.aiCalls).toBe(2);
      expect((await load()).developmentStoreWrites).toBe(0);
      await expect(note).toBeFocused();
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}

test("validated preview shows gradual rows and quantity-less requests without transfer actions", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.staples = [];
    state.context.storeId = "demo-delayed-search";
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("delayedSuccess");
    }, state);
    await page.reload();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("200 ml kermaa ja kahvia");
    await note.press("Control+Enter");
    const preview = page.getByRole("region", { name: "Muodostuva lista" });
    // A named section is exposed as a region; it contains only server-validated results.
    await expect(preview).toBeVisible();
    await expect(preview.getByText("Odotetaan tulkintaa.")).toBeVisible();
    await expect(
      preview.locator('[data-preview-status="pending"]'),
    ).toHaveCount(1, { timeout: 10000 });
    await expect(
      preview.getByRole("heading", { name: "Ratkaisemattomat pyynnöt" }),
    ).toBeVisible();
    await expect(preview.getByText("kahvia", { exact: true })).toBeVisible();
    await expect(
      preview.locator('[data-preview-status="approval-required"]'),
    ).toHaveCount(1, { timeout: 10000 });
    await expect(
      preview.getByText("Vaatii hyväksynnän", { exact: true }),
    ).toBeVisible();
    await expect(preview.getByRole("button")).toHaveCount(0);
    await expect(preview.locator(".shopping-total")).toHaveCount(0);
    await expect(note).toBeFocused();
    const cancelPreview = page
      .locator(".note-actions")
      .getByRole("button", { name: "Peruuta listan päivitys", exact: true });
    await cancelPreview.focus();
    await cancelPreview.press("Enter");
    await expect(preview).toHaveCount(0);
    const saved = (await page.evaluate(() => window.korikone.load())).value;
    expect(saved.state.note).toBe("");
    expect(saved.basket).toEqual([]);
    expect(saved.developmentStoreWrites).toBe(0);
    await expect(note).toHaveValue("200 ml kermaa ja kahvia");
    await expect(note).toBeFocused();
  } finally {
    await app.close();
  }
});

for (const language of ["fi", "en"] as const) {
  test(`preview selection preserves saved quote and keyboard focus in ${language}`, async () => {
    const app = await launch();
    try {
      const page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 800, height: 600 });
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.extras = [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }];
      state.context.storeId = "demo-delayed-search";
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.buildBasket();
          await window.korikone.setLanguage(language);
          await window.korikone.signInAI();
          await window.korikone.developmentScenario("pendingSuccess");
        },
        { state, language },
      );
      await page.reload();
      const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
      const note = page.getByLabel(
        tr("Mitä haluaisit valmistaa?", "What would you like to cook?"),
      );
      const before = (await page.evaluate(() => window.korikone.load())).value;
      await note.fill("200 ml kermaa ja kahvia");
      await note.press("Control+Enter");
      const preview = page.getByRole("region", {
        name: tr("Muodostuva lista", "List in progress"),
      });
      await expect(preview).toBeVisible();
      await expect(page.locator(".shopping-panel")).toBeHidden();
      await expect(note).toBeFocused();
      const saved = page.getByRole("button", {
        name: tr("Tallennettu lista", "Saved list"),
        exact: true,
      });
      await saved.focus();
      await saved.press("Enter");
      await expect(saved).toBeFocused();
      await expect(saved).toHaveAttribute("aria-pressed", "true");
      await expect(preview).toBeHidden();
      await expect(page.locator(".shopping-panel")).toBeVisible();
      await expect(page.locator(".grocery-row")).toHaveCount(1);
      const forming = page.getByRole("button", {
        name: tr("Muodostuva lista", "List in progress"),
        exact: true,
      });
      await forming.focus();
      await forming.press("Enter");
      await expect(forming).toBeFocused();
      await expect(preview).toBeVisible();
      await expect(page.locator(".shopping-panel")).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const cancel = page.locator(".note-actions").getByRole("button", {
        name: tr("Peruuta listan päivitys", "Cancel list update"),
        exact: true,
      });
      await cancel.focus();
      await cancel.press("Enter");
      await expect(preview).toHaveCount(0);
      await expect(page.locator(".shopping-panel")).toBeVisible();
      await expect(note).toBeFocused();
      const after = (await page.evaluate(() => window.korikone.load())).value;
      expect(after.state).toEqual(before.state);
      expect(after.basket).toEqual(before.basket);
      expect(after.quotedAt).toBe(before.quotedAt);
      expect(after.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}

test("committing removes preview controls without losing their keyboard focus and restart has no preview", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.staples = [];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.setLanguage("en");
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("delayedSuccess");
    }, state);
    await page.reload();
    const note = page.getByLabel("What would you like to cook?");
    await note.fill("1 l maitoa");
    await note.press("Control+Enter");
    const forming = page.getByRole("button", {
      name: "List in progress",
      exact: true,
    });
    await expect(forming).toBeVisible();
    await forming.focus();
    await expect(forming).toBeFocused();
    await expect(page.locator("#note-update-help")).toHaveAttribute(
      "data-planning-phase",
      "committed",
      { timeout: 10000 },
    );
    await expect(note).toBeFocused();
    await expect(
      page.getByRole("region", { name: "List in progress" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "List in progress" }),
    ).toHaveCount(0);
    await expect(page.locator(".grocery-row")).toHaveCount(1);
    expect(
      (await page.evaluate(() => window.korikone.load())).value.state.note,
    ).toBe("1 l maitoa");
  } finally {
    await app.close();
  }
});
