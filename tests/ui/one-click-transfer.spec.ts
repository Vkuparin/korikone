import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the transfer button sends the displayed list in one click; the review appears only when switched on", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-one-click-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    const list = (
      extras: { id: string; name: string; amount: number; unit: string }[],
    ) =>
      page.evaluate(async (extras) => {
        const api = window.korikone;
        let saved = { ok: false, error: "draftStale" } as Awaited<
          ReturnType<typeof api.save>
        >;
        for (let i = 0; i < 20 && !saved.ok; i++) {
          const state = (await api.load()).value.state;
          saved = await api.save({
            ...state,
            staples: [],
            // Over budget on purpose: a warning, not a reason to ask again.
            household: { ...state.household, budget: 1 },
            extras: extras as typeof state.extras,
          });
        }
        if (!saved.ok) throw new Error(saved.error);
      }, extras);
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    await list([
      { id: "milk", name: "Maito", amount: 2000, unit: "ml" },
      { id: "pasta", name: "Pasta", amount: 500, unit: "g" },
      { id: "unknown", name: "Tuntematon ruoka", amount: 1, unit: "pcs" },
    ]);
    await page.reload();
    const transfer = page.locator(".transfer-button");
    await expect(transfer).toBeEnabled();
    const before = await load();
    expect(before.state.reviewBeforeTransfer).toBe(false);
    expect(before.journal ?? null).toBeNull();

    await transfer.click();
    await expect
      .poll(async () => (await load()).journal?.status, { timeout: 20000 })
      .toBe("verified");
    const sent = await load();
    // No confirmation was shown or needed, and the row with no product was left out, not sent.
    expect(sent.transferException).toBeNull();
    expect(sent.review ?? null).toBeNull();
    expect(sent.journal!.review.targets.map((t) => t.productId)).toEqual([
      "milk",
      "pasta",
    ]);
    expect(sent.journal!.review.unresolved!.map((r) => r.id)).toEqual([
      "unknown",
    ]);
    expect(sent.journal!.review.total).toBeGreaterThan(1);
    const writes = sent.developmentStoreWrites;
    expect(writes).toBe(2);

    // With the review switched on, the next list waits for its confirmation.
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    expect(
      (
        await page.evaluate(() =>
          window.korikone.setReviewBeforeTransfer({ enabled: true }),
        )
      ).ok,
    ).toBe(true);
    await list([{ id: "pasta", name: "Pasta", amount: 1000, unit: "g" }]);
    await page.reload();
    await expect(transfer).toBeEnabled();
    await transfer.click();
    await expect(
      page.getByRole("region", { name: "Siirron vahvistus" }),
    ).toBeVisible();
    const waiting = await load();
    expect(waiting.transferException).toBe("acknowledgeReview");
    expect(waiting.review).not.toBeNull();
    expect(waiting.developmentStoreWrites).toBe(writes);
    expect(waiting.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
