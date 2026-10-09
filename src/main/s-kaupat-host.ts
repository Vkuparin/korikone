import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** What the S-kaupat tab's session can do for the server; the bridge never passes script through. */
export interface SKaupatPage {
  evaluate(script: string): Promise<unknown>;
  reload(): Promise<void>;
  open(url: string): Promise<void>;
  forget(): Promise<void>;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const API = /^https:\/\/(api|www)\.s-kaupat\.fi\//;
const MAX_BODY = 1_000_000;

/** The one script that runs a request in the page. The request is passed as data, never as code. */
export const fetchScript = (request: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
}) =>
  `(async (r) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), r.timeoutMs);
    try {
      const response = await fetch(r.url, {
        method: r.method,
        headers: r.headers,
        body: r.body === null ? undefined : r.body,
        signal: controller.signal,
      });
      return {
        ok: true,
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: await response.text(),
      };
    } catch (error) {
      return {
        ok: false,
        error: controller.signal.aborted
          ? "timed out"
          : navigator.onLine
            ? String((error && error.message) || error)
            : "offline",
      };
    } finally {
      clearTimeout(timer);
    }
  })(${JSON.stringify(request)})`;

const storageScript = `(() => ({
  ok: true,
  entries: Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
  path: location.pathname,
}))()`;

/**
 * The local endpoint s-kaupat-mcp's host transport talks to (its docs/host-page.md). The server
 * then runs no browser: its calls go out from the signed-in S-kaupat tab's session, and the login
 * is the one the shopper made there. Only five fixed operations exist. Every request needs the
 * random key, comes from a plain (non-browser) client on 127.0.0.1, and may reach only the
 * S-kaupat site and its API. The key and the page's storage are never logged.
 */
export class SKaupatHost {
  readonly key = randomBytes(32).toString("hex");
  private server: Server | null = null;
  private port = 0;

  constructor(private page: SKaupatPage) {}

  get url() {
    return `http://127.0.0.1:${this.port}/s-kaupat`;
  }

  async start() {
    if (this.server) return;
    const server = createServer((request, response) => {
      const send = (status: number, body: unknown) =>
        response
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify(body));
      // A web page cannot ask: browsers add Origin, and a rebinding page has the wrong Host.
      if (
        request.headers.origin ||
        request.headers.host !== `127.0.0.1:${this.port}` ||
        request.method !== "POST"
      )
        return send(403, { ok: false, error: "refused" });
      const given = Buffer.from(
        (request.headers.authorization ?? "").replace(/^Bearer /, ""),
      );
      const expected = Buffer.from(this.key);
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return send(401, { ok: false, error: "key" });
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) request.destroy();
        else chunks.push(chunk);
      });
      request.on("end", () => {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          return send(400, { ok: false, error: "json" });
        }
        const operation = (request.url ?? "").replace(/^\/s-kaupat\//, "");
        this.handle(operation, body).then(
          (answer) => send(200, answer),
          (error) =>
            send(200, {
              ok: false,
              error: error instanceof Error ? error.message : "failed",
            }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
    this.server = server;
  }

  async handle(operation: string, input: unknown): Promise<unknown> {
    const body = (input ?? {}) as Record<string, unknown>;
    if (operation === "fetch") {
      const { url, method, headers, timeoutMs } = body;
      if (
        typeof url !== "string" ||
        !API.test(url) ||
        typeof method !== "string" ||
        !METHODS.includes(method) ||
        typeof timeoutMs !== "number"
      )
        return { ok: false, error: "refused" };
      const safe: Record<string, string> = {};
      for (const [name, value] of Object.entries(
        (headers as Record<string, unknown>) ?? {},
      ))
        if (typeof value === "string") safe[name] = value;
      return this.page.evaluate(
        fetchScript({
          url,
          method,
          headers: safe,
          body: typeof body.body === "string" ? body.body : null,
          timeoutMs: Math.min(Math.max(timeoutMs, 1000), 120_000),
        }),
      );
    }
    if (operation === "storage") return this.page.evaluate(storageScript);
    if (operation === "reload") {
      await this.page.reload();
      return { ok: true };
    }
    if (operation === "open") {
      if (
        typeof body.url !== "string" ||
        !/^https:\/\/www\.s-kaupat\.fi\//.test(body.url)
      )
        return { ok: false, error: "refused" };
      await this.page.open(body.url);
      return { ok: true };
    }
    if (operation === "forget") {
      await this.page.forget();
      return { ok: true };
    }
    return { ok: false, error: "unknown" };
  }

  close() {
    this.server?.close();
    this.server = null;
  }
}
