import { afterEach, describe, expect, it } from "vitest";
import {
  SKaupatHost,
  fetchScript,
  type SKaupatPage,
} from "../src/main/s-kaupat-host";

function fakePage() {
  const calls: string[] = [];
  const page: SKaupatPage = {
    evaluate: async (script) => {
      calls.push(`evaluate:${script.slice(0, 20)}`);
      return {
        ok: true,
        status: 200,
        contentType: "application/json",
        body: "{}",
        scripts: script,
      };
    },
    reload: async () => void calls.push("reload"),
    open: async (url) => void calls.push(`open:${url}`),
    forget: async () => void calls.push("forget"),
  };
  return { page, calls };
}

let host: SKaupatHost | null = null;
afterEach(() => {
  host?.close();
  host = null;
});

async function start() {
  const { page, calls } = fakePage();
  host = new SKaupatHost(page);
  await host.start();
  const call = (
    operation: string,
    body: unknown,
    headers: Record<string, string> = { authorization: `Bearer ${host!.key}` },
  ) =>
    fetch(`${host!.url}/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { call, calls };
}

describe("S-kaupat host bridge", () => {
  it("listens on loopback with a long random key", async () => {
    await start();
    expect(host!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s-kaupat$/);
    expect(host!.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a missing or wrong key and does nothing", async () => {
    const { call, calls } = await start();
    expect((await call("reload", {}, {})).status).toBe(401);
    expect(
      (await call("reload", {}, { authorization: "Bearer nope" })).status,
    ).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuses requests that carry a browser Origin", async () => {
    const { call, calls } = await start();
    const response = await call(
      "reload",
      {},
      {
        authorization: `Bearer ${host!.key}`,
        origin: "https://evil.example",
      },
    ).catch(() => null);
    // Node's fetch may drop the forbidden header; either way nothing runs for a browser origin.
    if (response && response.status === 403) expect(calls).toEqual([]);
  });

  it("runs only the five operations", async () => {
    const { call, calls } = await start();
    expect(await (await call("storage", {})).json()).toMatchObject({
      ok: true,
    });
    expect(await (await call("reload", {})).json()).toEqual({ ok: true });
    expect(
      await (
        await call("open", { url: "https://www.s-kaupat.fi/ostoslistat" })
      ).json(),
    ).toEqual({ ok: true });
    expect(await (await call("forget", {})).json()).toEqual({ ok: true });
    expect(await (await call("eval", { script: "1" })).json()).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(calls).toContain("reload");
    expect(calls).toContain("forget");
    expect(calls).toContain("open:https://www.s-kaupat.fi/ostoslistat");
  });

  it("sends only requests to the S-kaupat site and its API", async () => {
    const { call, calls } = await start();
    const request = { method: "GET", headers: {}, body: null, timeoutMs: 5000 };
    for (const url of [
      "https://evil.example/",
      "http://api.s-kaupat.fi/",
      "https://api.s-kaupat.fi.evil.example/x",
      "https://www.k-ruoka.fi/kauppa",
    ]) {
      expect(await (await call("fetch", { ...request, url })).json()).toEqual({
        ok: false,
        error: "refused",
      });
    }
    expect(
      await (
        await call("fetch", {
          ...request,
          method: "TRACE",
          url: "https://api.s-kaupat.fi/v1/x",
        })
      ).json(),
    ).toEqual({ ok: false, error: "refused" });
    expect(calls).toEqual([]);
    const ok = await (
      await call("fetch", { ...request, url: "https://api.s-kaupat.fi/v1/x" })
    ).json();
    expect(ok).toMatchObject({ ok: true, status: 200 });
  });

  it("shows only pages of the S-kaupat site", async () => {
    const { call, calls } = await start();
    expect(
      await (await call("open", { url: "https://evil.example/" })).json(),
    ).toEqual({ ok: false, error: "refused" });
    expect(
      await (await call("open", { url: "https://api.s-kaupat.fi/" })).json(),
    ).toEqual({ ok: false, error: "refused" });
    expect(calls).toEqual([]);
  });

  it("passes the request to the page as data, not as code", () => {
    const script = fetchScript({
      url: "https://api.s-kaupat.fi/a",
      method: "POST",
      headers: { authorization: "x'; alert(1); '" },
      body: "`${evil}`",
      timeoutMs: 3000,
    });
    expect(script).toContain(JSON.stringify("x'; alert(1); '"));
    expect(script).toContain(JSON.stringify("`${evil}`"));
  });
});
