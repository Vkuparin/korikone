import { expect, test } from "vitest";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import {
  InferenceSession,
  discoverInferenceModels,
  type InferenceModel,
} from "../src/ai/provider";
import {
  RECEIPT_NAME_PROMPT_PREFIX,
  RECEIPT_PROMPT_PREFIX,
  receiptTaskLimits,
} from "../src/ai/receipt-enrichment";
import {
  receiptEnrichmentTask,
  receiptNameTask,
  inferenceTasks,
} from "../src/ai/tasks";
import {
  runBatchEnrichment,
  runReceiptEnrichment,
} from "../src/application/receipt-enrichment";
import {
  emptyLedger,
  putPurchase,
  type PurchaseLedger,
} from "../src/domain/purchases";
import { applyEnrichment } from "../src/domain/receipt-semantics";
import { purchaseView } from "../src/domain/purchase-review";
import {
  purchaseEvent,
  purchaseLine,
  purchaseSource,
} from "./helpers/purchase-fixtures";

const once = { scope: 1 as const };
const at = "2026-10-13T08:00:00.000Z";

function ledger(): PurchaseLedger {
  const event = purchaseEvent("e1", "s1", {
    lines: [
      purchaseLine("l1", "VALIO JOG 1KG", 249),
      purchaseLine("l2", "PIRKKA KEVYTM 1L", 119),
    ],
  });
  const second = purchaseEvent("e2", "s2", {
    purchasedAt: "2026-10-02T10:00:00.000Z",
    lines: [purchaseLine("l1", "VALIO JOG 1KG", 249)],
  });
  return putPurchase(
    putPurchase(emptyLedger(), purchaseSource("s1"), event),
    purchaseSource("s2"),
    second,
  );
}
const v2 = (rows: unknown[]) => JSON.stringify({ version: 2, rows });
const row = (rowId: string, display: string | null, name: string | null) => ({
  rowId,
  display,
  name,
  category: null,
  qualifiers: [],
  scope: "food",
});

class Connection extends FixtureAI {
  prompts: string[] = [];
  constructor(private reply?: string) {
    super();
  }
  override async generatePinned(
    m: string,
    prompt: string,
    signal: AbortSignal,
  ) {
    this.prompts.push(prompt);
    return this.reply ?? super.generatePinned(m, prompt, signal);
  }
}
async function setup(
  alternative: boolean,
  reply?: string,
  tasks?: readonly { id: string; version: number }[],
) {
  const connection = new Connection(reply);
  await connection.signIn();
  const provider = alternative
    ? new FakeInferenceProvider(connection, true)
    : new ChatGPTInferenceProvider(connection);
  const controller = new AbortController();
  let sessions = 0;
  const session = async () => {
    sessions++;
    const models = await discoverInferenceModels(provider, controller.signal);
    const found = models.find((m) => m.modelId === "fixture-large")!;
    const model: InferenceModel = tasks
      ? {
          ...found,
          capabilities: { ...found.capabilities, tasks: [...tasks] },
        }
      : found;
    return new InferenceSession(
      provider,
      model,
      {
        maxCalls: receiptTaskLimits.aiCalls,
        maxOutputCharacters: 100_000,
        timeoutMs: 5000,
      },
      controller.signal,
    );
  };
  return { connection, session, sessions: () => sessions };
}

