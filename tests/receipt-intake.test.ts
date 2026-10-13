import { mkdir, mkdtemp, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import { InferenceSession, discoverInferenceModels } from "../src/ai/provider";
import type { ReceiptAI } from "../src/application/receipt-import";
import {
  intakeLimits,
  type IntakeFile,
  type IntakeProgress,
} from "../src/application/receipt-intake";
import { Service } from "../src/application/service";
import {
  buildCombinedBatch,
  enrichmentLimits,
} from "../src/domain/receipt-semantics";
import { intakeFile } from "../src/receipts/intake-files";
import { fixtureText, receiptFixtures } from "./fixtures/receipts";
import { editPlan } from "./helpers/edit-plan";
import { memoryStorage } from "./helpers/purchase-fixtures";

const text = (id: string) =>
  fixtureText(receiptFixtures.find((f) => f.id === id)!);
const file = (
  name: string,
  id: string,
  extra: Partial<{ bytes: number; read: () => Promise<never> }> = {},
): IntakeFile => ({
  name,
  format: "txt",
  bytes: 2000,
  read: async () => ({ text: text(id), ocrPages: [] }),
  ...extra,
});
async function profile() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  await store.storage.set("state", editPlan());
  await service.init();
  await service.buildBasket();
  return { ...store, service };
}
/** The development alternative provider with a one-call session and a request counter. */
async function ai(script?: (signal: AbortSignal) => Promise<string>) {
  const prompts: string[] = [];
  const connection = new (class extends FixtureAI {
    override async generatePinned(
      m: string,
      prompt: string,
      signal: AbortSignal,
    ) {
      prompts.push(prompt);
      return script ? script(signal) : super.generatePinned(m, prompt, signal);
    }
  })();
  await connection.signIn();
  const provider = new FakeInferenceProvider(connection, true);
  let busy = false;
  const receiptAI: ReceiptAI = {
    providerId: provider.id,
    busy: () => busy,
    session: async () => {
      const controller = new AbortController();
      const models = await discoverInferenceModels(provider, controller.signal);
      return new InferenceSession(
        provider,
        models[0],
        { maxCalls: 1, maxOutputCharacters: 100_000, timeoutMs: 5000 },
        controller.signal,
      );
    },
  };
  return { receiptAI, prompts, setBusy: (value: boolean) => (busy = value) };
}
const enable = {
  automatic: true,
  providerId: "fake-alternative",
  scope: 1 as const,
};

test("several files are saved one by one; a bad file fails alone and a repeat is a duplicate", async () => {
  const { service } = await profile();
  const shopping = structuredClone(service.snapshot());
  const progress: IntakeProgress[] = [];
  const snapshot = await service.importReceiptFiles(
    [
      file("s-kuitti.txt", "s-basic-campaign"),
      { name: "kuva.png", refused: "receiptUnsupported" },
      file("rikki.txt", "s-deposits", {
        read: async () => {
          throw new Error("receiptUnreadable");
        },
      }),
      file("k-kuitti.txt", "k-weighed"),
      file("sama.txt", "s-basic-campaign"),
      file("lasku.txt", "unknown-restaurant-bill"),
    ],
    { onProgress: (p) => progress.push(p) },
  );
  const result = snapshot.receiptIntake!;
  expect(result.files.map((f) => [f.name, f.outcome, f.code])).toEqual([
    ["s-kuitti.txt", "added", null],
    ["kuva.png", "unsupported", "receiptUnsupported"],
    ["rikki.txt", "failed", "receiptUnreadable"],
    ["k-kuitti.txt", "added", null],
    ["sama.txt", "duplicate", null],
    ["lasku.txt", "unsupported", "receiptUnsupported"],
  ]);
  expect(result.counts).toEqual({
    added: 2,
    updated: 0,
    duplicate: 1,
    unsupported: 2,
    failed: 1,
    cancelled: 0,
  });
  expect(result.eventIds).toHaveLength(2);
  expect((await service.purchaseView()).purchases).toHaveLength(2);
  // Nothing was asked of a model, and there is nobody to invite without a provider.
  expect([result.enrichment, result.invitation, result.cancelled]).toEqual([
    null,
    null,
    false,
  ]);
  // Real stages only, in order, ending with everything listed; each file is durable when listed.
  expect(progress.map((p) => p.stage)).toEqual([
    "reading",
    "saving",
    "reading",
    "reading",
    "saving",
    "reading",
    "saving",
    "reading",
    "saving",
    "done",
  ]);
  expect(progress.at(-1)).toMatchObject({ files: 6, cancellable: false });
  expect(progress[2].results).toHaveLength(2);
  expect(snapshot.receiptIntakeRunning).toBeNull();
  // The shopping list, its quote and the transfer record are exactly as they were.
  expect(snapshot.state).toEqual(shopping.state);
  expect(snapshot.basket).toEqual(shopping.basket);
  expect(snapshot.quotedAt).toBe(shopping.quotedAt);
  expect(snapshot.journal ?? null).toEqual(shopping.journal ?? null);
});

