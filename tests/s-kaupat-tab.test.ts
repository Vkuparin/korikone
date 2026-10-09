import { test, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SKaupatHost, type SKaupatPage } from "../src/main/s-kaupat-host";
import { SKaupatSession, sKaupatWorker } from "../src/stores/s-kaupat";
import { SKaupatLibrary } from "../src/stores/s-kaupat-library";

const part = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${part({ alg: "none" })}.${part({ exp: Math.floor(Date.now() / 1000) + 7 * 86400 })}.sig`;

// A stand-in for the signed-in S-kaupat tab: it answers the scripts the bridge sends.
let entries: [string, string][] = [];
const requests: { url: string; authorization?: string }[] = [];
let onReload = () => {};
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
  reload: async () => onReload(),
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
const library = new SKaupatLibrary({
  dataDir: data,
  host: { url: host.url, key: host.key },
});
afterAll(async () => {
  await worker.close();
  await library.close();
  host.close();
  rmSync(data, { recursive: true, force: true });
});

test.each([worker, library])(
  "the shared client and standalone server use the tab's login and sign out through it",
  async (client) => {
    requests.length = 0;
    const session = new SKaupatSession(
      (name, args, timeout) => client.call(name, args, timeout),
      marker,
      true,
    );
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
  },
  60_000,
);

test.each([worker, library])(
  "an expired token is renewed by the page; failed renewal reports expiry without a retailer write",
  async (client) => {
    const session = new SKaupatSession(
      (name, args, timeout) => client.call(name, args, timeout),
      marker,
      true,
    );
    const expired = `${part({ alg: "none" })}.${part({ exp: 1 })}.sig`;
    const setToken = (accessToken: string, refreshToken: string) => {
      entries = [
        [
          "session-storage",
          JSON.stringify({
            state: {
              authTokens: { accessToken, refreshToken, idToken: "id" },
            },
          }),
        ],
      ];
    };
    await session.logout();
    requests.length = 0;
    setToken(expired, "renewed-session");
    let reloads = 0;
    onReload = () => {
      reloads++;
      setToken(token, "renewed-session");
    };
    try {
      expect(await session.signedIn()).toBe(true);
      expect(reloads).toBe(1);
      expect(requests.every((request) => request.authorization === token)).toBe(
        true,
      );
      await session.logout();
      requests.length = 0;
      setToken(expired, "failed-session");
      onReload = () => {
        reloads++;
      };
      expect(await session.signedIn()).toBe(false);
      expect(requests).toEqual([]);
      expect(reloads).toBe(2);
    } finally {
      onReload = () => {};
      await session.logout();
    }
  },
  60_000,
);
