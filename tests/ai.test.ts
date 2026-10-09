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
test("rejects invented references and malformed drafts, and remaps colliding recipe IDs", () => {
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
  const remapped = validateDraft(
    JSON.stringify({ ...valid, recipes: [state.recipes[0]] }),
    state,
  );
  expect(remapped.recipes[0].id).not.toBe("pasta");
  expect(remapped.meals[0].recipeId).toBe(remapped.recipes[0].id);
  expect(() => validateDraft('{"partial":', state)).toThrow("invalidDraft");
});

test("multiple meals and ready foods share ingredient identities and survive code fences", () => {
  const state = initialState();
  const raw = {
    recipes: [
      {
        id: "soup",
        name: "Nakkikeitto",
        servings: 4,
        instructions: "Keitä.",
        ingredients: [
          { id: "potatoes", name: "Peruna", amount: 800, unit: "g" },
        ],
      },
      {
        id: "fish",
        name: "Lohi",
        servings: 4,
        instructions: "Paista.",
        ingredients: [
          { id: "different-id", name: "Peruna", amount: 600, unit: "g" },
        ],
      },
    ],
    meals: [
      { recipeId: "soup", servings: 4 },
      { recipeId: "fish", servings: 4 },
    ],
    items: [{ id: "pizza", name: "Pakastepizza", amount: 1050, unit: "g" }],
  };
  const draft = validateDraft(
    "```json\n" + JSON.stringify(raw) + "\n```",
    state,
  );
  expect(draft.meals).toHaveLength(2);
  expect(draft.recipes.map((r) => r.ingredients[0].id)).toEqual([
    "potato",
    "potato",
  ]);
  expect(draft.items[0].amount).toBe(1050);
  expect(draft.meals[0].recipeId).toBe(draft.recipes[0].id);
  expect(
    validateDraft(JSON.stringify({ items: raw.items }), state).meals,
  ).toEqual([]);
  expect(() =>
    validateDraft(
      JSON.stringify({ ...raw, recipes: [raw.recipes[0], raw.recipes[0]] }),
      state,
    ),
  ).toThrow("invalidDraft");
});