test("the batch bounds refuse extra files and bytes without reading them, and a deadline stops the rest", async () => {
  const { service } = await profile();
  let reads = 0;
  const counted = (name: string, bytes = 1000): IntakeFile => ({
    name,
    format: "txt",
    bytes,
    read: async () => {
      reads++;
      return { text: text("unknown-plain-note"), ocrPages: [] };
    },
  });
  const many = Array.from({ length: intakeLimits.files + 3 }, (_, i) =>
    counted(`f${i}.txt`),
  );
  const capped = (await service.importReceiptFiles(many)).receiptIntake!;
  expect(reads).toBe(intakeLimits.files);
  expect(capped.files.slice(-3).map((f) => [f.outcome, f.code])).toEqual(
    Array(3).fill(["failed", "receiptBatchLimit"]),
  );
  reads = 0;
  const heavy = (
    await service.importReceiptFiles([
      counted("a.txt", 30 * 1024 * 1024),
      counted("b.txt", 30 * 1024 * 1024),
      counted("c.txt", 1),
    ])
  ).receiptIntake!;
  expect(reads).toBe(2);
  expect(heavy.files[2]).toMatchObject({
    outcome: "failed",
    code: "receiptBatchLimit",
  });
  expect(intakeLimits).toEqual({
    files: 20,
    bytes: 60 * 1024 * 1024,
    deadlineMs: 180_000,
  });
});

test("cancelling stops the files not yet saved and keeps the saved ones; only the named import can be cancelled", async () => {
  const { service } = await profile();
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  const slow: IntakeFile = {
    name: "hidas.txt",
    format: "txt",
    bytes: 100,
    read: async () => {
      await gate;
      return { text: text("k-weighed"), ocrPages: [] };
    },
  };
  let operationId = "";
  const running = service.importReceiptFiles(
    [
      file("eka.txt", "s-basic-campaign"),
      slow,
      file("kolmas.txt", "s-deposits"),
    ],
    { onProgress: (p) => (operationId = p.operationId) },
  );
  await expect
    .poll(() => service.snapshot().receiptIntakeRunning)
    .not.toBeNull();
  await expect
    .poll(async () => (await service.purchaseView()).purchases.length)
    .toBe(1);
  // A second import, or a cancel for another operation, does not disturb this one.
  await expect(
    service.importReceiptFiles([file("x.txt", "s-deposits")]),
  ).rejects.toThrow("receiptIntakeBusy");
  expect(() =>
    service.cancelReceiptIntake({
      operationId: "00000000-0000-4000-8000-000000000000",
    }),
  ).toThrow("receiptIntakeStale");
  service.cancelReceiptIntake({ operationId });
  release();
  const result = (await running).receiptIntake!;
  expect(result.files.map((f) => [f.name, f.outcome])).toEqual([
    ["eka.txt", "added"],
    ["hidas.txt", "cancelled"],
    ["kolmas.txt", "cancelled"],
  ]);
  expect(result.cancelled).toBe(true);
  expect((await service.purchaseView()).purchases).toHaveLength(1);
  expect(() => service.cancelReceiptIntake({ operationId })).toThrow(
    "receiptIntakeStale",
  );
});

