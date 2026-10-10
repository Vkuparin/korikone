import { expect, test } from "vitest";
import {
  resolveCandidates,
  resolutionNativeOutput,
  resolutionPrompt,
  type ResolutionSnapshot,
} from "../src/ai/resolve";
import { buildResolutionBatch } from "../src/domain/resolution";
import { matchRequirement } from "../src/domain/matching";
import type { Product, Requirement } from "../src/domain/model";
import { retailerEvidence } from "../src/stores/candidates";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import {
  InferenceError,
  InferenceSession,
  discoverInferenceModels,
} from "../src/ai/provider";
import { candidateResolutionTask, shoppingDraftTask } from "../src/ai/tasks";
import { ScriptedInferenceProvider } from "./helpers/inference";

function snapshot(): ResolutionSnapshot {
  const context = {
    providerId: "k-ruoka",
    storeId: "private-store",
    storeName: "Private location",
    fulfillment: "pickup" as const,
  };
  const lines = ["cream-a", "cream-b"].map((id) => {
    const requirement: Requirement = {
      id,
      name: "Kerma",
      amount: 300,
      unit: "ml",
      sources: ["private-recipe"],
    };
    const products: Product[] = ["Ruokakerma 200 ml", "Kuohukerma 200 ml"].map(
      (name, i) => ({
        id: `private-${id}-${i}`,
        ingredientId: id,
        providerId: context.providerId,
        storeId: context.storeId,
        name,
        price: i ? 200 : 100,
        deposit: 10,
        available: true,
        packAmount: 200,
        unit: "ml",
        nativeUnit: "kpl",
        increment: 1,
        observedAt: "2026-01-01",
        evidence: retailerEvidence(name),
      }),
    );
    return matchRequirement(requirement, products, { context });
  });
  return {
    lines,
    source: { revision: 7, context },
    options: { sourceNote: "Private raw note" },
  };
}
const valid = {
  version: 1,
  choices: [
    {
      rowId: "row-0",
      candidateId: "candidate-0",
      status: "approval-required",
      reason: "type-alternative",
    },
  ],
};
class ResolverConnection extends FixtureAI {
  readonly requests: { model: string; prompt: string; signal: AbortSignal }[] =
    [];
  constructor(
    private reply: (signal: AbortSignal) => Promise<string> = async () =>
      JSON.stringify(valid),
  ) {
    super();
  }
  override async generatePinned(
    model: string,
    prompt: string,
    signal: AbortSignal,
  ) {
    this.requests.push({ model, prompt, signal });
    return this.reply(signal);
  }
}
async function setup(
  alternative: boolean,
  reply?: (signal: AbortSignal) => Promise<string>,
  maxCalls = 3,
  timeoutMs = 1000,
) {
  const connection = new ResolverConnection(reply);
  await connection.signIn();
  const provider = alternative
    ? new FakeInferenceProvider(connection, true)
    : new ChatGPTInferenceProvider(connection);
  const controller = new AbortController();
  const models = await discoverInferenceModels(provider, controller.signal);
  const session = new InferenceSession(
    provider,
    models.find((model) => model.modelId === "fixture-large")!,
    { maxCalls, maxOutputCharacters: 10_000, timeoutMs },
    controller.signal,
  );
  const current = snapshot();
  const batch = buildResolutionBatch(
    current.lines,
    current.source,
    current.options,
  );
  return { connection, provider, controller, session, current, batch };
}

