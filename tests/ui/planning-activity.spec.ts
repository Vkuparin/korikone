import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import type { PlanningSnapshot } from "../../src/application/planning";
import { composer, startNewList, updateName } from "./composer-helper";

test("real planning stages drive one activity surface and read-only previews through success, failure and cancellation", async () => {
  test.setTimeout(120000);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-planning-activity-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_AI_PROVIDER = "fake-alternative";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const state = initialState();
    Object.assign(state, {
      onboarded: true,
      setupComplete: true,
      staples: [],
      extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    });
    state.context.storeId = "demo-delayed-search";
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.buildBasket();
      await window.korikone.signInAI();
    }, state);
    await page.reload();
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value!);
    let saved = await load();
    await page.evaluate(() => {
      const data = window as unknown as { activityEvents: PlanningSnapshot[] };
      data.activityEvents = [];
      window.korikone.onPlanningChange((event) =>
        data.activityEvents.push(event),
      );
    });
    await startNewList(page);
    // New list is a confirmed reset; later retention checks compare with the empty workspace.
    saved = await load();
    const note = composer(page);
    const primary = page.getByRole("button", { name: updateName });
    const local = page.locator("#note-update-help");
    const activity = local.locator(".planning-activity");
    const statuses = page.locator(
      '[data-operation-status][role="status"]:visible',
    );
    const cancels = page.getByRole("button", {
      name: /^(Peruuta listan päivitys|Peruuta)$/,
    });
    const preview = page.getByRole("region", { name: "Muodostuva lista" });
    await page.evaluate(() =>
      window.korikone.developmentScenario("delayedSuccess"),
    );
    await note.fill("200 ml kermaa ja kahvia");
    expect((await load()).developmentRequests).toBe(0);
    await primary.click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(local).toHaveAttribute("data-planning-activity", "pending");
    await expect(local).toHaveAttribute("data-planning-phase", "interpreting");
    await expect(statuses).toHaveCount(1);
    await expect(cancels).toHaveCount(1);
    await expect(primary).toBeDisabled();
    await expect(preview.getByText("Odotetaan tulkintaa.")).toBeVisible();
    expect(
      await activity.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("spin");
    expect(
      await page
        .locator(".note-box")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    const before = await primary.boundingBox();
    await primary.evaluate((button) => (button as HTMLButtonElement).click());
    await note.press("Control+Enter");
    await expect(local).toHaveAttribute("data-planning-phase", "searching");
    await expect(preview).toHaveAttribute("aria-busy", "true");
    await expect(
      preview.locator('[data-preview-status="pending"]'),
    ).toHaveCount(1);
    await expect(preview.getByText("kahvia", { exact: true })).toBeVisible();
    const searching = await primary.boundingBox();
    expect(searching).toEqual(before);
    expect(
      await activity.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("spin");
    await expect(
      preview.locator("button,input,select,textarea,a,[contenteditable=true]"),
    ).toHaveCount(0);
    await expect(page.locator(".planning-preview")).toHaveCount(1);
    await expect(preview.locator(".shopping-total")).toHaveCount(0);
    const pending = await load();
    expect(pending.state).toEqual(saved.state);
    expect(pending.basket).toEqual(saved.basket);
    await expect(local).toHaveAttribute("data-planning-phase", "resolving");
    expect(
      await activity.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("spin");
    await expect(statuses).toHaveCount(1);
    await expect(cancels).toHaveCount(1);
    await page
      .locator(".note-box")
      .screenshot({ path: "test-results/planning-activity-resolving.png" });
    await expect(local).toHaveAttribute("data-planning-phase", "committed", {
      timeout: 20000,
    });
    await expect(local).toHaveAttribute("data-planning-activity", "idle");
    await expect(preview).toHaveCount(0);
    const completed = await load();
    expect(completed.developmentRequests).toBe(2);
    const events = await page.evaluate(
      () =>
        (window as unknown as { activityEvents: PlanningSnapshot[] })
          .activityEvents,
    );
    expect(events.map((event) => event.phase)).toEqual(
      expect.arrayContaining([
        "interpreting",
        "searching",
        "resolving",
        "ready",
        "committing",
        "committed",
      ]),
    );
    expect(
      events.every(
        (event) =>
          event.model?.providerId === "fake-alternative" ||
          event.phase === "discovering",
      ),
    ).toBe(true);
    expect(
      events
        .filter((event) => event.phase === "searching")
        .some((event) =>
          event.provisional.rows.some(
            (row) => row.status === "pending" && row.total === null,
          ),
        ),
    ).toBe(true);
    expect(
      await activity.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");

    // A delayed failure stops activity and leaves the workspace as the confirmed reset left it and keeps the typed text.
    await startNewList(page);
    const afterReset = await load();
    await page.evaluate(() =>
      window.korikone.developmentScenario("delayedFailure"),
    );
    await note.fill("500 g suodatinjauhettua kahvia");
    await primary.click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(local).toHaveAttribute("data-planning-activity", "pending");
    await expect(primary).toBeDisabled();
    await expect(local).toHaveAttribute("data-planning-phase", "failed", {
      timeout: 20000,
    });
    await expect(local).toHaveAttribute("data-planning-activity", "idle");
    await expect(preview).toHaveCount(0);
    await expect(note).toHaveValue("500 g suodatinjauhettua kahvia");
    const failed = await load();
    expect(failed.state).toEqual(afterReset.state);
    expect(failed.basket).toEqual(afterReset.basket);
    expect(failed.developmentRequests).toBeLessThanOrEqual(2);
    expect(
      await activity.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");

    // Reduced motion keeps truthful activity and cancellation usable on both surfaces.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() =>
      window.korikone.developmentScenario("pendingSuccess"),
    );
    await primary.click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    await expect(local).toHaveAttribute("data-planning-activity", "pending");
    await expect(local).toHaveAttribute("data-planning-phase", "interpreting");
    expect(
      await activity.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");
    await expect(statuses).toHaveCount(1);
    await expect(cancels).toHaveCount(1);
    await page
      .locator(".note-box")
      .screenshot({ path: "test-results/planning-activity-reduced.png" });
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    const fallback = page.locator(".operation-fallback");
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveAttribute("data-operation-status", "global");
    await expect(fallback).toHaveAttribute("data-planning-activity", "pending");
    expect(
      await fallback.evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
    ).toBe("none");
    await expect(cancels).toHaveCount(1);
    await fallback
      .getByRole("button", { name: "Peruuta", exact: true })
      .click();
    await expect(statuses).toContainText("peruutettu");
    await expect(cancels).toHaveCount(0);
    const cancelled = await load();
    expect(cancelled.state).toEqual(afterReset.state);
    expect(cancelled.basket).toEqual(afterReset.basket);
    expect(cancelled.developmentRequests).toBe(1);
    expect(cancelled.developmentStoreWrites).toBe(0);
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(note).toHaveValue("500 g suodatinjauhettua kahvia");
    await expect(primary).toBeEnabled();
  } finally {
    await app.close();
  }
});

test("narrow held-pending activity stays readable on the composer and reduced-motion fallback", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-activity-layout-"),
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
      appearance: "light",
    });
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.setLanguage("en");
      await window.korikone.signInAI();
      await window.korikone.developmentScenario("pendingSuccess");
    }, state);
    await page.reload();
    await page.setViewportSize({ width: 800, height: 600 });
    await composer(page).fill("500 g suodatinjauhettua kahvia");
    await page.getByRole("button", { name: updateName }).click();
    await page.locator(".note-actions").scrollIntoViewIfNeeded();
    const statuses = page.locator(
      '[data-operation-status][role="status"]:visible',
    );
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveAttribute("data-operation-status", "composer");
    await expect(statuses).toHaveAttribute(
      "data-planning-phase",
      "interpreting",
    );
    const indicator = statuses.locator(".planning-activity");
    expect(
      await indicator.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("spin");
    await expect(
      page.getByRole("button", { name: "Cancel list update", exact: true }),
    ).toBeInViewport();
    await page.locator(".note-box").screenshot({
      path: "test-results/planning-activity-narrow-pending.png",
      animations: "disabled",
    });
    await expect(statuses).toHaveAttribute(
      "data-planning-phase",
      "interpreting",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await indicator.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const fallback = page.locator(".operation-fallback");
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toHaveAttribute("data-operation-status", "global");
    await expect(statuses).toHaveText("Interpreting your request…");
    await expect(fallback).toBeInViewport();
    expect(
      await fallback.evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
    ).toBe("none");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/planning-activity-narrow-fallback.png",
      animations: "disabled",
    });
    await fallback.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(statuses).toContainText("cancelled");
    const after = (await page.evaluate(() => window.korikone.load())).value!;
    expect(after.developmentRequests).toBe(1);
    expect(after.developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});
