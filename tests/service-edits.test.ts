import { expect, test } from "vitest";
import { Service, type Storage } from "../src/application/service";
import { EDIT_UNDO_KEY } from "../src/application/edits";
import { readMetrics } from "../src/application/metrics";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import { InferenceSession, discoverInferenceModels } from "../src/ai/provider";
import { DemoProvider } from "../src/stores/demo";
import { editPlan } from "./helpers/edit-plan";

/** In-memory documents with the SQLite worker's all-or-nothing `setMany`. */
function memory() {
  const entries = new Map<string, unknown>();
  let fail: "before" | "after" | null = null;
  const storage: Storage = {
    get: async (key) => structuredClone(entries.get(key)),
    set: async (key, value) => {
      entries.set(key, structuredClone(value));
    },
    setMany: async (batch) => {
      if (fail === "before") throw new Error("storageFailed");
      for (const entry of structuredClone(batch))
        entries.set(entry.key, entry.value);
      if (fail === "after") throw new Error("storageFailed");
    },
  };
  return {
    storage,
    entries,
    failNext: (mode: "before" | "after" | null) => (fail = mode),
  };
}
/** The development inference path: fixture connection behind the fake alternative provider. */
async function inference(replies: string[] = []) {
  const connection = new (class extends FixtureAI {
    prompts = 0;
    override async generatePinned(
      model: string,
      prompt: string,
      signal: AbortSignal,
    ) {
      const reply = replies[this.prompts++];
      return reply ?? super.generatePinned(model, prompt, signal);
    }
  })();
  await connection.signIn();
  const provider = new FakeInferenceProvider(connection, true);
  const controller = new AbortController();
  const models = await discoverInferenceModels(provider, controller.signal);
  const sessions: InferenceSession[] = [];
  return {
    connection,
    controller,
    sessions,
    session: async () => {
      sessions.push(
        new InferenceSession(
          provider,
          models[0],
          { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 180_000 },
          controller.signal,
        ),
      );
      return sessions.at(-1)!;
    },
  };
}
async function fixture(quote = true) {
  const store = memory();
  const service = new Service(store.storage);
  service.developmentMode = true;
  await store.storage.set("state", editPlan());
  await service.init();
  if (quote) await service.buildBasket();
  const provider = service.registry.get("demo-k") as DemoProvider;
  return { ...store, service, provider, ai: await inference() };
}
const edit = (
  service: Service,
  instruction: string,
  focusTargetId?: string,
) => ({
  revision: service.state.revision,
  instruction,
  consent: true as const,
  ...(focusTargetId ? { focusTargetId } : {}),
});
const line = (service: Service, key: string) =>
  service.basket.find(
    (l) => `${l.requirement.id}:${l.requirement.unit}` === key,
  );

