import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("offer ideas use alternative-provider IPC, append only to note and preserve current list through restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-offers-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_AI_PROVIDER = "fake-alternative";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    state.note = "Kahvia";
    state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
    await page.evaluate(async (state) => {
      const api = window.korikone;
      const saved = await api.save(state);
      if (!saved.ok) throw new Error(saved.error);
      await api.signInAI();
      await api.buildBasket();
    }, state);
    await page.reload();
    const before = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    const panel = page.getByRole("region", {
      name: "Ideoita tarjouksista",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "Ideoita tarjouksista", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Tomaattipasta", exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText("0,79");
    await expect(panel).toContainText("1 kpl");
    await panel.getByRole("button", { name: "Lisää muistiinpanoon" }).click();
    await expect(page.locator("#shopping-note")).toHaveValue(
      "Kahvia\nTomaattipasta",
    );
    const after = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(after.state).toEqual(before.state);
    expect(after.basket).toEqual(before.basket);
    expect(after.review).toEqual(before.review);
    expect(after.developmentRequests - before.developmentRequests).toBe(1);
    expect(after.developmentAIProvider).toBe("fake-alternative");
    expect(after.developmentStoreWrites).toBe(0);
    await page.evaluate(async () => {
      await window.korikone.developmentScenario("offersPersonal");
    });
    await panel
      .getByRole("button", { name: "Ideoita tarjouksista", exact: true })
      .click();
    await expect(panel).toContainText("ehdollinen tarjous");
    await expect(panel).toContainText("Vaatii Plussa-kortin");
    await expect(panel).toContainText("Aktivointia ei ole varmistettu");
    await expect(panel).toContainText("1,99");
    await expect(panel).toContainText("3 kpl");
    await page.evaluate(async () => {
      await window.korikone.developmentScenario("invalidDraft");
    });
    await panel
      .getByRole("button", { name: "Ideoita tarjouksista", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Tomaattipasta", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              async () => (await window.korikone.load()).value,
            )
          ).developmentRequests,
      )
      .toBe(2);
    for (const scenario of ["offersEmpty", "offersUnsupported"]) {
      await page.evaluate(async (scenario) => {
        await window.korikone.developmentScenario(scenario);
      }, scenario);
      await panel
        .getByRole("button", { name: "Ideoita tarjouksista", exact: true })
        .click();
      await expect(panel).toContainText(
        scenario === "offersEmpty"
          ? "Nykyisiä tarjouksia ei löytynyt"
          : "tarjousten hakua ei tueta",
      );
      const evidence = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(evidence.developmentRequests).toBe(0);
      expect(evidence.state).toEqual(before.state);
    }
    await page.evaluate(async () => {
      await window.korikone.developmentScenario("pendingSuccess");
    });
    await panel
      .getByRole("button", { name: "Ideoita tarjouksista", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Peruuta ideat", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              async () => (await window.korikone.load()).value,
            )
          ).developmentRequests,
      )
      .toBe(1);
    await panel
      .getByRole("button", { name: "Peruuta ideat", exact: true })
      .click();
    await expect(panel).toContainText("Ideoiden haku peruutettu");
    const cancelled = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(cancelled.state).toEqual(before.state);
    expect(cancelled.developmentRequests).toBe(1);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(restarted.state).toEqual(before.state);
    expect(restarted.basket).toEqual(before.basket);
    expect(restarted.offerIdeas).toBeNull();
  } finally {
    await app.close();
  }
});
