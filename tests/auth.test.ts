import { test, expect } from "vitest";
import { ChatGPT } from "../src/ai/chatgpt";
test("binds callback to attempt, retains stable host, and cancels a denied sign-in without credentials", async () => {
  const values = new Map<string, unknown>();
  let opened = "";
  const db = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  const ai = new ChatGPT(
    db,
    {
      encrypt: () => {
        throw new Error("No credentials expected");
      },
      decrypt: () => {
        throw new Error("No credentials expected");
      },
    },
    async (url) => {
      opened = url;
    },
  );
  await ai.init();
  const host = values.get("chatgpt-host");
  try {
    await ai.signIn();
    expect(ai.status().state).toBe("waiting");
    const parameters = new URL(opened).searchParams;
    const redirect = parameters.get("redirect_uri")!;
    const rejected = await fetch(`${redirect}?state=wrong&error=access_denied`);
    expect(rejected.status).toBe(400);
    expect(ai.status().state).toBe("waiting");
    await fetch(
      `${redirect}?${new URLSearchParams({ state: parameters.get("state")!, error: "access_denied" })}`,
    );
    expect(ai.status().error).toBe("permissionDenied");
    expect(values.has("chatgpt-credentials")).toBe(false);
    await ai.signIn();
    expect(new URL(opened).searchParams.get("ext_agent_host_id")).toBe(host);
    ai.cancel();
    expect(ai.status().state).toBe("disconnected");
  } finally {
    ai.cancel();
  }
});