test("an edit prices only the changed rows and keeps the rest of the quote as it was", async () => {
  const { service, provider, ai, entries } = await fixture();
  const full = provider.searchRequests;
  const quotedAt = service.quotedAt;
  const pasta = structuredClone(line(service, "pasta:g"));
  const milk = structuredClone(line(service, "milk:ml"));
  expect(line(service, "potato:g")).toMatchObject({ packs: 1, total: 199 });
  provider.searchRequests = 0;
  const snapshot = await service.editList(
    edit(service, "tuplaa keitto"),
    ai.session,
  );
  // Potato and cream changed; carrot is at home, and pasta, milk and bread were not read again.
  expect(provider.searchRequests).toBeGreaterThan(0);
  expect(provider.searchRequests).toBeLessThan(full);
  expect(provider.searchRequests).toBeLessThanOrEqual(2 * 3);
  expect(line(service, "potato:g")).toMatchObject({
    requirement: { amount: 1600 },
    packs: 2,
    total: 398,
  });
  expect(line(service, "cream:ml")).toMatchObject({ packs: 2, total: 218 });
  expect(line(service, "pasta:g")).toEqual(pasta);
  expect(line(service, "milk:ml")).toEqual(milk);
  // Retained rows were not read again, so the quote is still as old as they are.
  expect(snapshot.quotedAt).toBe(quotedAt);
  expect(
    Date.parse(line(service, "potato:g")!.product!.observedAt),
  ).toBeGreaterThan(Date.parse(pasta!.product!.observedAt) - 1);
  expect(service.state.revision).toBe(8);
  expect(service.state.accepted).toEqual(editPlan().accepted);
  expect(service.state.skipped).toEqual(["carrot:g"]);
  expect(snapshot.editUndoAvailable).toBe(true);
  expect(snapshot.edit).toMatchObject({
    status: "applied",
    revision: 8,
    applied: [
      { op: "changeServings", targetId: "meal:m-soup", before: 4, after: 8 },
    ],
    delta: {
      fromRevision: 7,
      toRevision: 8,
      price: { status: "exact", difference: 199 + 109, unknownRows: 0 },
    },
  });
  expect(entries.get("state")).toEqual(service.state);
  expect((entries.get("last-quote") as { basket: unknown }).basket).toEqual(
    service.basket,
  );
  expect(provider.writes).toBe(0);
  expect(ai.sessions[0].callCount).toBe(1);
  const metric = readMetrics(entries.get("metrics:operations")).at(-1);
  expect(metric).toMatchObject({
    kind: "edit",
    outcome: "success",
    aiCalls: 1,
    repairCalls: 0,
    resolverCalls: 0,
    searches: provider.searchRequests,
  });
});

test("a multi-part edit applies together and invalidates a prepared transfer", async () => {
  const { service, provider, ai } = await fixture();
  await service.save({ ...service.state, skipped: [] });
  await service.buildBasket();
  await service.accept({ ingredientId: "carrot", productId: "carrot-alt" });
  const chosen = structuredClone(service.state.accepted);
  await service.prepare({ allowMissing: true });
  expect(service.review).not.toBeNull();
  const approved = {
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  };
  await service.editList(
    edit(service, "lisää 500 g kahvia, poista paahtoleipä ja pasta 8 hengelle"),
    ai.session,
  );
  expect(service.review).toBeNull();
  await expect(service.transferDisplayed(approved)).rejects.toThrow(
    "draftStale",
  );
  expect(line(service, "kahvi:g")).toMatchObject({ packs: 1, total: 599 });
  expect(line(service, "paahtoleipä:g")).toBeUndefined();
  expect(line(service, "pasta:g")).toMatchObject({ packs: 2 });
  // The shopper's own product choice for an untouched row survives.
  expect(service.state.accepted).toEqual(chosen);
  expect(line(service, "carrot:g")?.product?.id).toBe("carrot-alt");
  expect(provider.writes).toBe(0);
});

test("without a compatible quote every row is read, and a broken retained row falls back to that", async () => {
  const unquoted = await fixture(false);
  await unquoted.service.editList(
    edit(unquoted.service, "tuplaa keitto"),
    unquoted.ai.session,
  );
  const rows = unquoted.service.basket.length;
  expect(unquoted.provider.searchRequests).toBeGreaterThanOrEqual(rows);
  expect(unquoted.service.quotedAt).not.toBeNull();
  // No earlier quote exists to compare with, so no price difference is claimed.
  expect(unquoted.service.snapshot().edit).toMatchObject({
    delta: { price: { status: "incomplete", difference: null } },
  });
  const undone = await unquoted.service.undoEdit({
    revision: unquoted.service.state.revision,
  });
  expect(undone.quotedAt).toBeNull();
  expect(undone.basket).toEqual([]);

  const broken = await fixture();
  const before = broken.service.quotedAt;
  line(broken.service, "pasta:g")!.total = 1;
  broken.provider.searchRequests = 0;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await broken.service.editList(
    edit(broken.service, "tuplaa keitto"),
    broken.ai.session,
  );
  expect(line(broken.service, "pasta:g")?.total).toBe(129);
  expect(broken.provider.searchRequests).toBeGreaterThanOrEqual(
    broken.service.basket.length,
  );
  expect(broken.service.quotedAt).not.toBe(before);
});

