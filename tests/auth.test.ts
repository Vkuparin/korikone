import { test, expect } from "vitest";
import { ChatGPT } from "../src/ai/chatgpt";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

test("an existing encrypted connection is restored without sign-in or an AI request", async () => {
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const credential = JSON.stringify({
    clientId: "synthetic-client",
    subject: "synthetic-user",
    email: "fixture@example.invalid",
    accessToken: "access",
    refreshToken: "refresh",
    idToken: "id",
    expiresAt: 1,
    scopes: ["chatgpt.tokens.use.direct"],
  });
  const encrypted = Buffer.concat([cipher.update(credential), cipher.final()]);
  const tag = cipher.getAuthTag();
  const values = new Map<string, unknown>([
    ["chatgpt-credentials", encrypted.toString("base64")],
    ["chatgpt-host", "stable-host"],
    ["chatgpt-registration", { clientId: "synthetic-client" }],
  ]);
  const before = structuredClone(values);
  const db = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  const decrypt = (value: string) => {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(value, "base64")),
      decipher.final(),
    ]).toString();
  };
  for (const canDecrypt of [true, false, true]) {
    const ai = new ChatGPT(
      db,
      {
        encrypt: () => {
          throw new Error("Unexpected write");
        },
        decrypt: (value) => {
          if (!canDecrypt) throw new Error("Temporarily unavailable");
          return decrypt(value);
        },
      },
      async () => {
        throw new Error("Unexpected sign-in");
      },
    );
    await ai.init();
    expect(ai.status()).toMatchObject(
      canDecrypt
        ? { state: "connected", email: "fixture@example.invalid", error: null }
        : { state: "disconnected", error: "credentialUnavailable" },
    );
    expect(values).toEqual(before);
  }
});

test("Windows upgrades keep the existing installer identity and retain app data", async () => {
  const metadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(metadata.name).toBe("korikone");
  expect(metadata.build.appId).toBe("fi.korikone.desktop");
  expect(metadata.build.productName).toBe("Korikone");
  expect(metadata.build.nsis.deleteAppDataOnUninstall).toBe(false);
});
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
