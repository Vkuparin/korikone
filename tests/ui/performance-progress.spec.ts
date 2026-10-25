import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import type { OperationProgress } from "../../src/application/operation-progress";
import { composer, updateName } from "./composer-helper";
import { settingsCategory } from "./settings-helper";

async function fixture() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-performance-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.korikone);
  const state = initialState();
  state.onboarded = state.setupComplete = true;
  state.staples = [];
  await page.evaluate(async (state) => {
    await window.korikone.save(state);
    await window.korikone.signInAI();
  }, state);
  await page.reload();
  const load = async () =>
    (await page.evaluate(() => window.korikone.load())).value;
  await page.evaluate(() => {
    const events: OperationProgress[] = [];
    (
      window as unknown as { operationEvents: OperationProgress[] }
    ).operationEvents = events;
    window.korikone.onOperationProgress((p) => events.push(p));
  });
  const events = () =>
    page.evaluate(
      () =>
        (window as unknown as { operationEvents: OperationProgress[] })
          .operationEvents,
    );
  return { app, page, load, events };
}

test("opening AI settings reuses known models and leaves the active operation in control", async () => {
  const { app, page, load } = await fixture();
  try {
    await page.evaluate(() =>
      window.korikone.developmentScenario("pendingSuccess"),
    );
    await composer(page).fill("Nakkikeitto");
    await page.getByRole("button", { name: updateName }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.getOperationProgress()))
            .value?.stage,
      )
      .toBe("generating");
    const operation = (
      await page.evaluate(() => window.korikone.getOperationProgress())
    ).value!;
    const before = await load();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "ai", "ChatGPT ja tekoäly");
    await expect(
      page.getByRole("button", { name: "Hae mallit uudelleen", exact: true }),
    ).toBeVisible();
    const active = (
      await page.evaluate(() => window.korikone.getOperationProgress())
    ).value!;
    expect(active.id).toBe(operation.id);
    expect(active.stage).toBe("generating");
    expect((await load()).developmentModelCatalogueRequests).toBe(
      before.developmentModelCatalogueRequests,
    );
    await page
      .locator(".operation-fallback")
      .getByRole("button", { name: "Peruuta", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.getOperationProgress()))
            .value?.stage,
      )
      .toBe("cancelled");
  } finally {
    await app.close();
  }
});

test("AI progress survives long waits and viewport changes with one visible status and bounded cancellation", async () => {
  const { app, page, load, events } = await fixture();
  try {
    await page.clock.install();
    await page.evaluate(() =>
      window.korikone.developmentScenario("pendingSuccess"),
    );
    await composer(page).fill("Nakkikeitto ja kanapasta");
    await page.getByRole("button", { name: updateName }).click();
    await expect
      .poll(async () => (await events()).some((e) => e.stage === "generating"))
      .toBe(true);
    await page.clock.fastForward(20000);
    await expect(page.locator("[data-operation-status]:visible")).toHaveCount(
      1,
    );
    await expect(page.locator(".operation-wait:visible")).toContainText(
      "odotetaan edelleen",
    );
    await expect(page.locator("progress:visible")).not.toHaveAttribute("value");
    await page.setViewportSize({ width: 800, height: 600 });
    await page.clock.fastForward(1000);
    await expect(page.locator("[data-operation-status]:visible")).toHaveCount(
      1,
    );
    const current = (await events()).at(-1)!;
    const cancelled = await page.evaluate(
      (id) => window.korikone.cancelOperation({ operationId: id }),
      current.id,
    );
    expect(cancelled.ok).toBe(true);
    await expect
      .poll(async () =>
        (await events()).some(
          (e) => e.id === current.id && e.stage === "cancelled",
        ),
      )
      .toBe(true);
    await expect(composer(page)).toHaveValue("Nakkikeitto ja kanapasta");
    expect((await load()).state.meals).toEqual([]);
    expect((await load()).developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});

test("real row progress, local removals and purchase views avoid redundant work", async () => {
  const { app, page, load, events } = await fixture();
  try {
    await composer(page).fill("Nakkikeitto ja kanapasta");
    await page.getByRole("button", { name: updateName }).click();
    await expect.poll(async () => (await load()).state.meals.length).toBe(2);
    const rowEvents = (await events()).filter(
      (e) => e.stage === "searching" && e.total !== null,
    );
    expect(rowEvents.some((e) => e.completed === e.total)).toBe(true);
    expect(rowEvents.every((e) => e.completed! <= e.total!)).toBe(true);
    // Let initial history/suggestion data arrive, then make unrelated local edits.
    await expect
      .poll(async () => (await load()).developmentInsightsReads)
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Reseptit", exact: true }).click();
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    const before = await load();
    const remove = page
      .getByRole("complementary")
      .getByRole("button", { name: "Poista: Pasta", exact: true });
    await remove.click();
    await expect(remove).toHaveCount(0);
    const after = await load();
    expect(after.developmentInsightsReads).toBe(
      before.developmentInsightsReads,
    );
    expect(after.developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
    expect(after.developmentRequests).toBe(before.developmentRequests);
    expect(after.quotedAt).toBe(before.quotedAt);
    expect(after.developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});

test("an active request restores its progress after renderer reload and ignores an old cancellation ID", async () => {
  const { app, page, load } = await fixture();
  try {
    await page.evaluate(() =>
      window.korikone.developmentScenario("pendingSuccess"),
    );
    await composer(page).fill("Kanapasta");
    await page.getByRole("button", { name: updateName }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.getOperationProgress()))
            .value?.stage,
      )
      .toBe("generating");
    const first = (
      await page.evaluate(() => window.korikone.getOperationProgress())
    ).value!;
    await page.reload();
    await expect(page.locator("[data-operation-status]:visible")).toHaveCount(
      1,
    );
    await expect(page.locator("[data-operation-status]:visible")).toContainText(
      "tekoälyn vastausta",
    );
    await page.evaluate(() =>
      window.korikone.cancelOperation({
        operationId: "a8faf7cd-34d8-4c0f-9c84-1b5573137d35",
      }),
    );
    expect(
      (await page.evaluate(() => window.korikone.getOperationProgress())).value
        ?.id,
    ).toBe(first.id);
    await page
      .locator(".operation-fallback")
      .getByRole("button", { name: "Peruuta", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.getOperationProgress()))
            .value?.stage,
      )
      .toBe("cancelled");
    expect((await load()).developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});
