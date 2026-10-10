import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import type { PlanningSnapshot } from "../../src/application/planning";

for (const provider of ["chatgpt", "fake-alternative"])
  test(`${provider}: real planning IPC owns previews, rejects stale cancellation and obsoletes changed notes`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-planning-ui-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    env.KORIKONE_TEST_AI_PROVIDER = provider;
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = true;
      state.setupComplete = true;
      state.staples = [];
      state.extras = [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }];
      await page.evaluate(async (state) => {
        await window.korikone.save(state);
        await window.korikone.buildBasket();
        await window.korikone.signInAI();
      }, state);
      const before = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      await page.evaluate(async () => {
        const data = window as unknown as {
          planningEvents: PlanningSnapshot[];
          planningReply: Promise<unknown>;
          removePlanningListener: () => void;
        };
        data.planningEvents = [];
        data.removePlanningListener = window.korikone.onPlanningChange(
          (value) => data.planningEvents.push(value),
        );
        await window.korikone.developmentScenario("pendingSuccess");
        data.planningReply = window.korikone.generate({
          prompt: "Puuroa",
          consent: true,
        });
      });
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      await expect
        .poll(async () => (await load()).planning?.phase)
        .toBe("interpreting");
      const operation = (await load()).planning!;
      expect(operation.model?.providerId).toBe(provider);
      expect(operation.transferEligible).toBe(false);
      expect(await page.evaluate(() => window.korikone.prepare())).toEqual({
        ok: false,
        error: "planningPending",
      });
      const rejected = await page.evaluate(() =>
        window.korikone.cancelPlanning({
          operationId: "00000000-0000-4000-8000-000000000000",
        }),
      );
      expect(rejected).toEqual({ ok: false, error: "planningStale" });
      expect((await load()).planning!.operationId).toBe(operation.operationId);
      const invalidated = await page.evaluate(
        (operationId) =>
          window.korikone.invalidatePlanning({
            operationId,
            reason: "note-changed",
          }),
        operation.operationId,
      );
      expect(invalidated.ok).toBe(true);
      const reply = await page.evaluate(
        async () =>
          await (window as unknown as { planningReply: Promise<unknown> })
            .planningReply,
      );
      expect(reply).toEqual({ ok: false, error: "draftStale" });
      const after = await load();
      expect(after.planning).toMatchObject({
        phase: "obsolete",
        failure: "source-changed",
        provisional: { meals: [], rows: [] },
      });
      expect(after.state).toEqual(before.state);
      expect(after.basket).toEqual(before.basket);
      expect(after.developmentRequests).toBe(1);
      expect(after.developmentStoreWrites).toBe(0);
      const events = await page.evaluate(
        () =>
          (window as unknown as { planningEvents: PlanningSnapshot[] })
            .planningEvents,
      );
      expect(events.map((event) => event.phase)).toContain("discovering");
      expect(events.map((event) => event.phase)).toContain("interpreting");
      expect(events.at(-1)?.phase).toBe("obsolete");
      expect(
        events.every(
          (event) =>
            event.operationId === operation.operationId &&
            event.transferEligible === false,
        ),
      ).toBe(true);
      expect(
        events.every(
          (event, index) =>
            index === 0 || event.sequence > events[index - 1].sequence,
        ),
      ).toBe(true);
      await page.evaluate(async () => {
        await window.korikone.developmentScenario("success");
      });
      const success = await page.evaluate(() =>
        window.korikone.generate({ prompt: "Puuroa", consent: true }),
      );
      expect(success.ok).toBe(true);
      expect(success.value.planning).toMatchObject({
        phase: "interpreted",
        transferEligible: false,
      });
      expect(success.value.planning!.operationId).not.toBe(
        operation.operationId,
      );
      expect(success.value.planning!.provisional.meals[0].name).toBe(
        "Kaurapuuro",
      );
      const old = await page.evaluate(
        (operationId) => window.korikone.cancelPlanning({ operationId }),
        operation.operationId,
      );
      expect(old).toEqual({ ok: false, error: "planningStale" });
      const next = { ...success.value.state, note: "New saved note" };
      await page.evaluate((next) => window.korikone.save(next), next);
      expect((await load()).planning?.phase).toBe("obsolete");
      await page.evaluate(() =>
        (
          window as unknown as { removePlanningListener: () => void }
        ).removePlanningListener(),
      );
    } finally {
      await app.close();
    }
  });
