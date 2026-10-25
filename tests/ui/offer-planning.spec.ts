import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { composer, startNewList } from "./composer-helper";

test("selected offers reach planning after reload and store failures point to store settings", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-offer-plan-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_AI_PROVIDER = "fake-alternative";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.staples = [];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.signInAI();
    }, state);
    await page.reload();
    const panel = page.getByRole("region", {
      name: "Ideoita tarjouksista",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "Ideoita tarjouksista", exact: true })
      .click();
    await panel.getByRole("button", { name: "Lisää muistiinpanoon" }).click();
    await expect(composer(page)).toHaveValue("Tomaattipasta");
    await page.reload();
    await expect(
      page.getByText("Tarjoustuotteet valittu listan luontiin."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Taio ostoslista", exact: true })
      .click();
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    await expect
      .poll(async () => (await load()).state.note)
      .toBe("Tomaattipasta");
    const result = await load();
    expect(
      Object.values(result.state.offerBindings).map((p) => p.productId),
    ).toEqual(["2000000000011"]);
    expect(
      result.basket.find((line) => line.requirement.name === "Tomaattimurska")
        ?.product?.id,
    ).toBe("2000000000011");
    expect(result.developmentStoreWrites).toBe(0);

    await startNewList(page);
    await page.evaluate(() => window.korikone.scenario("catalogue"));
    await composer(page).fill("Nakkikeitto");
    await page
      .getByRole("button", { name: "Taio ostoslista", exact: true })
      .click();
    // B4.2: the dish is still saved, unpriced, and the store failure points to store settings.
    const error = page.getByRole("alert");
    await expect(error).toContainText(
      "Tuotteiden ja hintojen haku epäonnistui",
      {
        timeout: 20000,
      },
    );
    await expect(error).not.toContainText("Tarkista kirjautuminen");
    await expect(error).not.toContainText("ChatGPT");
    await expect(error.getByRole("button")).toContainText(
      "kauppojen asetukset",
    );
    const saved = await load();
    expect(saved.state.note).toBe("Nakkikeitto");
    expect(saved.basket.every((line) => !line.product)).toBe(true);
    expect((await load()).ai.state).toBe("connected");
  } finally {
    await app.close();
  }
});