test("stale, failed, cancelled and invalid edits commit nothing", async () => {
  const { service, provider, ai, entries } = await fixture();
  const unchanged = async (run: Promise<unknown>, code: string) => {
    const state = JSON.stringify(service.state);
    const basket = JSON.stringify(service.basket);
    const stored = JSON.stringify(
      [...entries].filter(([k]) => !/metrics/.test(k)),
    );
    await expect(run).rejects.toThrow(code);
    expect(JSON.stringify(service.state)).toBe(state);
    expect(JSON.stringify(service.basket)).toBe(basket);
    expect(
      JSON.stringify([...entries].filter(([k]) => !/metrics/.test(k))),
    ).toBe(stored);
    expect(service.busy).toBe(false);
  };
  await unchanged(
    service.editList(
      { ...edit(service, "tuplaa keitto"), revision: 6 },
      ai.session,
    ),
    "draftStale",
  );
  expect(ai.sessions).toHaveLength(0);
  await expect(
    service.editList({ ...edit(service, "x"), consent: false }, ai.session),
  ).rejects.toThrow();
  // The list changes while the instruction is being interpreted.
  const racing = service.editList(edit(service, "tuplaa keitto"), async () => {
    await service.save({ ...service.state, removed: ["ruisleipä:g"] });
    return ai.session();
  });
  await expect(racing).rejects.toThrow("draftStale");
  expect(service.state.meals[1].servings).toBe(4);
  expect(service.snapshot().editUndoAvailable).toBe(false);
  await service.buildBasket();

  // B4.4: a catalogue failure while repricing a changed row keeps the edit; the row is
  // left unsearched and the next price update reads it again.
  provider.failSearch = true;
  const kept = await service.editList(
    edit(service, "tuplaa keitto"),
    ai.session,
  );
  provider.failSearch = false;
  expect(kept.edit?.status).toBe("applied");
  expect(
    kept.basket.filter((line) => line.matching?.reason === "bounded-out")
      .length,
  ).toBeGreaterThan(0);
  expect(service.busy).toBe(false);
  await service.undoEdit({ revision: service.state.revision });
  await service.buildBasket();
  // A pack count with no quoted pack, a unit mismatch and a no-op are typed domain rejections.
  await unchanged(
    service.editList(edit(service, "lisää 2 pakkausta kahvia"), ai.session),
    "packSizeUnknown",
  );
  await unchanged(
    service.editList(edit(service, "porkkana löytyy kotoa"), ai.session),
    "noChange",
  );
  // An invented target is repaired once and then fails as invalid output.
  const invented = await inference(
    Array(2).fill(
      JSON.stringify({
        version: 1,
        operations: [{ op: "removeItem", target: "row:saffron:g" }],
      }),
    ),
  );
  await unchanged(
    service.editList(edit(service, "poista sahrami"), invented.session),
    "invalidDraft",
  );
  expect(invented.sessions[0].callCount).toBe(2);
  const limited = await inference();
  limited.connection.scenario = "usageLimit";
  await unchanged(
    service.editList(edit(service, "tuplaa keitto"), limited.session),
    "usageLimit",
  );
  expect(limited.sessions[0].callCount).toBe(1);
  const cancelled = await inference();
  cancelled.controller.abort();
  await unchanged(
    service.editList(edit(service, "tuplaa keitto"), cancelled.session),
    "cancelled",
  );
  expect(provider.writes).toBe(0);
  // Only the kept edit and its undo above set an outcome; no failure replaced it.
  expect(service.snapshot().edit?.status).toBe("undone");
  const metrics = readMetrics(entries.get("metrics:operations")).filter(
    (m) => m.kind === "edit",
  );
  expect(metrics.map((m) => m.outcome)).toContain("failed");
});