for (const [label, alternative, providerId] of [
  ["local ChatGPT adapter", false, "chatgpt"],
  ["fake alternative provider", true, "fake-alternative"],
] as const) {
  const consent = { providerId, scope: 1 };

  test(`${label}: both adapters advertise the readable-name task and it is used with one request`, async () => {
    expect(inferenceTasks).toContainEqual(receiptEnrichmentTask);
    expect(inferenceTasks).toContainEqual(receiptNameTask);
    const { connection, session } = await setup(
      alternative,
      v2([row("r0", "Valio jogurtti 1 kg", "Jogurtti")]),
    );
    const base = ledger();
    const run = await runReceiptEnrichment({
      ledger: async () => base,
      eventId: "e1",
      providerId,
      consent,
      session,
      now: () => new Date(at),
    });
    expect(run.status).toBe("enriched");
    if (run.status !== "enriched") return;
    expect(connection.prompts).toHaveLength(1);
    expect(connection.prompts[0].startsWith(RECEIPT_NAME_PROMPT_PREFIX)).toBe(
      true,
    );
    expect(run.annotations).toHaveLength(1);
    expect(run.annotations[0]).toMatchObject({
      lineId: "l1",
      origin: "model",
      model: { providerId, taskVersion: 2 },
      name: "Jogurtti",
      display: { name: "Valio jogurtti 1 kg", tier: "expanded" },
    });
    // The request carried what version 1 carried: labels and quantities only.
    expect(connection.prompts[0]).not.toMatch(/Esimerkki|2026-|249/);
    // Nothing of the facts changed.
    const saved = applyEnrichment(base, run.annotations);
    expect(saved.events).toEqual(base.events);
    expect(saved.consent).toEqual(base.consent);
  });

  test(`${label}: unsupported specificity falls back per row; a wrong envelope fails only the enrichment`, async () => {
    const base = ledger();
    // One row invents a flavour, the other is fine: the invented name is dropped, the rest kept.
    const mixed = await setup(
      alternative,
      v2([
        row("r0", "Valio mansikkajogurtti 1 kg", "Jogurtti"),
        row("r1", "Pirkka kevytmaito 1 l", "Maito"),
      ]),
    );
    const run = await runReceiptEnrichment({
      ledger: async () => base,
      eventId: "e1",
      providerId,
      consent,
      session: mixed.session,
      now: () => new Date(at),
    });
    expect(run.status).toBe("enriched");
    if (run.status !== "enriched") return;
    expect(
      run.annotations.map((a) => [a.lineId, a.name, a.display ?? null]),
    ).toEqual([
      ["l1", "Jogurtti", null],
      ["l2", "Maito", null],
    ]);
    // The line still shows a readable name: the local rule's, or the printed label.
    const view = purchaseView(applyEnrichment(base, run.annotations));
    expect(
      view.find((p) => p.eventId === "e1")!.lines.map((l) => l.display.text),
    ).toEqual(["Valio jogurtti 1 kg", "Maito"]);

    // A version no one supports, an extra field and an injected row ID.
    for (const bad of [
      JSON.stringify({ version: 3, rows: [] }),
      v2([{ ...row("r0", "Valio jogurtti 1 kg", "Jogurtti"), sku: "123" }]),
      "{",
    ]) {
      const failing = await setup(alternative, bad);
      expect(
        await runReceiptEnrichment({
          ledger: async () => base,
          eventId: "e1",
          providerId,
          consent,
          session: failing.session,
        }),
      ).toEqual({ status: "failed", reason: "invalidOutput" });
      expect(failing.connection.prompts).toHaveLength(1);
    }
    const injected = await setup(
      alternative,
      v2([
        row("r9", "Valio jogurtti 1 kg", "Jogurtti"),
        row("r0", "Valio jogurtti 1 kg", null),
      ]),
    );
    const outcome = await runReceiptEnrichment({
      ledger: async () => base,
      eventId: "e1",
      providerId,
      consent,
      session: injected.session,
      now: () => new Date(at),
    });
    expect(outcome.status).toBe("enriched");
    if (outcome.status === "enriched") {
      expect(outcome.rejected).toBe(1);
      expect(outcome.annotations.map((a) => a.lineId)).toEqual(["l1"]);
    }
  });

  test(`${label}: a model without version 2 gets the version 1 task, and one without the task none`, async () => {
    const base = ledger();
    const legacy = await setup(alternative, undefined, [receiptEnrichmentTask]);
    const run = await runReceiptEnrichment({
      ledger: async () => base,
      eventId: "e1",
      providerId,
      consent,
      session: legacy.session,
    });
    expect(run.status).toBe("enriched");
    expect(legacy.connection.prompts).toHaveLength(1);
    expect(legacy.connection.prompts[0].startsWith(RECEIPT_PROMPT_PREFIX)).toBe(
      true,
    );
    if (run.status === "enriched")
      expect(run.annotations.every((a) => a.model?.taskVersion === 1)).toBe(
        true,
      );
    const none = await setup(alternative, undefined, []);
    expect(
      await runReceiptEnrichment({
        ledger: async () => base,
        eventId: "e1",
        providerId,
        consent,
        session: none.session,
      }),
    ).toEqual({ status: "unavailable", reason: "unsupportedTask" });
    expect(none.connection.prompts).toHaveLength(0);
  });

  test(`${label}: the combined action sends one version 2 request and names each purchase's own line`, async () => {
    const base = ledger();
    const { connection, session } = await setup(
      alternative,
      v2([row("r0", "Valio jogurtti 1 kg", "Jogurtti")]),
    );
    const run = await runBatchEnrichment({
      ledger: async () => base,
      eventIds: ["e1", "e2"],
      providerId,
      consent,
      session,
      now: () => new Date(at),
    });
    expect(run.status).toBe("enriched");
    if (run.status !== "enriched") return;
    // The same label in two purchases is one row, written to both; the purchases stay apart.
    expect(connection.prompts).toHaveLength(1);
    expect(
      run.annotations.map((a) => [a.eventId, a.lineId, a.display?.name]),
    ).toEqual([
      ["e1", "l1", "Valio jogurtti 1 kg"],
      ["e2", "l1", "Valio jogurtti 1 kg"],
    ]);
    expect([...run.events.keys()]).toEqual(["e1", "e2"]);
    // Consent withdrawn while the model answered discards the answer.
    const withdrawn = await setup(
      alternative,
      v2([row("r0", "Valio jogurtti 1 kg", "Jogurtti")]),
    );
    let calls = 0;
    const result = await runBatchEnrichment({
      ledger: async () => {
        calls++;
        return calls === 1
          ? base
          : { ...base, consent: { ...base.consent, automatic: null } };
      },
      eventIds: ["e1"],
      providerId,
      consent: undefined,
      session: withdrawn.session,
    });
    expect(result).toEqual({ status: "skipped", reason: "consent" });
    expect(withdrawn.connection.prompts).toHaveLength(0);
  });
}