test("without consent nothing is sent and the shopper is invited once; one answer names the whole import in one request", async () => {
  const { service } = await profile();
  const model = await ai();
  const files = [
    file("a.txt", "s-weighed-produce"),
    file("b.txt", "k-weighed"),
    file("c.txt", "s-non-food-subtotals"),
  ];
  const imported = (
    await service.importReceiptFiles(files, { ai: model.receiptAI })
  ).receiptIntake!;
  expect(model.prompts).toHaveLength(0);
  expect(imported.enrichment).toBeNull();
  expect(imported.invitation).toMatchObject({
    providerId: "fake-alternative",
    scope: 1,
    eventIds: imported.eventIds,
  });
  expect(imported.invitation!.rows).toBeGreaterThan(0);
  // An answer for another provider, or for purchases of some other import, is refused.
  await expect(
    service.receiptConsentAction(
      {
        choice: "once",
        providerId: "other",
        scope: 1,
        eventIds: imported.eventIds,
      },
      model.receiptAI,
    ),
  ).rejects.toThrow("receiptIntakeStale");
  await expect(
    service.receiptConsentAction(
      {
        choice: "once",
        providerId: "fake-alternative",
        scope: 1,
        eventIds: ["nope"],
      },
      model.receiptAI,
    ),
  ).rejects.toThrow("receiptIntakeStale");
  expect(model.prompts).toHaveLength(0);

  // "Just this import": one request for all three receipts, and nothing is remembered.
  const once = await service.receiptConsentAction(
    {
      choice: "once",
      providerId: "fake-alternative",
      scope: 1,
      eventIds: imported.eventIds,
    },
    model.receiptAI,
  );
  expect(model.prompts).toHaveLength(1);
  expect(once.receiptIntake).toMatchObject({
    invitation: null,
    enrichment: { status: "enriched", events: 3, stale: 0 },
  });
  expect(once.receiptIntake!.enrichment!.accepted).toBeGreaterThan(0);
  expect((await service.purchaseView()).consent.automatic).toBeNull();
  const named = (await service.purchaseView()).purchases.flatMap((p) =>
    p.lines.filter((l) => l.interpretation?.origin === "model"),
  );
  expect(named.length).toBe(once.receiptIntake!.enrichment!.accepted);
  // The request carried labels and quantities only: no store, date, price or file name.
  expect(model.prompts[0]).not.toMatch(
    /a\.txt|Esimerkki|\d+[.,]\d{2}\s*€|2026-/,
  );

  // The next import asks nothing again without an answer, and invites again.
  const next = (
    await service.importReceiptFiles([file("d.txt", "s-norm-campaign")], {
      ai: model.receiptAI,
    })
  ).receiptIntake!;
  expect(model.prompts).toHaveLength(1);
  expect(next.invitation).not.toBeNull();
});