test("an unclear instruction asks, names the candidates and keeps the earlier undo", async () => {
  const { service, ai } = await fixture();
  await service.editList(edit(service, "tuplaa keitto"), ai.session);
  const state = JSON.stringify(service.state);
  const snapshot = await service.editList(
    edit(service, "poista leipä ja lisää 1 l maitoa"),
    ai.session,
  );
  expect(JSON.stringify(service.state)).toBe(state);
  expect(snapshot.edit).toEqual({
    status: "clarification",
    revision: 8,
    ambiguities: [
      {
        phrase: "poista leipä",
        candidates: [
          { targetId: "row:ruisleipä:g", name: "Ruisleipä", detail: "500 g" },
          {
            targetId: "row:paahtoleipä:g",
            name: "Paahtoleipä",
            detail: "400 g",
          },
        ],
      },
    ],
    unsupported: [],
  });
  expect(snapshot.editUndoAvailable).toBe(true);
  // Opening the instruction from one of the rows settles it.
  await service.editList(
    edit(service, "poista tämä", "row:paahtoleipä:g"),
    ai.session,
  );
  expect(service.state.removed).toEqual(["paahtoleipä:g"]);
  expect(line(service, "ruisleipä:g")).toBeDefined();
});

test("undo restores the plan and quote as a new revision without any outside call", async () => {
  const { service, provider, ai, entries } = await fixture();
  const before = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  const quotedAt = service.quotedAt;
  await service.editList(
    edit(service, "vaihda pasta nakkikeittoon ja poista ruisleipä"),
    ai.session,
  );
  expect(service.state.recipes.at(-1)?.name).toBe("Nakkikeitto");
  await service.prepare({ allowMissing: true });
  const calls = {
    searches: provider.searchRequests,
    prompts: ai.connection.prompts,
  };
  let cartReads = 0;
  const getCart = provider.getCart.bind(provider);
  provider.getCart = async (context) => {
    cartReads++;
    return getCart(context);
  };
  const snapshot = await service.undoEdit({ revision: 8 });
  expect(service.state).toEqual({ ...before, revision: 9 });
  expect(service.basket).toEqual(basket);
  expect(snapshot.quotedAt).toBe(quotedAt);
  expect(snapshot.review).toBeNull();
  expect(snapshot.editUndoAvailable).toBe(false);
  expect(snapshot.edit).toMatchObject({
    status: "undone",
    revision: 9,
    delta: { fromRevision: 8, toRevision: 9 },
  });
  expect(entries.get(EDIT_UNDO_KEY)).toBeNull();
  expect(entries.get("state")).toEqual(service.state);
  expect(provider.searchRequests).toBe(calls.searches);
  expect(ai.connection.prompts).toBe(calls.prompts);
  expect([cartReads, provider.writes]).toEqual([0, 0]);
  await expect(service.undoEdit({ revision: 9 })).rejects.toThrow(
    "undoUnavailable",
  );
  await expect(service.undoEdit({ revision: 8 })).rejects.toThrow("draftStale");
});

test("undo survives a restart, follows the latest edit and a failed edit leaves it alone", async () => {
  const { service, storage, ai } = await fixture();
  await service.editList(edit(service, "tuplaa keitto"), ai.session);
  const first = structuredClone(service.state);
  await service.editList(edit(service, "poista ruisleipä"), ai.session);
  await expect(
    service.editList(edit(service, "porkkana löytyy kotoa"), ai.session),
  ).rejects.toThrow("noChange");
  expect(service.snapshot().editUndoAvailable).toBe(true);

  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  const loaded = restarted.snapshot();
  expect(loaded.editUndoAvailable).toBe(true);
  expect(loaded.edit).toMatchObject({
    status: "applied",
    revision: 9,
    applied: [{ op: "removeItem", targetId: "row:ruisleipä:g" }],
  });
  expect(loaded.basket).toEqual(service.basket);
  // One step only: back to the plan after the first edit, not to the original.
  await restarted.undoEdit({ revision: 9 });
  expect(restarted.state).toEqual({ ...first, revision: 10 });
  expect(restarted.state.meals[1].servings).toBe(8);

  const again = new Service(storage);
  await again.init();
  expect(again.snapshot().editUndoAvailable).toBe(false);
  expect(again.snapshot().edit).toBeNull();
});