for (const alternative of [false, true]) {
  const label = alternative ? "fake alternative" : "local ChatGPT adapter";
  test(`${label}: partial result preserves omitted rows and domain cost without approval or rediscovery`, async () => {
    const { connection, provider, session, current, batch } =
      await setup(alternative);
    const before = structuredClone(current);
    const result = await resolveCandidates(session, batch, () => current);
    expect(result).toEqual([
      {
        requirementKey: "cream-a:ml",
        productId: "private-cream-a-0",
        status: "approval-required",
        reason: "type-alternative",
      },
      {
        requirementKey: "cream-b:ml",
        productId: null,
        status: "unresolved",
        reason: "no-response",
      },
    ]);
    expect(current).toEqual(before);
    expect(current.lines.every((line) => line.product === null)).toBe(true);
    expect(batch.request!.rows[0].candidates[0]).toMatchObject({
      packs: 2,
      total: 220,
    });
    expect(connection.requests).toHaveLength(1);
    expect(connection.catalogueRequests).toBe(1);
    expect(connection.requests[0].model).toBe("fixture-large");
    expect(session.model.providerId).toBe(provider.id);
    expect(session.callCount).toBe(1);
    expect(connection.requests[0].prompt).not.toMatch(
      /Private raw note|private-store|private-cream|private-recipe/,
    );
    await expect(
      resolveCandidates(session, batch, () => current),
    ).rejects.toMatchObject({ code: "requestLimit" });
    const rebuilt = buildResolutionBatch(
      current.lines,
      current.source,
      current.options,
    );
    await expect(
      resolveCandidates(session, rebuilt, () => current),
    ).rejects.toMatchObject({ code: "requestLimit" });
    expect(connection.requests).toHaveLength(1);
  });

  test(`${label}: malformed, invented, duplicate and fabricated choices fail once without repair`, async () => {
    for (const reply of [
      "{",
      JSON.stringify({ ...valid, price: 1 }),
      JSON.stringify({
        version: 1,
        choices: [{ ...valid.choices[0], candidateId: "private-cream-a-0" }],
      }),
      JSON.stringify({
        version: 1,
        choices: [{ ...valid.choices[0], candidateId: "candidate-4" }],
      }),
      JSON.stringify({
        version: 1,
        choices: [{ ...valid.choices[0], rowId: "row-11" }],
      }),
      JSON.stringify({
        version: 1,
        choices: [valid.choices[0], valid.choices[0]],
      }),
      JSON.stringify({
        version: 1,
        choices: [{ ...valid.choices[0], status: "resolved" }],
      }),
      JSON.stringify({
        version: 1,
        choices: [{ ...valid.choices[0], available: true }],
      }),
    ]) {
      const { session, batch, current, connection } = await setup(
        alternative,
        async () => reply,
      );
      await expect(
        resolveCandidates(session, batch, () => current),
      ).rejects.toMatchObject({ code: "invalidOutput" });
      expect(connection.requests).toHaveLength(1);
      expect(session.callCount).toBe(1);
      expect(current.lines.every((line) => line.product === null)).toBe(true);
    }
  });

  test(`${label}: revision, candidate, required constraints and pack changes during response reject`, async () => {
    for (const mutate of [
      (current: ResolutionSnapshot) => {
        current.source.revision++;
      },
      (current: ResolutionSnapshot) => {
        current.lines[0].candidates[0].evidence!.family = "plant-cream";
      },
      (current: ResolutionSnapshot) => {
        current.lines[0].candidates[0].packAmount = 0;
      },
      (current: ResolutionSnapshot) => {
        current.options!.preferences = [
          {
            category: "cream",
            qualifiers: [{ kind: "cream", value: "whipping" }],
            strength: "required",
          },
        ];
      },
    ]) {
      let change = () => {};
      const state = await setup(alternative, async () => {
        change();
        return JSON.stringify(valid);
      });
      change = () => mutate(state.current);
      await expect(
        resolveCandidates(state.session, state.batch, () => state.current),
      ).rejects.toThrow("resolutionStale");
      expect(state.connection.requests).toHaveLength(1);
      expect(state.current.lines.every((line) => line.product === null)).toBe(
        true,
      );
    }
  });

  test(`${label}: incomplete, usage, permission and transport errors retain fixed codes and use one call`, async () => {
    for (const [message, code] of [
      ["incompleteDraft", "incomplete"],
      ["usageLimit", "usageLimit"],
      ["permissionMissing", "permissionDenied"],
      ["secret response body", "transport"],
    ]) {
      const { session, batch, current, connection } = await setup(
        alternative,
        async () => {
          throw new Error(message);
        },
      );
      await expect(
        resolveCandidates(session, batch, () => current),
      ).rejects.toMatchObject({ code, message: code });
      expect(connection.requests).toHaveLength(1);
      expect(connection.catalogueRequests).toBe(1);
    }
  });

  test(`${label}: shared operation cap includes interpretation calls; resolver cannot spend a fourth request`, async () => {
    const { session, batch, current, connection } = await setup(
      alternative,
      undefined,
      2,
    );
    await session.invoke(shoppingDraftTask, "Interpretation");
    await session.invoke(shoppingDraftTask, "Interpretation repair");
    await expect(
      resolveCandidates(session, batch, () => current),
    ).rejects.toMatchObject({ code: "requestLimit" });
    expect(connection.requests).toHaveLength(2);
    expect(session.callCount).toBe(2);
    const allowed = await setup(alternative);
    await allowed.session.invoke(shoppingDraftTask, "Interpretation");
    await allowed.session.invoke(shoppingDraftTask, "Interpretation repair");
    await resolveCandidates(
      allowed.session,
      allowed.batch,
      () => allowed.current,
    );
    expect(allowed.session.callCount).toBe(3);
    expect(allowed.connection.catalogueRequests).toBe(1);
  });

  test(`${label}: cancellation rejects late output, and timeout makes no repair`, async () => {
    let finish: (value: string) => void = () => {};
    const state = await setup(
      alternative,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = resolveCandidates(
      state.session,
      state.batch,
      () => state.current,
    );
    state.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    finish(JSON.stringify(valid));
    await Promise.resolve();
    expect(state.connection.requests).toHaveLength(1);
    expect(state.connection.requests[0].signal.aborted).toBe(true);
    expect(state.current.lines.every((line) => line.product === null)).toBe(
      true,
    );
    const timed = await setup(alternative, () => new Promise(() => {}), 3, 5);
    await expect(
      resolveCandidates(timed.session, timed.batch, () => timed.current),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(timed.connection.requests).toHaveLength(1);
  });

  test(`${label}: real development FixtureAI supports the resolver on the pinned model`, async () => {
    const fixture = new FixtureAI();
    await fixture.signIn();
    const provider = alternative
      ? new FakeInferenceProvider(fixture, true)
      : new ChatGPTInferenceProvider(fixture);
    const signal = new AbortController().signal;
    const models = await discoverInferenceModels(provider, signal);
    const session = new InferenceSession(
      provider,
      models[0],
      { maxCalls: 3, maxOutputCharacters: 10_000, timeoutMs: 1000 },
      signal,
    );
    const current = snapshot();
    const batch = buildResolutionBatch(
      current.lines,
      current.source,
      current.options,
    );
    const result = await resolveCandidates(session, batch, () => current);
    expect(result).toHaveLength(2);
    expect(result.every((row) => row.status === "approval-required")).toBe(
      true,
    );
    expect(fixture.requestCount).toBe(1);
    expect(fixture.catalogueRequests).toBe(1);
    expect(fixture.lastModel).toBe("fixture-mini");
  });
}

test("native output and text output share strict result validation and preserve null candidateId", async () => {
  const result = {
    version: 1,
    choices: [
      {
        rowId: "row-0",
        candidateId: null,
        status: "unresolved",
        reason: "insufficient-evidence",
      },
    ],
  };
  for (const native of [false, true]) {
    const provider = new ScriptedInferenceProvider(
      "scripted-resolver",
      async () => ({ text: JSON.stringify(result), completion: "complete" }),
    );
    provider.models[0].capabilities.tasks.push(candidateResolutionTask);
    provider.models[0].capabilities.outputModes = native
      ? ["json-schema", "text"]
      : ["text"];
    const session = new InferenceSession(
      provider,
      provider.models[0],
      { maxCalls: 3, maxOutputCharacters: 10_000, timeoutMs: 1000 },
      new AbortController().signal,
    );
    const current = snapshot();
    const batch = buildResolutionBatch(
      current.lines,
      current.source,
      current.options,
    );
    expect(
      (await resolveCandidates(session, batch, () => current))[0],
    ).toMatchObject({
      productId: null,
      status: "unresolved",
      reason: "insufficient-evidence",
    });
    expect(provider.calls[0].output.mode).toBe(native ? "json-schema" : "text");
    if (native)
      expect(provider.calls[0].output).toEqual(resolutionNativeOutput);
    expect(provider.calls[0].prompt).not.toContain("optional metadata");
  }
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const schema = value as Record<string, unknown>;
    if (schema.type === "object") {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
    for (const child of Object.values(schema))
      Array.isArray(child) ? child.forEach(inspect) : inspect(child);
  };
  inspect(resolutionNativeOutput.schema);
});

test("empty/clear batches and stale preflight dispatch zero calls; unsupported task stays on the pinned provider", async () => {
  const state = await setup(false);
  const clear = buildResolutionBatch([], state.current.source);
  expect(
    await resolveCandidates(state.session, clear, () => state.current),
  ).toEqual([]);
  expect(state.session.callCount).toBe(0);
  const milk = structuredClone(state.current.lines[0]);
  milk.requirement.name = "Maito";
  for (const product of milk.candidates) {
    product.name = "Kevytmaito 1 l";
    product.evidence = retailerEvidence(product.name);
    product.packAmount = 1000;
  }
  const milkBatch = buildResolutionBatch([milk], state.current.source);
  expect(milkBatch.request).toBeNull();
  expect(
    await resolveCandidates(state.session, milkBatch, () => state.current),
  ).toEqual([]);
  expect(state.session.callCount).toBe(0);
  state.current.source.revision++;
  await expect(
    resolveCandidates(state.session, state.batch, () => state.current),
  ).rejects.toThrow("resolutionStale");
  expect(state.session.callCount).toBe(0);
  const provider = new ScriptedInferenceProvider(
    "unsupported-local",
    async () => {
      throw new Error("must not dispatch");
    },
  );
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 3, maxOutputCharacters: 1000, timeoutMs: 1000 },
    new AbortController().signal,
  );
  const current = snapshot();
  const batch = buildResolutionBatch(
    current.lines,
    current.source,
    current.options,
  );
  await expect(
    resolveCandidates(session, batch, () => current),
  ).rejects.toMatchObject({ code: "unsupportedTask" });
  expect(provider.calls).toHaveLength(0);
  expect(resolutionPrompt(batch)).toContain("untrusted data");
});

