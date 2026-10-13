import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const provider of ["chatgpt", "fake-alternative"])
  test(`${provider}: real commit IPC preserves unknown requests, displays a subtotal and restores the quote on restart`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-planning-commit-ui-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    env.KORIKONE_TEST_AI_PROVIDER = provider;
    let app = await electron.launch({ args: ["."], env });
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.onboarded = true;
      state.setupComplete = true;
      state.staples = [];
      await page.evaluate(async (state) => {
        await window.korikone.save(state);
        await window.korikone.signInAI();
      }, state);
      const before = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      const ready = await page.evaluate(() =>
        window.korikone.planShopping({
          prompt: "1 l maitoa ja kahvia",
          consent: true,
        }),
      );
      expect(ready.ok, ready.error).toBe(true);
      const committed = await page.evaluate(
        (operationId) => window.korikone.commitPlanning({ operationId }),
        ready.value.planning!.operationId,
      );
      expect(committed.ok, committed.error).toBe(true);
      expect(committed.value.state.revision).toBe(before.state.revision + 1);
      expect(committed.value.planning!.phase).toBe("committed");
      expect(committed.value.committedIntents[1]).toMatchObject({
        status: "unresolved",
        reason: "unknown-quantity",
        intent: { label: "kahvia", quantity: { amount: null, unit: null } },
      });
      expect(committed.value.developmentStoreWrites).toBe(0);
      expect(await page.evaluate(() => window.korikone.prepare())).toEqual({
        ok: false,
        error: "unresolved",
      });
      await page.reload();
      await expect(
        page.getByRole("region", { name: "Ratkaisemattomat pyynnöt" }),
      ).toContainText("kahvia");
      await expect(
        page.getByText("Tunnettujen hintojen välisumma", { exact: true }),
      ).toBeVisible();
      const beforeRestart = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      await app.close();
      app = await electron.launch({ args: ["."], env });
      page = await app.firstWindow();
      const restored = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(restored.state).toEqual(committed.value.state);
      expect(restored.basket).toEqual(committed.value.basket);
      expect(restored.committedIntents).toEqual(
        committed.value.committedIntents,
      );
      expect(restored.planning).toBeNull();
      expect(restored.review).toBeNull();
      expect(restored.developmentRequests).toBe(0);
      expect(restored.developmentCatalogueRequests).toBe(0);
      expect(restored.developmentStoreWrites).toBe(0);
      expect(restored.quotedAt).toBe(beforeRestart.quotedAt);
      await expect(
        page.getByRole("region", { name: "Ratkaisemattomat pyynnöt" }),
      ).toContainText("kahvia");
      await expect(
        page.getByText("Tunnettujen hintojen välisumma", { exact: true }),
      ).toBeVisible();
      await page.evaluate(() =>
        window.korikone.setReviewBeforeTransfer({ enabled: true }),
      );
      await page.reload();
      await page
        .getByRole("button", { name: /Siirrä ja avaa kaupan ostoskori/ })
        .click();
      await expect(
        page.getByRole("region", { name: "Siirron vahvistus" }),
      ).toContainText("kahvia");
      const reviewed = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(reviewed.review!.unresolvedIntents![0].intent.label).toBe(
        "kahvia",
      );
      expect(reviewed.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