test("a new list or any other list change ends the undo", async () => {
  const { service, storage, ai } = await fixture();
  await service.editList(edit(service, "tuplaa keitto"), ai.session);
  await service.newWeek();
  expect(service.snapshot().editUndoAvailable).toBe(false);
  expect(service.snapshot().edit).toBeNull();
  await expect(
    service.undoEdit({ revision: service.state.revision }),
  ).rejects.toThrow("undoUnavailable");
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.snapshot().editUndoAvailable).toBe(false);
  expect(restarted.state.meals).toEqual([]);

  const other = await fixture();
  await other.service.editList(
    edit(other.service, "tuplaa keitto"),
    other.ai.session,
  );
  await other.service.omit("pasta:g");
  expect(other.service.snapshot().editUndoAvailable).toBe(false);
  // Presentation-only changes keep the revision, so undo stays.
  const third = await fixture();
  await third.service.editList(
    edit(third.service, "tuplaa keitto"),
    third.ai.session,
  );
  await third.service.setLanguage("en");
  expect(third.service.snapshot().editUndoAvailable).toBe(true);
  await third.service.undoEdit({ revision: third.service.state.revision });
  expect(third.service.state.language).toBe("en");
  expect(third.service.state.meals[1].servings).toBe(4);
});

test("undo after a verified transfer changes only the local plan", async () => {
  const { service, provider, ai } = await fixture();
  await service.editList(edit(service, "poista ruisleipä"), ai.session);
  await service.editList(edit(service, "poista paahtoleipä"), ai.session);
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
  if (service.review)
    await service.execute({ id: service.review.id, acknowledged: true });
  expect(service.journal?.status).toBe("verified");
  const writes = provider.writes;
  expect(writes).toBeGreaterThan(0);
  const carts = JSON.stringify([...provider.carts]);
  let reads = 0;
  const getCart = provider.getCart.bind(provider);
  provider.getCart = async (context) => {
    reads++;
    return getCart(context);
  };
  const searches = provider.searchRequests;
  const snapshot = await service.undoEdit({
    revision: service.state.revision,
  });
  expect(snapshot.state.removed).toEqual(["ruisleipä:g"]);
  expect([provider.writes, reads, provider.searchRequests]).toEqual([
    writes,
    0,
    searches,
  ]);
  expect(JSON.stringify([...provider.carts])).toBe(carts);
  // The transfer record stays; the restored plan is a different batch needing its own approval.
  expect(snapshot.journal?.status).toBe("verified");
  expect(snapshot.transferBatchKey).not.toBe(snapshot.journal?.batchKey);
  expect(snapshot.state.listHistory).toHaveLength(1);
});

test("a failed write commits nothing and a lost acknowledgement is not retried", async () => {
  const { service, ai, entries, failNext } = await fixture();
  const state = structuredClone(service.state);
  failNext("before");
  await expect(
    service.editList(edit(service, "tuplaa keitto"), ai.session),
  ).rejects.toThrow("storageFailed");
  expect(service.state).toEqual(state);
  expect(entries.get("state")).toEqual(state);
  expect(entries.get(EDIT_UNDO_KEY)).toBeUndefined();
  failNext("after");
  const snapshot = await service.editList(
    edit(service, "tuplaa keitto"),
    ai.session,
  );
  expect(snapshot.state.meals[1].servings).toBe(8);
  expect(entries.get("state")).toEqual(service.state);
  failNext("before");
  await expect(service.undoEdit({ revision: 8 })).rejects.toThrow(
    "storageFailed",
  );
  expect(service.snapshot().editUndoAvailable).toBe(true);
  failNext(null);
  await service.undoEdit({ revision: 8 });
  expect(service.state.meals[1].servings).toBe(4);
});
