import { test, expect, vi } from "vitest";
import {
  InferenceError,
  InferenceProviders,
  InferenceSession,
  discoverInferenceModels,
  type InferenceResult,
} from "../src/ai/provider";
import { ScriptedInferenceProvider } from "./helpers/inference";

const task = { id: "shopping-draft", version: 1 };
const bounds = { maxCalls: 3, maxOutputCharacters: 1000, timeoutMs: 1000 };
const success = async (): Promise<InferenceResult> => ({
  text: '{"items":[]}',
  completion: "complete",
});

test("provider discovery and invocation keep equal model names scoped to the selected provider", async () => {
  const providers = new InferenceProviders();
  const cloud = new ScriptedInferenceProvider("fake-chatgpt", success);
  const local = new ScriptedInferenceProvider("fake-local", success);
  providers.register(cloud);
  providers.register(local);
  expect(() => providers.get("missing")).toThrow("unsupportedProvider");
  expect(() => providers.register(cloud)).toThrow("unsupportedProvider");
  const controller = new AbortController();
  const [model] = await discoverInferenceModels(
    providers.get("fake-local"),
    controller.signal,
  );
  const session = new InferenceSession(local, model, bounds, controller.signal);
  model.modelId = "changed-after-snapshot";
  model.capabilities.tasks.length = 0;
  await expect(session.invoke(task, "Synthetic note")).resolves.toEqual(
    await success(),
  );
  expect(local.calls[0].model).toEqual({
    providerId: "fake-local",
    modelId: "same-model-name",
  });
  expect(cloud.calls).toHaveLength(0);
  expect(session.callCount).toBe(1);
  expect(
    () => new InferenceSession(cloud, session.model, bounds, controller.signal),
  ).toThrow("unsupportedProvider");
});

test("unsupported tasks, versions and output/stream capabilities fail without consuming a provider request", async () => {
  const provider = new ScriptedInferenceProvider("fake-local", success);
  const session = new InferenceSession(
    provider,
    provider.models[0],
    bounds,
    new AbortController().signal,
  );
  await expect(
    session.invoke({ id: "receipt-enrichment", version: 1 }, "note"),
  ).rejects.toThrow("unsupportedTask");
  await expect(session.invoke({ ...task, version: 2 }, "note")).rejects.toThrow(
    "unsupportedTask",
  );
  await expect(
    session.invoke(task, "note", {
      mode: "json-schema",
      name: "draft",
      schema: {},
    }),
  ).rejects.toThrow("unsupportedCapability");
  await expect(
    session.invoke(task, "note", { mode: "text" }, () => {}),
  ).rejects.toThrow("unsupportedCapability");
  expect(session.callCount).toBe(0);
  expect(provider.calls).toHaveLength(0);
});

test("caller-owned request caps count failed attempts and never retry or switch providers", async () => {
  const provider = new ScriptedInferenceProvider("fake-local", async () => {
    throw new InferenceError("usageLimit");
  });
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { ...bounds, maxCalls: 1 },
    new AbortController().signal,
  );
  await expect(session.invoke(task, "note")).rejects.toMatchObject({
    code: "usageLimit",
  });
  await expect(session.invoke(task, "note")).rejects.toMatchObject({
    code: "requestLimit",
  });
  expect(provider.calls).toHaveLength(1);
  expect(session.callCount).toBe(1);
});

test("incomplete, oversized and malformed responses are distinct from task validation and transport errors", async () => {
  for (const [reply, code] of [
    [{ text: "partial", completion: "incomplete" }, "incomplete"],
    [{ text: "x".repeat(1001), completion: "complete" }, "invalidOutput"],
    [{ text: 12, completion: "complete" }, "invalidOutput"],
  ] as const) {
    const provider = new ScriptedInferenceProvider(
      "fake",
      async () => reply as unknown as InferenceResult,
    );
    const session = new InferenceSession(
      provider,
      provider.models[0],
      bounds,
      new AbortController().signal,
    );
    await expect(session.invoke(task, "note")).rejects.toMatchObject({ code });
    expect(provider.calls).toHaveLength(1);
  }
  const provider = new ScriptedInferenceProvider("fake", async () => {
    throw new Error("Private provider response body");
  });
  const session = new InferenceSession(
    provider,
    provider.models[0],
    bounds,
    new AbortController().signal,
  );
  await expect(session.invoke(task, "note")).rejects.toMatchObject({
    code: "transport",
    message: "transport",
  });
});

