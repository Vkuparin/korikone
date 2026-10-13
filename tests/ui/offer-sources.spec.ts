import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`offer sources that are expired, exhausted, signed out or failing explain themselves with no AI request in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-src-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = true;
      state.setupComplete = true;
      state.staples = [];
      state.note = "Kahvia";
      state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
      await page.evaluate(
        async ({ state, language }) => {
          const api = window.korikone;
          const saved = await api.save(state);
          if (!saved.ok) throw new Error(saved.error);
          await api.setLanguage(language);
          await api.signInAI();
          await api.buildBasket();
        },
        { state, language },
      );
      await page.reload();
      const load = async () =>
        (await page.evaluate(() => window.korikone.load())).value;
      const before = await load();
      const panel = page.getByRole("region", {
        name: tr("Ideoita tarjouksista", "Ideas from offers"),
        exact: true,
      });
      const ask = async (scenario: string) => {
        await page.evaluate(
          (scenario) => window.korikone.developmentScenario(scenario),
          scenario,
        );
        await panel
          .getByRole("button", {
            name: tr("Ideoita tarjouksista", "Ideas from offers"),
            exact: true,
          })
          .click();
      };

      // Source states that must not spend an AI request, each with its own explanation.
      const quiet: [string, string][] = [
        [
          "offersExpired",
          tr("Nykyisiä tarjouksia ei löytynyt", "No current offers were found"),
        ],
        [
          "offersExhausted",
          tr("Nykyisiä tarjouksia ei löytynyt", "No current offers were found"),
        ],
        [
          "offersSignedOut",
          tr(
            "Kirjaudu kaupan tilille",
            "Sign in to the retailer in the Store tab",
          ),
        ],
        ["offersError", tr("Ideoita ei voitu hakea", "Could not load ideas")],
        [
          "offersUnsupported",
          tr(
            "tarjousten hakua ei tueta",
            "Offer discovery is unavailable for this store",
          ),
        ],
      ];
      for (const [scenario, text] of quiet) {
        await ask(scenario);
        await expect(panel).toContainText(text);
        const evidence = await load();
        expect(evidence.developmentRequests).toBe(0);
        expect(evidence.developmentStoreWrites).toBe(0);
        expect(evidence.state).toEqual(before.state);
        expect(evidence.basket).toEqual(before.basket);
      }
      // Unsupported is its own message, never "no offers".
      await expect(panel).not.toContainText(
        tr("Nykyisiä tarjouksia ei löytynyt", "No current offers were found"),
      );

      // A mixed source: only the current offer is shown, with one request.
      await ask("offersMixed");
      await expect(
        panel.getByRole("heading", {
          name: tr("Tomaattipasta", "Tomato pasta"),
          exact: true,
        }),
      ).toBeVisible();
      await expect(panel).not.toContainText("Vanhentunut");
      await expect(panel).not.toContainText("Käytetty synteettinen");
      await expect(panel).not.toContainText("Loppunut");
      const mixed = await load();
      expect(mixed.developmentRequests).toBe(1);
      expect(mixed.state).toEqual(before.state);
      expect(mixed.basket).toEqual(before.basket);
      expect(mixed.review).toEqual(before.review);
      expect(mixed.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}