test("native schema failures are terminal and cannot be corrected through a new batch", async () => {
  for (const output of [
    { choices: [] },
    { ...valid, unknown: true },
    { version: 1, choices: [{ ...valid.choices[0], candidateId: null }] },
  ]) {
    const provider = new ScriptedInferenceProvider(
      "invalid-native",
      async () => ({ text: JSON.stringify(output), completion: "complete" }),
    );
    provider.models[0].capabilities.tasks.push(candidateResolutionTask);
    provider.models[0].capabilities.outputModes = ["json-schema", "text"];
    const session = new InferenceSession(
      provider,
      provider.models[0],
      { maxCalls: 3, maxOutputCharacters: 10_000, timeoutMs: 1000 },
      new AbortController().signal,
    );
    const current = snapshot();
    const batch = buildResolutionBatch(
      current.lines,
      current.source,
      current.options,
    );
    await expect(
      resolveCandidates(session, batch, () => current),
    ).rejects.toMatchObject({ code: "invalidOutput" });
    const rebuilt = buildResolutionBatch(
      current.lines,
      current.source,
      current.options,
    );
    await expect(
      resolveCandidates(session, rebuilt, () => current),
    ).rejects.toMatchObject({ code: "requestLimit" });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].output.mode).toBe("json-schema");
  }
});

test("protocol-level incomplete native output never switches format or spends repair", async () => {
  const provider = new ScriptedInferenceProvider(
    "native-incomplete",
    async () => ({ text: JSON.stringify(valid), completion: "incomplete" }),
  );
  provider.models[0].capabilities.tasks.push(candidateResolutionTask);
  provider.models[0].capabilities.outputModes = ["text", "json-schema"];
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 3, maxOutputCharacters: 10_000, timeoutMs: 1000 },
    new AbortController().signal,
  );
  const current = snapshot();
  const batch = buildResolutionBatch(
    current.lines,
    current.source,
    current.options,
  );
  await expect(
    resolveCandidates(session, batch, () => current),
  ).rejects.toEqual(new InferenceError("incomplete"));
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0].output.mode).toBe("json-schema");
});
