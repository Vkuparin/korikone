import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a list with a non-food row transfers its groceries only, and a non-food list transfers nothing", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-nonfood-transfer-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    const boots = {
      id: "kumisaapas",
      name: "Kumisaapas",
      amount: 1,
      unit: "pcs",
      merchandise: {
        version: 1,
        family: "kumisaapas",
        attributes: [
          { kind: "size", value: "32", provenance: "explicit-note" },
        ],
        missing: [],
      },
    };
    const list = (extras: object[]) =>
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
            extras: extras as typeof state.extras,
          });
        }
        if (!saved.ok) throw new Error(saved.error);
      }, extras);
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    await list([
      { id: "milk", name: "Maito", amount: 2000, unit: "ml" },
      boots,
    ]);
    await page.reload();
    const transfer = page.locator(".transfer-button");
    await expect(transfer).toBeEnabled();
    // The K stand-in has a non-food shelf: size 32 is found and reported available, nothing
    // can be written, so the app lists the row as the shopper's own to add.
    const before = await load();
    expect(before.merchandise).toMatchObject({
      capabilities: { discovery: true, cartWrite: false },
      manual: [
        { requirementKey: "kumisaapas:pcs", productId: "boots-32", packs: 1 },
      ],
      statuses: [
        { requirementKey: "kumisaapas:pcs", status: "exact-available" },
      ],
    });
    await expect(page.locator(".merchandise-manual")).toBeVisible();

    await transfer.click();
    await expect
      .poll(async () => (await load()).journal?.status, { timeout: 20000 })
      .toBe("verified");
    const sent = await load();
    expect(sent.journal!.review.targets.map((t) => t.productId)).toEqual([
      "milk",
    ]);
    // Not "unresolved": it has an exact product, and is handed over by hand.
    expect(sent.journal!.review.unresolved ?? []).toEqual([]);
    expect(sent.journal!.review.manual?.map((m) => m.productId)).toEqual([
      "boots-32",
    ]);
    expect(sent.developmentStoreWrites).toBe(1);
    // The row is still on the list after the transfer and after a restart.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = await load();
    expect(restarted.state.extras.map((e) => e.id)).toContain("kumisaapas");
    expect(restarted.journal?.status).toBe("verified");

    // A list of the non-food row alone: nothing is sent and no transfer record is made.
    await list([boots]);
    const only = await load();
    const clicked = await page.evaluate(
      (input) => window.korikone.transferDisplayed(input),
      {
        revision: only.state.revision,
        quotedAt: only.quotedAt ?? "",
        batchKey: only.transferBatchKey,
      },
    );
    expect(clicked.ok && clicked.value.journal?.status).not.toBe(
      "transferring",
    );
    const after = await load();
    expect(after.developmentStoreWrites).toBe(0);
    expect(after.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
