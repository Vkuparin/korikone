import { test, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SKaupatHost, type SKaupatPage } from "../src/main/s-kaupat-host";
import { SKaupatSession, sKaupatWorker } from "../src/stores/s-kaupat";

const part = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${part({ alg: "none" })}.${part({ exp: Math.floor(Date.now() / 1000) + 7 * 86400 })}.sig`;

// A stand-in for the signed-in S-kaupat tab: it answers the scripts the bridge sends.
let entries: [string, string][] = [];
const requests: { url: string; authorization?: string }[] = [];
const page: SKaupatPage = {
  evaluate: async (script) => {
    if (script.includes("localStorage"))
      return { ok: true, entries, path: "/" };
    const request = JSON.parse(script.slice(script.lastIndexOf("})(") + 3, -1));
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    return {
      ok: true,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          userProfile: { firstName: "Testi", lastName: "X", userId: "user-1" },
        },
      }),
    };
  },
  reload: async () => {},
  open: async () => {},
  forget: async () => {
    entries = [];
  },
};
const data = mkdtempSync(join(tmpdir(), "korikone-s-tab-"));
const host = new SKaupatHost(page);
await host.start();
const worker = sKaupatWorker({
  script: resolve("vendor/s-kaupat/s-kaupat-mcp.cjs"),
  dataDir: data,
  host: { url: host.url, key: host.key },
});
const marker = { get: async () => null, set: async () => null };
const session = new SKaupatSession(
  (name, args, timeout) => worker.call(name, args, timeout),
  marker,
  true,
);
afterAll(async () => {
  await worker.close();
  host.close();
  rmSync(data, { recursive: true, force: true });
});

test("the pinned server uses the tab's login and signs out through the tab", async () => {
  expect(await session.signedIn()).toBe(false);
  entries = [
    [
      "session-storage",
      JSON.stringify({
        state: {
          authTokens: {
            accessToken: token,
            refreshToken: "refresh-1",
            idToken: "id",
          },
        },
      }),
    ],
  ];
  expect(await session.signedIn()).toBe(true);
  // The call goes out from the tab with the site's own token, and only to S-kaupat.
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.url).toMatch(/^https:\/\/(api|www)\.s-kaupat\.fi\//);
    expect(request.authorization).toBe(token);
  }
  await session.logout();
  expect(entries).toEqual([]);
  expect(await session.signedIn()).toBe(false);
}, 60_000);
