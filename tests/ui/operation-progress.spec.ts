import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { composer, startNewList, updateName } from "./composer-helper";
import { settingsCategory } from "./settings-helper";

test("one request retains one progress/cancel surface across scroll, navigation and cancellation", async () => {
  test.setTimeout(120000);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-progress-surface-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const state = initialState();
    Object.assign(state, {
      onboarded: true,
      setupComplete: true,
      staples: [],
      extras: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
    });
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.buildBasket();
      await window.korikone.signInAI();
    }, state);
    await page.reload();
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value!);
    await startNewList(page);
    // New list is a confirmed reset: the retained state below is the empty workspace.
    const saved = await load();
    await composer(page).fill("Nakkikeitto");
    expect((await load()).developmentRequests).toBe(0);
    await page.evaluate(() =>
      window.korikone.developmentScenario("pendingSuccess"),
    );
    await page.getByRole("button", { name: updateName }).click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/progress-initial.png" });
    const statuses = page.locator(
      '[data-operation-status][role="status"]:visible',
    );
    const cancelButtons = page.getByRole("button", {
      name: /^(Peruuta listan päivitys|Peruuta)$/,
    });
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveAttribute("data-operation-status", "composer");
    await expect(statuses).toHaveAttribute(
      "data-planning-phase",
      "interpreting",
    );
    await expect(cancelButtons).toHaveCount(1);
    await expect(page.locator(".operation-fallback")).toHaveCount(0);
    await expect(page.locator(".note-elapsed")).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(statuses).toHaveAttribute("data-operation-status", "composer");
    const originalFocus = await page.evaluate(() => document.activeElement?.id);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveAttribute("data-operation-status", "global");
    await expect(page.locator(".operation-fallback")).toBeInViewport();
    await expect(cancelButtons).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      originalFocus,
    );
    await page.screenshot({
      path: "test-results/progress-scroll-fallback.png",
    });
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    const navigationFocus = await page.evaluate(
      () => document.activeElement?.textContent,
    );
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveAttribute("data-operation-status", "global");
    await expect(statuses).toHaveAttribute(
      "data-planning-phase",
      "interpreting",
    );
    await expect(cancelButtons).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(
      navigationFocus,
    );
    const operationId = (await load()).planning!.operationId;
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(statuses).toHaveAttribute("data-operation-status", "composer");
    await expect(cancelButtons).toHaveCount(1);
    await expect(composer(page)).toHaveValue("Nakkikeitto");
    expect((await load()).planning!.operationId).toBe(operationId);

    // Cancel from the global fallback; the same operation and saved quote are retained.
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await page
      .locator(".operation-fallback")
      .getByRole("button", { name: "Peruuta", exact: true })
      .click();
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toContainText("peruutettu");
    await expect(cancelButtons).toHaveCount(0);
    const cancelled = await load();
    expect(cancelled.planning).toMatchObject({
      operationId,
      phase: "cancelled",
    });
    expect(cancelled.state).toEqual(saved.state);
    expect(cancelled.basket).toEqual(saved.basket);
    expect(cancelled.developmentRequests).toBe(1);
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(composer(page)).toHaveValue("Nakkikeitto");
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveAttribute("data-operation-status", "composer");
    await expect(statuses).toContainText("peruutettu");
    await expect(page.locator(".operation-fallback")).toHaveCount(0);

    // A model catalogue lookup belongs to Settings, so the generic global status stays available.
    await page.evaluate(() =>
      window.korikone.developmentScenario("delayedModels"),
    );
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "ai", "ChatGPT ja tekoäly");
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveText("Käsitellään…");
    await expect(
      page
        .locator(".operation-fallback")
        .getByRole("button", { name: "Peruuta", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".operation-fallback")).not.toContainText(
      "peruutettu",
    );
    await expect(page.locator(".operation-fallback")).toContainText(
      "peruutettu",
      { timeout: 10000 },
    );
    const after = await load();
    expect(after.developmentRequests).toBe(0);
    expect(after.developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});

test("navigation keeps a pending composer request alive through its real commit", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-progress-commit-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const state = initialState();
    Object.assign(state, { onboarded: true, setupComplete: true, staples: [] });
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("delayedSuccess");
    }, state);
    await page.reload();
    const note = "500 g suodatinjauhettua kahvia";
    await composer(page).fill(note);
    await page.getByRole("button", { name: updateName }).click();
    await page.getByRole("button", { name: "Reseptit", exact: true }).click();
    const globalStatus = page.locator('[data-operation-status="global"]');
    await expect(globalStatus).toHaveAttribute(
      "data-planning-phase",
      "interpreting",
    );
    await expect(globalStatus).toHaveText("Lista päivitetty", {
      timeout: 20000,
    });
    const completed = (await page.evaluate(() => window.korikone.load()))
      .value!;
    expect(completed.state.note).toBe(note);
    expect(completed.state.extras).toHaveLength(1);
    expect(completed.state.extras[0].amount).toBe(500);
    expect(completed.planning!.phase).toBe("committed");
    expect(completed.developmentRequests).toBe(1);
    expect(completed.developmentStoreWrites).toBe(0);
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(composer(page)).toHaveAccessibleName(
      "Muokkaa nykyistä listaa",
    );
    await expect(page.locator(".operation-fallback")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("current-list edits share cancellation and retain their instruction after navigation", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-progress-edit-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const state = initialState();
    Object.assign(state, {
      onboarded: true,
      setupComplete: true,
      staples: [],
      extras: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
    });
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.setLanguage("en");
      await window.korikone.buildBasket();
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("pendingSuccess");
    }, state);
    await page.reload();
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value!);
    const before = await load();
    await composer(page).fill("add 500 g coffee");
    await page.getByRole("button", { name: updateName }).click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    const statuses = page.locator(
      '[data-operation-status][role="status"]:visible',
    );
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveText("Editing the list…");
    await expect(
      page.getByRole("button", { name: "Cancel change", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".operation-fallback")).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(statuses).toHaveAttribute("data-operation-status", "global");
    await expect(statuses).toHaveText("Editing the list…");
    await page
      .locator(".operation-fallback")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(statuses).toHaveText(
      "Change cancelled. Your previous list is retained.",
    );
    await expect(
      page.locator(".operation-fallback").getByRole("button"),
    ).toHaveCount(0);
    const after = await load();
    expect(after.state).toEqual(before.state);
    expect(after.basket).toEqual(before.basket);
    expect(after.developmentRequests).toBe(1);
    expect(after.developmentStoreWrites).toBe(0);
    await page
      .getByRole("button", { name: "Shopping list", exact: true })
      .click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(composer(page)).toHaveValue("add 500 g coffee");
    await expect(statuses).toHaveAttribute("data-operation-status", "composer");
    await expect(statuses).toHaveCount(1);
    await expect(page.locator(".operation-fallback")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
