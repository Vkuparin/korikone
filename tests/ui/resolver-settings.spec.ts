import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { settingsCategory } from "./settings-helper";

// Nothing shows resolver suggestions yet, so Advanced has no switch for them and an ambiguous
// row costs no extra request, even for an older profile that saved the switch on.
for (const provider of ["chatgpt", "fake-alternative"])
  test(`${provider}: an ambiguous row plans with one request and Advanced has no resolver switch`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-resolver-ui-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    env.KORIKONE_TEST_AI_PROVIDER = provider;
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.resolverEnabled = true;
      await page.evaluate(async (state) => {
        await window.korikone.save(state);
        await window.korikone.signInAI();
      }, state);
      await page.reload();
      await page
        .getByRole("navigation")
        .first()
        .getByRole("button", { name: "Asetukset", exact: true })
        .click();
      await settingsCategory(page, "advanced", "Lisäasetukset");
      await expect(
        page.getByRole("checkbox", { name: "Tarkista ennen siirtoa" }),
      ).toBeVisible();
      await expect(
        page.getByRole("checkbox", {
          name: "Kysy tekoälyltä epäselvistä tuotevaihtoehdoista",
        }),
      ).toHaveCount(0);
      await page.evaluate(() => window.korikone.setAIModel("fixture-large"));
      const ambiguous = await page.evaluate(() =>
        window.korikone.planShopping({
          prompt: "200 ml kermaa",
          consent: true,
        }),
      );
      expect(ambiguous.ok, ambiguous.error).toBe(true);
      expect(ambiguous.value.planning!.counters.aiCalls).toBe(1);
      expect(ambiguous.value.planning!.model).toMatchObject({
        providerId: provider,
        modelId: "fixture-large",
      });
      expect(ambiguous.value.planning!.intents[0].status).toBe(
        "approval-required",
      );
      expect(ambiguous.value.developmentStoreWrites).toBe(0);
      await page.evaluate(
        (operationId) => window.korikone.cancelPlanning({ operationId }),
        ambiguous.value.planning!.operationId,
      );
      const clear = await page.evaluate(() =>
        window.korikone.planShopping({ prompt: "1 l maitoa", consent: true }),
      );
      expect(clear.ok, clear.error).toBe(true);
      expect(clear.value.planning!.counters.aiCalls).toBe(1);
      expect(clear.value.planning!.intents[0].status).toBe("resolved");
      expect(clear.value.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