test("cancellation rejects an adapter that ignores abort and discards late output", async () => {
  let finish!: (result: InferenceResult) => void;
  const provider = new ScriptedInferenceProvider(
    "fake-local",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const session = new InferenceSession(
    provider,
    provider.models[0],
    bounds,
    controller.signal,
  );
  const result = session.invoke(task, "note");
  const rejected = expect(result).rejects.toMatchObject({ code: "cancelled" });
  await expect(session.invoke(task, "parallel note")).rejects.toThrow("busy");
  controller.abort();
  await rejected;
  finish(await success());
  await expect(session.invoke(task, "later note")).rejects.toThrow("cancelled");
  expect(provider.signals[0].aborted).toBe(true);
  expect(provider.calls).toHaveLength(1);
});

test("timeout is terminal and never starts another request beside an unresponsive adapter", async () => {
  vi.useFakeTimers();
  try {
    const provider = new ScriptedInferenceProvider(
      "fake-local",
      () => new Promise(() => {}),
    );
    const session = new InferenceSession(
      provider,
      provider.models[0],
      bounds,
      new AbortController().signal,
    );
    const pending = session.invoke(task, "note");
    const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    await expect(session.invoke(task, "later")).rejects.toThrow("cancelled");
    expect(provider.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("stream events are sanitized, bounded and cannot bypass the complete response check", async () => {
  const provider = new ScriptedInferenceProvider(
    "fake",
    async (_request, _signal, onEvent) => {
      onEvent?.({ type: "text-delta", text: "x".repeat(1001) });
      return success();
    },
  );
  provider.models[0].capabilities.streaming = true;
  const events: unknown[] = [];
  const session = new InferenceSession(
    provider,
    provider.models[0],
    bounds,
    new AbortController().signal,
  );
  await expect(
    session.invoke(task, "note", { mode: "text" }, (event) =>
      events.push(event),
    ),
  ).rejects.toThrow("invalidOutput");
  expect(events).toEqual([]);
  expect(provider.signals[0].aborted).toBe(true);
});

test("discovery rejects cross-provider identities and duplicate model identifiers", async () => {
  const provider = new ScriptedInferenceProvider("fake", success);
  provider.models[0].providerId = "other";
  await expect(
    discoverInferenceModels(provider, new AbortController().signal),
  ).rejects.toThrow("invalidOutput");
  provider.models[0].providerId = "fake";
  provider.models.push(structuredClone(provider.models[0]));
  await expect(
    discoverInferenceModels(provider, new AbortController().signal),
  ).rejects.toThrow("invalidOutput");
});

test("a shared operation cap covers different task types and native schema output is capability-driven", async () => {
  const provider = new ScriptedInferenceProvider("fake-local", success);
  provider.models[0].capabilities.outputModes.push("json-schema");
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { ...bounds, maxCalls: 2 },
    new AbortController().signal,
  );
  const output = {
    mode: "json-schema" as const,
    name: "synthetic",
    schema: { type: "object" },
  };
  await session.invoke(task, "note", output);
  await session.invoke({ id: "recipe-import", version: 1 }, "recipe");
  await expect(session.invoke(task, "repair")).rejects.toThrow("requestLimit");
  expect(provider.calls[0].output).toEqual(output);
  expect(provider.calls).toHaveLength(2);
});

test("valid stream events stay task-neutral and unlimited empty events are refused", async () => {
  const provider = new ScriptedInferenceProvider(
    "fake-local",
    async (_request, _signal, event) => {
      event?.({ type: "text-delta", text: "synthetic" });
      event?.({ type: "usage", usage: { outputTokens: 1 } });
      return success();
    },
  );
  provider.models[0].capabilities.streaming = true;
  const session = new InferenceSession(
    provider,
    provider.models[0],
    bounds,
    new AbortController().signal,
  );
  const events: unknown[] = [];
  await session.invoke(task, "note", { mode: "text" }, (value) =>
    events.push(value),
  );
  expect(events).toEqual([
    { type: "text-delta", text: "synthetic" },
    { type: "usage", usage: { outputTokens: 1 } },
  ]);
  const flooding = new ScriptedInferenceProvider(
    "fake-local",
    async (_request, _signal, event) => {
      for (let i = 0; i < 10_001; i++)
        event?.({ type: "text-delta", text: "" });
      return success();
    },
  );
  flooding.models[0].capabilities.streaming = true;
  const bounded = new InferenceSession(
    flooding,
    flooding.models[0],
    bounds,
    new AbortController().signal,
  );
  await expect(
    bounded.invoke(task, "note", { mode: "text" }, () => {}),
  ).rejects.toThrow("invalidOutput");
});

test("model discovery observes cancellation even if the adapter never returns", async () => {
  const provider = new ScriptedInferenceProvider("fake-local", success);
  provider.discoverModels = async () => new Promise(() => {});
  const controller = new AbortController();
  const pending = discoverInferenceModels(provider, controller.signal);
  const rejected = expect(pending).rejects.toThrow("cancelled");
  controller.abort();
  await rejected;
});
