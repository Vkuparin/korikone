import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { chooseModel } from "./models";
import type { Storage } from "../application/service";
import {
  authorization,
  callback,
  completedText,
  issuer,
  resource,
  responseRequest,
} from "./protocol";
type Encryption = {
  encrypt: (text: string) => string;
  decrypt: (text: string) => string;
};
type Connection = {
  clientId: string;
  subject: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
};
export type AIStatus = {
  state:
    "disconnected" | "waiting" | "connected" | "permissionMissing" | "error";
  email: string;
  error: string | null;
  models: { slug: string; name: string }[];
};
const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
export class ChatGPT {
  private connection: Connection | null = null;
  private registration: { clientId: string; subject?: string } | null = null;
  private host = "";
  private server: Server | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private refreshing: Promise<void> | null = null;
  private request: AbortController | null = null;
  private publicState: AIStatus = {
    state: "disconnected",
    email: "",
    error: null,
    models: [],
  };
  constructor(
    private db: Storage,
    private encryption: Encryption,
    private open: (url: string) => Promise<void>,
  ) {}
  async init() {
    this.host =
      (await this.db.get("chatgpt-host")) ?? `urn:uuid:${randomUUID()}`;
    await this.db.set("chatgpt-host", this.host);
    this.registration = await this.db.get("chatgpt-registration");
    const encrypted = await this.db.get("chatgpt-credentials");
    if (encrypted) {
      try {
        this.connection = JSON.parse(this.encryption.decrypt(encrypted));
        this.connectedStatus();
      } catch {
        this.publicState.error = "credentialUnavailable";
      }
    }
  }
  status(): AIStatus {
    return structuredClone(this.publicState);
  }
  private connectedStatus() {
    const c = this.connection!;
    this.publicState = {
      state: c.scopes.includes("chatgpt.tokens.use.direct")
        ? "connected"
        : "permissionMissing",
      email: c.email,
      error: null,
      models: [],
    };
  }
  private async store(connection: Connection) {
    await this.db.set(
      "chatgpt-credentials",
      this.encryption.encrypt(JSON.stringify(connection)),
    );
    this.connection = connection;
  }
  cancel() {
    this.attempt++;
    this.server?.close();
    this.server = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.publicState.state === "waiting")
      this.publicState.state = this.connection ? "connected" : "disconnected";
  }
  async signIn() {
    this.cancel();
    this.request?.abort();
    const attempt = this.attempt;
    const server = createServer();
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("authFailed");
    const redirect = `http://127.0.0.1:${address.port}/auth/callback`;
    const pending = authorization(
      this.host,
      redirect,
      this.registration?.clientId,
    );
    this.publicState = { ...this.publicState, state: "waiting", error: null };
    let consumed = false;
    server.on("request", async (req, res) => {
      const url = new URL(req.url ?? "/", redirect);
      if (req.method !== "GET" || url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }
      if (consumed || attempt !== this.attempt) {
        res.writeHead(409).end("This sign-in attempt is no longer active.");
        return;
      }
      if (url.searchParams.get("state") !== pending.state) {
        res.writeHead(400).end("Invalid sign-in state.");
        return;
      }
      consumed = true;
      try {
        const { clientId, code } = callback(
          url.searchParams,
          pending.state,
          this.registration?.clientId,
        );
        this.registration = { ...this.registration, clientId };
        await this.db.set("chatgpt-registration", this.registration);
        const tokens = await this.exchange(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            code_verifier: pending.verifier,
            redirect_uri: redirect,
            resource,
          }),
        );
        if (!tokens.id_token) throw new Error("authFailed");
        const { payload } = await jwtVerify(tokens.id_token, jwks, {
          issuer,
          audience: clientId,
          algorithms: ["RS256"],
        });
        if (payload.nonce !== pending.nonce || !payload.sub)
          throw new Error("invalidCallback");
        if (
          this.registration.subject &&
          this.registration.subject !== payload.sub
        )
          throw new Error("accountChanged");
        if (attempt !== this.attempt) throw new Error("cancelled");
        this.registration = { clientId, subject: payload.sub };
        await this.db.set("chatgpt-registration", this.registration);
        if (attempt !== this.attempt) throw new Error("cancelled");
        await this.store({
          clientId,
          subject: payload.sub,
          email:
            typeof payload.email === "string" ? payload.email : payload.sub,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? "",
          idToken: tokens.id_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scopes: (tokens.scope ?? "").split(" "),
        });
        if (attempt !== this.attempt) {
          this.connection = null;
          await this.db.set("chatgpt-credentials", null);
          throw new Error("cancelled");
        }
        this.connectedStatus();
        res
          .writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          })
          .end(
            "Kirjautuminen valmis. Voit palata Korikoneeseen. Sign-in complete. Return to Korikone.",
          );
      } catch (error) {
        this.publicState = {
          ...this.publicState,
          state: "error",
          error:
            error instanceof Error && /^[a-zA-Z]+$/.test(error.message)
              ? error.message
              : "authFailed",
        };
        res
          .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Sign-in did not complete. Return to Korikone to try again.");
      } finally {
        server.close();
        if (this.timer) clearTimeout(this.timer);
        if (this.server === server) this.server = null;
      }
    });
    this.timer = setTimeout(
      () => {
        this.cancel();
        this.publicState = {
          ...this.publicState,
          state: "error",
          error: "authTimeout",
        };
      },
      5 * 60 * 1000,
    );
    try {
      await this.open(pending.url);
    } catch {
      this.cancel();
      throw new Error("authFailed");
    }
  }
  private async exchange(body: URLSearchParams) {
    const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("authFailed");
    return tokenSchema.parse(await response.json());
  }
  private async access(): Promise<string> {
    if (!this.connection) throw new Error("notConnected");
    if (this.connection.expiresAt < Date.now() + 60000) {
      if (!this.refreshing)
        this.refreshing = (async () => {
          const c = this.connection!;
          if (!c.refreshToken) throw new Error("authFailed");
          const tokens = await this.exchange(
            new URLSearchParams({
              grant_type: "refresh_token",
              client_id: c.clientId,
              refresh_token: c.refreshToken,
              resource,
            }),
          );
          if (this.connection !== c) throw new Error("accountChanged");
          if (tokens.id_token) {
            const { payload } = await jwtVerify(tokens.id_token, jwks, {
              issuer,
              audience: c.clientId,
              algorithms: ["RS256"],
            });
            if (payload.sub !== c.subject) throw new Error("accountChanged");
          }
          await this.store({
            ...c,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? c.refreshToken,
            idToken: tokens.id_token ?? c.idToken,
            scopes: tokens.scope?.split(" ") ?? c.scopes,
            expiresAt: Date.now() + tokens.expires_in * 1000,
          });
        })().finally(() => {
          this.refreshing = null;
        });
      await this.refreshing;
    }
    if (!this.connection!.scopes.includes("chatgpt.tokens.use.direct"))
      throw new Error("permissionMissing");
    return this.connection!.accessToken;
  }
  async models(signal?: AbortSignal) {
    const token = await this.access();
    const response = await fetch(`${resource}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("modelsUnavailable");
    const result = z
      .object({
        models: z.array(
          z.object({
            slug: z.string(),
            display_name: z.string(),
            visibility: z.string(),
          }),
        ),
      })
      .parse(await response.json());
    this.publicState.models = result.models
      .filter((m) => m.visibility === "list")
      .map((m) => ({ slug: m.slug, name: m.display_name }));
    return this.publicState.models;
  }
  cancelRequest() {
    this.request?.abort();
  }
  async generate(model: string, input: string) {
    if (this.request) throw new Error("busy");
    const controller = new AbortController();
    this.request = controller;
    try {
      model = chooseModel(await this.models(controller.signal), model);
      controller.signal.throwIfAborted();
      const token = await this.access();
      const response = await fetch(`${resource}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(responseRequest(model, input)),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(180000),
        ]),
      });
      if (response.status === 429) throw new Error("usageLimit");
      if (!response.ok || !response.body) throw new Error("aiFailed");
      return await completedText(response.body, controller.signal);
    } finally {
      this.request = null;
    }
  }
  async signOut() {
    this.cancel();
    this.cancelRequest();
    const c = this.connection;
    this.connection = null;
    let error: string | null = null;
    if (c?.refreshToken)
      try {
        const response = await fetch(`${issuer}/api/accounts/oauth/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: c.refreshToken,
            token_type_hint: "refresh_token",
            client_id: c.clientId,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) error = "revocationUnconfirmed";
      } catch {
        error = "revocationUnconfirmed";
      }
    await this.db.set("chatgpt-credentials", null);
    this.publicState = { state: "disconnected", email: "", error, models: [] };
  }
}
