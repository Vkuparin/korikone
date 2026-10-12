import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("create, multi-edit, commit, undo, restart and a changed-plan exception stay local, bounded and exact", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-journey-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta", exact: true })
      .click();

    // Create through the real planning path.
    const created = await page.evaluate(async () => {
      const api = window.korikone;
      const signedIn = await api.signInAI();
      if (!signedIn.ok) throw new Error(signedIn.error);
      const saved = await api.save({
        ...signedIn.value.state,
        staples: [],
        household: { ...signedIn.value.state.household, budget: 1_000_000 },
      });
      if (!saved.ok) throw new Error(saved.error);
      let operationId: string | null = null;
      const planned = await api.planShopping({
        prompt: "Nakkikeitto, kanapasta ja 700 g pakastepizza",
        consent: true,
      });
      if (!planned.ok) throw new Error(planned.error);
      operationId = planned.value.planning?.operationId ?? null;
      if (!operationId) throw new Error("noOperation");
      const committed = await api.commitPlanning({ operationId });
      if (!committed.ok) throw new Error(committed.error);
      return committed.value;
    });
    expect(created.state.meals.length).toBeGreaterThanOrEqual(2);
    expect(created.basket.length).toBeGreaterThan(3);
    expect(created.developmentRequests).toBeLessThanOrEqual(2);
    expect(created.quotedAt).not.toBeNull();
    expect(created.editUndoAvailable).toBe(false);
    // One multi-part edit: at most two requests, no retailer write, only changed rows read again.
    const edited = await page.evaluate(
      async ({ revision, searches }) => {
        const api = window.korikone;
        const result = await api.editList({
          revision,
          instruction:
            "tuplaa keitto, lisää 500 ml maitoa ja lisää 500 g kahvia",
          consent: true,
        });
        if (!result.ok) throw new Error(result.error);
        return { ...result.value, searchesBefore: searches };
      },
      {
        revision: created.state.revision,
        searches: created.developmentCatalogueRequests,
      },
    );
    expect(edited.edit).toMatchObject({ status: "applied" });
    if (edited.edit?.status !== "applied") throw new Error("not applied");
    expect(edited.edit.applied.map((a) => a.op).sort()).toEqual([
      "addItem",
      "addItem",
      "changeServings",
    ]);
    expect(edited.state.revision).toBe(created.state.revision + 1);
    expect(
      edited.developmentRequests - created.developmentRequests,
    ).toBeLessThanOrEqual(2);
    expect(edited.developmentStoreWrites).toBe(created.developmentStoreWrites);
    // Fewer searches than regenerating: pizza, pasta and the other unchanged rows were retained.
    const editSearches =
      edited.developmentCatalogueRequests - edited.searchesBefore;
    expect(editSearches).toBeGreaterThan(0);
    expect(editSearches).toBeLessThan(created.developmentCatalogueRequests);
    expect(edited.edit.delta.retained.length).toBeGreaterThan(0);
    // Unrelated groceries survive with the same quoted lines.
    for (const row of edited.edit.delta.retained) {
      const before = created.basket.find(
        (l) => `${l.requirement.id}:${l.requirement.unit}` === row.key,
      );
      const after = edited.basket.find(
        (l) => `${l.requirement.id}:${l.requirement.unit}` === row.key,
      );
      expect(after).toEqual(before);
    }
    expect(edited.state.meals.filter((m) => !m.leftovers).length).toBe(
      created.state.meals.filter((m) => !m.leftovers).length,
    );

    // Commit the displayed edited list. This is the only retailer write of the journey.
    const transferred = await page.evaluate(async (edited) => {
      const api = window.korikone;
      const requested = await api.transferDisplayed({
        revision: edited.state.revision,
        quotedAt: edited.quotedAt,
        batchKey: edited.transferBatchKey,
      });
      if (!requested.ok) throw new Error(requested.error);
      // The shopper's confirmation of the review: the only retailer write of the journey.
      const review = requested.value.review;
      if (!review) return requested.value;
      const executed = await api.execute({ id: review.id, acknowledged: true });
      if (!executed.ok) throw new Error(executed.error);
      return executed.value;
    }, edited);
    expect(transferred.developmentStoreWrites).toBeGreaterThan(
      edited.developmentStoreWrites,
    );
    expect(transferred.editUndoAvailable).toBe(true);

    // Undo after the transfer is local: no request, no search, no retailer call.
    const undone = await page.evaluate(async (transferred) => {
      const result = await window.korikone.undoEdit({
        revision: transferred.state.revision,
      });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    }, transferred);
    expect(undone.edit).toMatchObject({ status: "undone" });
    expect(undone.state.meals).toEqual(created.state.meals);
    expect(undone.state.extras).toEqual(created.state.extras);
    expect(undone.state.revision).toBe(transferred.state.revision + 1);
    expect(undone.editUndoAvailable).toBe(false);
    expect(undone.developmentStoreWrites).toBe(
      transferred.developmentStoreWrites,
    );
    expect(undone.developmentRequests).toBe(transferred.developmentRequests);
    expect(undone.developmentCatalogueRequests).toBe(
      transferred.developmentCatalogueRequests,
    );
    // The transfer record stays; the restored list is a different batch.
    expect(undone.transferBatchKey).not.toBe(edited.transferBatchKey);

    // A restart restores the same list and offers no undo.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = (await page.evaluate(() => window.korikone.load())).value;
    expect(restarted.state.meals).toEqual(undone.state.meals);
    expect(restarted.state.revision).toBe(undone.state.revision);
    expect(restarted.editUndoAvailable).toBe(false);
    expect(restarted.developmentRequests).toBe(0);

    // Changed-plan exception: an approval for the earlier plan cannot execute after a new edit.
    const stale = await page.evaluate(async (restarted) => {
      const api = window.korikone;
      await api.signInAI();
      const approval = {
        revision: restarted.state.revision,
        quotedAt: restarted.quotedAt,
        batchKey: restarted.transferBatchKey,
      };
      const edit = await api.editList({
        revision: restarted.state.revision,
        instruction: "lisää 300 g kahvia",
        consent: true,
      });
      if (!edit.ok) throw new Error(edit.error);
      const writes = edit.value.developmentStoreWrites;
      const result = await api.transferDisplayed(approval);
      const after = (await api.load()).value;
      return {
        result,
        writes,
        writesAfter: after.developmentStoreWrites,
        revision: after.state.revision,
        editedRevision: edit.value.state.revision,
      };
    }, restarted);
    expect(stale.result.ok).toBe(false);
    expect(stale.result.error).toBe("draftStale");
    expect(stale.writesAfter).toBe(stale.writes);
    expect(stale.revision).toBe(stale.editedRevision);
  } finally {
    await app.close();
  }
});
