import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { settingsCategory } from "./settings-helper";

for (const provider of ["chatgpt", "fake-alternative"])
  test(`${provider}: Advanced resolver switch persists and controls only the optional batch`, async () => {
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
    let app = await electron.launch({ args: ["."], env });
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
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
      const checkbox = page.getByRole("checkbox", {
        name: "Kysy tekoälyltä epäselvistä tuotevaihtoehdoista",
      });
      await expect(checkbox).toBeChecked();
      await checkbox.click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.korikone.load())).value.state
              .resolverEnabled,
        )
        .toBe(false);
      await app.close();
      app = await electron.launch({ args: ["."], env });
      page = await app.firstWindow();
      const saved = (await page.evaluate(() => window.korikone.load())).value;
      expect(saved.state.resolverEnabled).toBe(false);
      await page.evaluate(() => window.korikone.signInAI());
      await page.evaluate(() => window.korikone.setAIModel("fixture-large"));
      const off = await page.evaluate(() =>
        window.korikone.planShopping({
          prompt: "200 ml kermaa",
          consent: true,
        }),
      );
      expect(off.ok, off.error).toBe(true);
      expect(off.value.planning!.counters.aiCalls).toBe(1);
      expect(off.value.planning!.model).toMatchObject({
        providerId: provider,
        modelId: "fixture-large",
      });
      expect(off.value.planning!.intents[0].status).toBe("approval-required");
      await page.evaluate(async (id) => {
        await window.korikone.cancelPlanning({ operationId: id });
        const state = (await window.korikone.load()).value.state;
        await window.korikone.save({ ...state, resolverEnabled: true });
      }, off.value.planning!.operationId);
      const on = await page.evaluate(() =>
        window.korikone.planShopping({
          prompt: "200 ml kermaa",
          consent: true,
        }),
      );
      expect(on.ok, on.error).toBe(true);
      expect(on.value.planning!.counters.aiCalls).toBe(2);
      expect(on.value.planning!.model).toMatchObject({
        providerId: provider,
        modelId: "fixture-large",
      });
      expect(on.value.planning!.intents[0].status).toBe("approval-required");
      expect(on.value.developmentStoreWrites).toBe(0);
      expect(on.value.state.note).toBe(saved.state.note);
      await page.evaluate(
        (operationId) => window.korikone.cancelPlanning({ operationId }),
        on.value.planning!.operationId,
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
