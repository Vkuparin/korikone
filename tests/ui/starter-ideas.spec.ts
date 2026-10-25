import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { starterThemes } from "../../src/domain/starter-ideas";
import { composer, updateName } from "./composer-helper";

async function launch(edit = false, alternate = false) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-starters-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  if (alternate) env.KORIKONE_TEST_AI_PROVIDER = "fake-alternative";
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.korikone);
  const state = initialState();
  state.onboarded = state.setupComplete = true;
  state.staples = [];
  if (edit)
    state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
  if (alternate) state.language = "en";
  await page.evaluate(async (state) => {
    await window.korikone.save(state);
    await window.korikone.signInAI();
  }, state);
  await page.reload();
  return {
    app,
    page,
    load: async () => (await page.evaluate(() => window.korikone.load())).value,
  };
}

for (const theme of starterThemes)
  test(`${theme.id} generates fresh editable dishes and plans them through real IPC`, async () => {
    const { app, page, load } = await launch(false, theme.id === "vegetarian");
    try {
      const before = await load();
      const label = before.state.language === "fi" ? theme.fi : theme.en;
      const chip = page.getByRole("button", { name: label, exact: true });
      await chip.click();
      await expect
        .poll(async () => (await load()).starterIdeas?.theme)
        .toBe(theme.id);
      await expect(composer(page)).not.toBeEmpty();
      const first = await composer(page).inputValue();
      expect(first).not.toBe(label);
      expect((await load()).state).toEqual(before.state);
      expect((await load()).developmentRequests).toBe(1);
      await chip.click();
      await expect(composer(page)).not.toHaveValue(first);
      expect((await composer(page).inputValue()).split(", ")).toHaveLength(3);
      expect((await load()).developmentRequests).toBe(2);
      await page.getByRole("button", { name: updateName }).click();
      await expect.poll(async () => (await load()).state.meals.length).toBe(3);
      const planned = await load();
      expect(
        planned.committedIntents.every(
          (i) => i.intent.unresolvedReason === null,
        ),
      ).toBe(true);
      expect(planned.basket.some((l) => l.product !== null)).toBe(true);
      expect(planned.basket.some((l) => l.requirement.name === label)).toBe(
        false,
      );
      expect(planned.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });

test("existing grocery list receives starter names in the edit composer and keeps its coffee", async () => {
  const { app, page, load } = await launch(true);
  try {
    const before = await load();
    await page
      .getByRole("button", { name: "Lapsiperheen viikko", exact: true })
      .click();
    await expect(composer(page)).toHaveValue(/Makaronilaatikko/);
    expect((await load()).state).toEqual(before.state);
    await page.getByRole("button", { name: updateName }).click();
    await expect.poll(async () => (await load()).state.meals.length).toBe(3);
    expect((await load()).state.extras).toEqual(before.state.extras);
    expect((await load()).developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});

test("failed, cancelled and stale suggestions preserve the typed note and shopping list", async () => {
  const { app, page, load } = await launch();
  try {
    const note = composer(page);
    await note.fill("Oma suunnitelma");
    const before = (await load()).state;
    await page.evaluate(() =>
      window.korikone.developmentScenario("invalidDraft"),
    );
    await page
      .getByRole("button", { name: "Arkiviikon helpot ruoat", exact: true })
      .click();
    await expect.poll(async () => (await load()).developmentRequests).toBe(2);
    await expect(
      page.getByRole("button", {
        name: "Arkiviikon helpot ruoat",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(note).toHaveValue("Oma suunnitelma");
    await page.evaluate(() =>
      window.korikone.developmentScenario("delayedSuccess"),
    );
    await page
      .getByRole("button", { name: "Arkiviikon helpot ruoat", exact: true })
      .click();
    await expect.poll(async () => (await load()).developmentRequests).toBe(1);
    await note.fill("Muokattu odottaessa");
    await expect(
      page.getByRole("button", {
        name: "Arkiviikon helpot ruoat",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(note).toHaveValue("Muokattu odottaessa");
    await page
      .getByRole("button", { name: "Arkiviikon helpot ruoat", exact: true })
      .click();
    await page
      .locator(".operation-fallback")
      .getByRole("button", { name: "Peruuta", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Arkiviikon helpot ruoat",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(note).toHaveValue("Muokattu odottaessa");
    expect((await load()).state).toEqual(before);
    expect((await load()).developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});
