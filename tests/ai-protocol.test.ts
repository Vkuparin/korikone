import { expect, test } from "vitest";
import {
  chatGPTOutputModes,
  completedText,
  responseRequest,
  resource,
} from "../src/ai/protocol";
import { validateDraft } from "../src/ai/draft";
import { initialState } from "../src/domain/model";
import { InferenceError } from "../src/ai/provider";

const stream = (events: unknown[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events)
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      controller.close();
    },
  });

test("ChatGPT plan route keeps the documented bounded request fields and explicitly text-only capability", () => {
  expect(resource).toBe("https://api.openai.com/v1");
  expect(chatGPTOutputModes).toEqual(["text"]);
  expect(responseRequest("pinned-model", "Synthetic note")).toEqual({
    model: "pinned-model",
    input: [{ role: "user", content: "Synthetic note" }],
    store: false,
    stream: true,
  });
  // No unsupported token-limit/cache/billing fields are smuggled into the wire request.
  expect(Object.keys(responseRequest("pinned-model", "note"))).toEqual([
    "model",
    "input",
    "store",
    "stream",
  ]);
});

test("unconfirmed native schema output is rejected locally and is not a validation repair error", () => {
  try {
    responseRequest("pinned-model", "note", {
      mode: "json-schema",
      name: "shopping_v1",
      schema: { type: "object" },
    });
    throw new Error("Expected unsupported capability");
  } catch (error) {
    expect(error).toBeInstanceOf(InferenceError);
    expect((error as InferenceError).code).toBe("unsupportedCapability");
    expect((error as Error).message).not.toBe("invalidDraft");
  }
});

test("completed text still passes real JSON and domain validation rather than trusting SSE completion", async () => {
  const text = await completedText(
    stream([
      {
        type: "response.output_text.delta",
        delta:
          '{"items":[{"id":"milk","name":"Maito","amount":1000,"unit":"ml"}]}',
      },
      { type: "response.completed" },
    ]),
  );
  expect(validateDraft(text, initialState()).items[0]).toMatchObject({
    name: "Maito",
    amount: 1000,
    unit: "ml",
  });
  for (const bad of [
    '{"items":',
    '{"meals":[{"recipeId":"invented","servings":4}]}',
    '{"items":[{"id":"milk","name":"Maito","amount":0.5,"unit":"l"}]}',
  ]) {
    const raw = await completedText(
      stream([
        { type: "response.output_text.delta", delta: bad },
        { type: "response.completed" },
      ]),
    );
    expect(() => validateDraft(raw, initialState())).toThrow("invalidDraft");
  }
});

test("partial, incomplete and usage-limited streams never become successful validated JSON", async () => {
  for (const terminal of [
    undefined,
    { type: "response.incomplete" },
    {
      type: "response.failed",
      response: {
        error: { code: "subscription_sharing_usage_limit_exceeded" },
      },
    },
  ]) {
    const events = [
      {
        type: "response.output_text.delta",
        delta:
          '{"items":[{"id":"milk","name":"Maito","amount":1000,"unit":"ml"}]}',
      },
      ...(terminal ? [terminal] : []),
    ];
    await expect(completedText(stream(events))).rejects.toThrow(
      terminal && terminal.type === "response.failed"
        ? "usageLimit"
        : "incompleteDraft",
    );
  }
});

test("explicit cancellation stays a transport failure before completed JSON can be accepted", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    completedText(stream([{ type: "response.completed" }]), controller.signal),
  ).rejects.toThrow("cancelled");
});