test("enable saves permission and names this import at once; later imports use one request each; not now is remembered", async () => {
  const { service } = await profile();
  const model = await ai();
  const first = (
    await service.importReceiptFiles(
      [
        file("a.txt", "s-weighed-produce"),
        file("b.txt", "s-non-food-subtotals"),
      ],
      { ai: model.receiptAI },
    )
  ).receiptIntake!;
  const enabled = await service.receiptConsentAction(
    {
      choice: "enable",
      providerId: "fake-alternative",
      scope: 1,
      eventIds: first.eventIds,
    },
    model.receiptAI,
  );
  expect(model.prompts).toHaveLength(1);
  expect(enabled.receiptIntake!.enrichment).toMatchObject({
    status: "enriched",
  });
  expect((await service.purchaseView()).consent.automatic).toMatchObject({
    providerId: "fake-alternative",
    scope: 1,
  });
  // With saved permission a later multi-file import makes exactly one request and no invitation.
  const later = (
    await service.importReceiptFiles(
      [file("c.txt", "k-weighed"), file("d.txt", "s-norm-campaign")],
      { ai: model.receiptAI },
    )
  ).receiptIntake!;
  expect(model.prompts).toHaveLength(2);
  expect(later).toMatchObject({
    invitation: null,
    enrichment: { status: "enriched", events: 2 },
  });
  // Duplicates only: nothing new to name, so nothing is sent.
  const again = (
    await service.importReceiptFiles([file("c.txt", "k-weighed")], {
      ai: model.receiptAI,
    })
  ).receiptIntake!;
  expect(model.prompts).toHaveLength(2);
  expect([again.counts.duplicate, again.enrichment]).toEqual([1, null]);

  // Another profile answers "not now": remembered for that provider, and nothing is sent.
  const other = await profile();
  const asked = (
    await other.service.importReceiptFiles(
      [file("a.txt", "s-weighed-produce")],
      {
        ai: model.receiptAI,
      },
    )
  ).receiptIntake!;
  const declined = await other.service.receiptConsentAction(
    {
      choice: "decline",
      providerId: "fake-alternative",
      scope: 1,
      eventIds: asked.eventIds,
    },
    model.receiptAI,
  );
  expect(declined.receiptIntake).toMatchObject({
    invitation: null,
    enrichment: null,
  });
  const quiet = (
    await other.service.importReceiptFiles([file("b.txt", "k-weighed")], {
      ai: model.receiptAI,
    })
  ).receiptIntake!;
  expect(quiet.invitation).toBeNull();
  expect(model.prompts).toHaveLength(2);
  // Settings can still switch it on afterwards.
  await other.service.setReceiptConsent(enable);
  expect((await other.service.purchaseView()).consent).toMatchObject({
    automatic: { providerId: "fake-alternative" },
  });
});

test("a busy connection, a failing model and a source changed meanwhile keep every saved purchase", async () => {
  const { service } = await profile();
  const model = await ai();
  await service.setReceiptConsent(enable);
  model.setBusy(true);
  const busy = (
    await service.importReceiptFiles([file("a.txt", "s-weighed-produce")], {
      ai: model.receiptAI,
    })
  ).receiptIntake!;
  expect(busy.enrichment).toMatchObject({
    status: "unavailable",
    reason: "aiBusy",
    accepted: 0,
  });
  expect(model.prompts).toHaveLength(0);
  expect(busy.counts.added).toBe(1);
  model.setBusy(false);

  const failing = await ai(async () => "{not json");
  const failed = (
    await service.importReceiptFiles([file("b.txt", "k-weighed")], {
      ai: failing.receiptAI,
    })
  ).receiptIntake!;
  expect(failed.enrichment).toMatchObject({ status: "failed", accepted: 0 });
  expect(failing.prompts).toHaveLength(1);
  expect((await service.purchaseView()).purchases).toHaveLength(2);

  // One purchase is deleted while the model answers: it gets nothing, the other keeps its names.
  const fresh = await profile();
  await fresh.service.setReceiptConsent(enable);
  const real = await ai();
  const racing: ReceiptAI = {
    ...real.receiptAI,
    session: async () => {
      const [first] = (await fresh.service.purchaseView()).purchases;
      await fresh.service.deletePurchase({
        eventId: first.eventId,
        scope: "event",
      });
      return real.receiptAI.session();
    },
  };
  const raced = (
    await fresh.service.importReceiptFiles(
      [file("a.txt", "s-weighed-produce"), file("b.txt", "k-weighed")],
      { ai: racing },
    )
  ).receiptIntake!;
  expect(raced.enrichment).toMatchObject({
    status: "enriched",
    events: 2,
    stale: 1,
  });
  expect((await fresh.service.purchaseView()).purchases).toHaveLength(1);
});

