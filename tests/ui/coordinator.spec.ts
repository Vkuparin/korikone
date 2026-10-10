import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import type { PlanningSnapshot } from "../../src/application/planning";

for (const provider of ["chatgpt", "fake-alternative"])
  test(`${provider}: coordinator IPC reaches ready with unknown requests and no saved-plan or basket changes`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-coordinator-"),
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
      const reply = await page.evaluate(async () => {
        const data = window as unknown as {
          coordinatorEvents: PlanningSnapshot[];
        };
        data.coordinatorEvents = [];
        const unsubscribe = window.korikone.onPlanningChange((event) =>
          data.coordinatorEvents.push(event),
        );
        try {
          return await window.korikone.planShopping({
            prompt: "1 l maitoa ja kahvia",
            consent: true,
          });
        } finally {
          unsubscribe();
        }
      });
      expect(reply.ok, reply.error).toBe(true);
      expect(reply.value.planning).toMatchObject({
        phase: "ready",
        transferEligible: false,
        model: { providerId: provider },
      });
      expect(
        reply.value.planning!.intents.map((result) => [
          result.intent.label,
          result.status,
          result.reason,
        ]),
      ).toEqual([
        ["1 l maitoa", "resolved", null],
        ["kahvia", "unresolved", "unknown-quantity"],
      ]);
      expect(reply.value.planning!.counters).toEqual({
        aiCalls: 1,
        searches: 1,
      });
      expect(reply.value.state).toEqual(before.state);
      expect(reply.value.basket).toEqual(before.basket);
      expect(reply.value.review).toEqual(before.review);
      expect(reply.value.journal).toEqual(before.journal);
      const events = await page.evaluate(
        () =>
          (window as unknown as { coordinatorEvents: PlanningSnapshot[] })
            .coordinatorEvents,
      );
      expect(events.map((event) => event.phase)).toContain("searching");
      expect(
        events.every(
          (event, index) =>
            !index || event.sequence > events[index - 1].sequence,
        ),
      ).toBe(true);
      expect(await page.evaluate(() => window.korikone.prepare())).toEqual({
        ok: false,
        error: "planningPending",
      });
      await page.evaluate(
        (operationId) => window.korikone.cancelPlanning({ operationId }),
        reply.value.planning!.operationId,
      );
      const after = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(after.state).toEqual(before.state);
      expect(after.basket).toEqual(before.basket);
      expect(after.planning!.phase).toBe("cancelled");
      expect(after.developmentRequests).toBe(1);
    } finally {
      await app.close();
    }
  });
