import { test, expect } from "vitest";
import {
  authorization,
  callback,
  completedText,
  responseRequest,
} from "../src/ai/protocol";
import { validateDraft } from "../src/ai/draft";
import { initialState } from "../src/domain/model";
function stream(events: unknown[], chunk = 7) {
  const raw = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  );
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < raw.length; i += chunk)
        controller.enqueue(raw.slice(i, i + chunk));
      controller.close();
    },
  });
}
test("uses dynamic registration, stable host and fresh PKCE/state/nonce", () => {
  const first = authorization(
    "urn:uuid:host",
    "http://127.0.0.1:1234/auth/callback",
  );
  const params = new URL(first.url).searchParams;
  expect(params.get("client_id")).toBe("dynamic_agent_client");
  expect(params.get("agent_name_hint")).toBe("Korikone");
  expect(params.get("code_challenge")).not.toBe(first.verifier);
  const returning = authorization(
    "urn:uuid:host",
    "http://127.0.0.1:5432/auth/callback",
    "issued",
  );
  expect(returning.state).not.toBe(first.state);
  expect(new URL(returning.url).searchParams.has("agent_name_hint")).toBe(
    false,
  );
});
test("rejects stale callbacks, denied grants and replaced client IDs", () => {
  expect(() =>
    callback(new URLSearchParams("state=other&code=a&client_id=b"), "expected"),
  ).toThrow("invalidCallback");
  expect(() =>
    callback(
      new URLSearchParams("state=expected&error=access_denied"),
      "expected",
    ),
  ).toThrow("permissionDenied");
  expect(() =>
    callback(
      new URLSearchParams("state=expected&code=a&client_id=b"),
      "expected",
      "original",
    ),
  ).toThrow("invalidCallback");
  expect(
    callback(
      new URLSearchParams("state=expected&code=a"),
      "expected",
      "original",
    ),
  ).toEqual({ clientId: "original", code: "a" });
});
test("requires completed inference even after partial text", async () => {
  await expect(
    completedText(
      stream([{ type: "response.output_text.delta", delta: "partial" }]),
    ),
  ).rejects.toThrow("incompleteDraft");
  await expect(
    completedText(
      stream([
        { type: "response.output_text.delta", delta: "partial" },
        {
          type: "response.failed",
          response: {
            error: { code: "subscription_sharing_usage_limit_exceeded" },
          },
        },
      ]),
    ),
  ).rejects.toThrow("usageLimit");
  expect(
    await completedText(
      stream(
        [
          { type: "response.output_text.delta", delta: "äö" },
          { type: "response.completed" },
        ],
        1,
      ),
    ),
  ).toBe("äö");
  expect(responseRequest("selected", "test")).toMatchObject({
    model: "selected",
    store: false,
    stream: true,
  });
});
test("rejects invented recipe references, collisions and malformed drafts", () => {
  const state = initialState();
  const valid = {
    recipes: [],
    meals: [{ day: 0, recipeId: "pasta", servings: 4, leftovers: false }],
    notes: "",
  };
  expect(validateDraft(JSON.stringify(valid), state).meals).toHaveLength(1);
  expect(() =>
    validateDraft(
      JSON.stringify({
        ...valid,
        meals: [{ ...valid.meals[0], recipeId: "invented" }],
      }),
      state,
    ),
  ).toThrow("invalidDraft");
  expect(() =>
    validateDraft(
      JSON.stringify({ ...valid, recipes: [state.recipes[0]] }),
      state,
    ),
  ).toThrow("invalidDraft");
  expect(() => validateDraft('{"partial":', state)).toThrow("invalidDraft");
});