test("the combined request keeps the one-receipt limits, sends equal rows once and never merges purchases", async () => {
  const { service } = await profile();
  await service.importReceiptFiles([
    file("a.txt", "s-multiple-milk"),
    file("b.txt", "s-basic-campaign"),
    file("c.txt", "s-five-groups"),
    file("d.txt", "k-receipt-discount"),
  ]);
  const ledger = await service.purchases.ledger();
  const ids = ledger.events.map((e) => e.id);
  const batch = buildCombinedBatch(ledger, ids);
  expect(batch.events.size).toBe(4);
  expect(batch.request!.rows.length).toBeLessThanOrEqual(enrichmentLimits.rows);
  expect(JSON.stringify(batch.request!.rows).length).toBeLessThanOrEqual(
    enrichmentLimits.requestCharacters,
  );
  // Each sent row is unique by label and quantity, and maps back to every line it stands for.
  const contents = batch.request!.rows.map((r) =>
    JSON.stringify([r.label, r.quantity]),
  );
  expect(new Set(contents).size).toBe(contents.length);
  const lines = [...batch.rows.values()].flatMap((r) => r.lines);
  expect(lines.length).toBe(batch.covered);
  expect(lines.length).toBeGreaterThanOrEqual(batch.request!.rows.length);
  expect(new Set(lines.map((l) => `${l.eventId}:${l.lineId}`)).size).toBe(
    lines.length,
  );
  expect(ledger.events).toHaveLength(4);
  // Row IDs are opaque: nothing in the request identifies a purchase, a store or a file.
  expect(JSON.stringify(batch.request)).not.toMatch(new RegExp(ids.join("|")));
});

test("a file is checked before it is read: type, content, size, kind of path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "korikone-intake-"));
  const write = async (name: string, content: string | Buffer) => {
    await writeFile(join(dir, name), content);
    return join(dir, name);
  };
  let reads = 0;
  const read = async () => {
    reads++;
    return { text: "x", ocrPages: [] };
  };
  const check = async (path: unknown) => {
    const result = await intakeFile(path, read);
    return "refused" in result ? result.refused : result.format;
  };
  expect(await check(await write("kuitti.txt", "S-MARKET\nMAITO 1,19"))).toBe(
    "txt",
  );
  expect(await check(await write("kuitti.CSV", "a;b\n1;2"))).toBe("csv");
  expect(await check(await write("kuitti.pdf", "%PDF-1.7\n..."))).toBe("pdf");
  // The extension alone is not believed.
  expect(await check(await write("vale.pdf", "MZ\u0000\u0000exe"))).toBe(
    "receiptUnsupported",
  );
  expect(
    await check(await write("binaari.txt", Buffer.from([65, 0, 66]))),
  ).toBe("receiptUnsupported");
  expect(await check(await write("kuva.png", "png"))).toBe(
    "receiptUnsupported",
  );
  expect(await check(await write("tyhja.txt", ""))).toBe("receiptNoText");
  const big = await write("iso.txt", "x");
  await truncate(big, 20 * 1024 * 1024 + 1);
  expect(await check(big)).toBe("receiptTooLarge");
  await mkdir(join(dir, "kansio.txt"));
  expect(await check(join(dir, "kansio.txt"))).toBe("receiptUnreadable");
  for (const unsafe of [
    join(dir, "puuttuu.txt"),
    "kuitti.txt",
    "..\\..\\kuitti.txt",
    `${join(dir, "kuitti.txt")}\0.pdf`,
    "",
    42,
    null,
    { path: join(dir, "kuitti.txt") },
  ])
    expect(await check(unsafe)).toBe("receiptUnreadable");
  // Checking reads only the first bytes; the reader runs later, once, for an accepted file.
  expect(reads).toBe(0);
  const accepted = await intakeFile(join(dir, "kuitti.txt"), read);
  expect(accepted).toMatchObject({ name: "kuitti.txt", format: "txt" });
});
