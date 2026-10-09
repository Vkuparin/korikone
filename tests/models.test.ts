import { expect, test, vi } from "vitest";
import { chooseModel } from "../src/ai/models";
import { ChatGPT } from "../src/ai/chatgpt";

test("chooses an available small model without pinning a release identifier", () => {
  expect(
    chooseModel([
      { slug: "gpt-88-astra", name: "Large model" },
      { slug: "gpt-88-luna", name: "Small model" },
    ]),
  ).toBe("gpt-88-luna");
  expect(
    chooseModel([
      { slug: "future-default", name: "General" },
      { slug: "future-efficient", name: "Future Mini" },
    ]),
  ).toBe("future-efficient");
});

test("automatic generation rediscovers models after a catalogue rename", async () => {
  const saved = new Map<string, unknown>([
    [
      "chatgpt-credentials",
      JSON.stringify({
        clientId: "test-client",
        subject: "test-subject",
        email: "example@example.com",
        accessToken: "test-token",
        refreshToken: "",
        idToken: "",
        expiresAt: Date.now() + 3600000,
        scopes: ["chatgpt.tokens.use.direct"],
      }),
    ],
  ]);
  const ai = new ChatGPT(
    {
      get: async (key) => saved.get(key),
      set: async (key, value) => saved.set(key, value),
    },
    { encrypt: (text) => text, decrypt: (text) => text },
    async () => {},
  );
  let lists = 0;
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) {
      lists++;
      return Response.json({
        models: [
          {
            slug: lists === 1 ? "old-luna" : "renamed-mini",
            display_name: "Small",
            visibility: "list",
          },
        ],
      });
    }
    sent.push(JSON.parse(String(init?.body)).model);
    return new Response(
      'data: {"type":"response.output_text.delta","delta":"draft"}\n\ndata: {"type":"response.completed"}\n\n',
    );
  });
  try {
    await ai.init();
    expect(await ai.generate("auto", "first")).toBe("draft");
    expect(await ai.generate("auto", "second")).toBe("draft");
    expect(sent).toEqual(["old-luna", "renamed-mini"]);
    expect(lists).toBe(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("uses catalogue order for unfamiliar names and rejects unavailable overrides", () => {
  const models = [
    { slug: "new-default", name: "New" },
    { slug: "other", name: "Other" },
  ];
  expect(() => chooseModel(models)).toThrow("modelSelectionRequired");
  expect(chooseModel(models, "other")).toBe("other");
  expect(() => chooseModel(models, "retired-luna")).toThrow("modelUnavailable");
  expect(() => chooseModel([])).toThrow("modelsUnavailable");
});
