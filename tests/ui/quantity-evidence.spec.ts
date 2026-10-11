import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const language of ["fi", "en"] as const)
  test(`literal quantities and uncertain package counts survive the real UI and restart in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-quantity-evidence-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    let app = await electron.launch({ args: ["."], env });
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.setLanguage(language);
          await window.korikone.signInAI();
        },
        { state, language },
      );
      await page.reload();
      const source =
        language === "fi"
          ? "Maitoa 1 litra ja Kananmunia 6 ja 3 pakastepizzaa"
          : "One litre of milk and six eggs and three frozen pizzas";
      const unknownLabel =
        language === "fi" ? "3 pakastepizzaa" : "three frozen pizzas";
      const note = page.getByLabel(
        language === "fi"
          ? "Mitä haluaisit valmistaa?"
          : "What would you like to cook?",
      );
      await note.fill(source);
      await note.press("Control+Enter");
      await expect(page.locator("#note-update-help")).toHaveAttribute(
        "data-planning-phase",
        "committed",
      );
      const committed = (await page.evaluate(() => window.korikone.load()))
        .value;
      expect(
        committed.basket.map((line) => [
          line.requirement.name,
          line.requirement.amount,
          line.requirement.unit,
        ]),
      ).toEqual([
        ["Maito", 1000, "ml"],
        ["Kananmuna", 6, "pcs"],
      ]);
      expect(
        committed.committedIntents.find(
          (result) => result.intent.label === unknownLabel,
        ),
      ).toMatchObject({
        reason: "unknown-unit",
        intent: {
          quantity: { amount: 3, unit: null, provenance: "explicit-note" },
        },
        requirementKeys: [],
      });
      await expect(page.getByText(unknownLabel, { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          language === "fi"
            ? "Tunnettujen hintojen välisumma"
            : "Subtotal of known prices",
          { exact: true },
        ),
      ).toBeVisible();
      expect(committed.developmentRequests).toBe(1);
      expect(committed.developmentStoreWrites).toBe(0);
      await app.close();
      app = await electron.launch({ args: ["."], env });
      page = await app.firstWindow();
      await expect(page.getByText(unknownLabel, { exact: true })).toBeVisible();
      const restored = (await page.evaluate(() => window.korikone.load()))
        .value;
      expect(restored.basket).toEqual(committed.basket);
      expect(restored.committedIntents).toEqual(committed.committedIntents);
      expect(restored.quotedAt).toBe(committed.quotedAt);
      expect(await page.evaluate(() => window.korikone.prepare())).toEqual({
        ok: false,
        error: "unresolved",
      });
      expect(restored.developmentRequests).toBe(0);
      expect(restored.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
