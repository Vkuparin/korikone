import { z } from "zod";
import type { AIStatus } from "./connection";
import type { Storage } from "../application/service";

/**
 * Claude through the user's own, unmodified Claude Code CLI (`claude -p`).
 *
 * Anthropic does not let apps sign in to claude.ai or hold plan credentials, so Korikone never
 * sees a token: the user signs in to Claude Code through its own flow, and Korikone runs the
 * installed binary with no tools, no MCP servers, no settings, no session files and its own short
 * system prompt. Requests draw from the user's Claude plan limits as Claude Code reports them.
 */
export type ClaudeRun = {
  /** null when the process was killed or the binary was not found. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The binary is not installed or cannot be started. */
  missing?: boolean;
};
export type ClaudeRunner = (
  args: string[],
  input: string,
  signal: AbortSignal,
) => Promise<ClaudeRun>;

export const CLAUDE_CODE_SYSTEM_PROMPT =
  "You are the text generator inside Korikone, a grocery and meal planning app. Follow the user's instructions exactly and reply only with the requested output. You have no tools.";

/** Claude Code accepts these aliases and resolves each to the latest model of that size. */
export const claudeCodeModels = [
  { slug: "haiku", name: "Claude Haiku" },
  { slug: "sonnet", name: "Claude Sonnet" },
  { slug: "opus", name: "Claude Opus" },
] as const;

export function claudeCodeArgs(model: string) {
  if (!claudeCodeModels.some((m) => m.slug === model))
    throw new Error("modelUnavailable");
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--system-prompt",
    CLAUDE_CODE_SYSTEM_PROMPT,
  ];
}

const resultSchema = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  api_error_status: z.number().nullable().optional(),
});
const authSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  email: z.string().optional(),
  subscriptionType: z.string().nullable().optional(),
});

const signedOutText =
  /not logged in|please run \/login|\/login|log ?in again|invalid api key|oauth token|authenticat/i;
const limitText =
  /usage limit|limit reached|rate limit|limit will reset|out of (?:extra )?usage|credit balance/i;

/** One `claude -p --output-format json` run to text or a public error code. */
export function claudeCodeText(run: ClaudeRun): string {
  if (run.missing) throw new Error("claudeCodeMissing");
  let parsed: z.infer<typeof resultSchema> | null = null;
  try {
    parsed = resultSchema.parse(JSON.parse(run.stdout.trim()));
  } catch {
    parsed = null;
  }
  const message = `${parsed?.result ?? ""}\n${run.stderr}`;
  if (!parsed || parsed.is_error || parsed.subtype !== "success") {
    if (parsed?.api_error_status === 429 || limitText.test(message))
      throw new Error("usageLimit");
    if (parsed?.api_error_status === 401 || signedOutText.test(message))
      throw new Error("notConnected");
    throw new Error("aiFailed");
  }
  if (typeof parsed.result !== "string") throw new Error("incompleteDraft");
  if (parsed.result.length > 100_000) throw new Error("invalidDraft");
  return parsed.result;
}

const POLL_MS = 3000;
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export class ClaudeCode {
  private request: AbortController | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private publicState: AIStatus = {
    state: "disconnected",
    email: "",
    error: null,
    models: [],
  };
  constructor(
    private db: Storage,
    private run: ClaudeRunner,
    /** Opens a terminal that runs `claude auth login`: Anthropic's own sign-in flow. */
    private openLogin: () => Promise<void>,
  ) {}
  async init() {
    if ((await this.db.get("claude-code-connected")) === true)
      this.publicState = {
        state: "connected",
        email: (await this.db.get("claude-code-account")) ?? "",
        error: null,
        models: [],
      };
  }
  status(): AIStatus {
    return structuredClone(this.publicState);
  }
  /** Signed in to Claude Code, by its own report. Never reads a credential. */
  private async account(
    signal: AbortSignal,
  ): Promise<{ loggedIn: boolean; label: string }> {
    const run = await this.run(["auth", "status", "--json"], "", signal);
    if (run.missing) throw new Error("claudeCodeMissing");
    try {
      const status = authSchema.parse(JSON.parse(run.stdout.trim()));
      const plan = status.subscriptionType
        ? `Claude ${status.subscriptionType[0].toUpperCase()}${status.subscriptionType.slice(1)}`
        : "";
      return {
        loggedIn: status.loggedIn,
        label: status.email ?? plan,
      };
    } catch {
      // Older Claude Code without JSON status: a non-zero exit means signed out.
      return { loggedIn: run.code === 0, label: "" };
    }
  }
  private async connect(label: string) {
    await this.db.set("claude-code-connected", true);
    await this.db.set("claude-code-account", label);
    this.publicState = {
      state: "connected",
      email: label,
      error: null,
      models: [],
    };
  }
  cancel() {
    this.attempt++;
    if (this.poll) clearInterval(this.poll);
    if (this.deadline) clearTimeout(this.deadline);
    this.poll = null;
    this.deadline = null;
    if (this.publicState.state === "waiting")
      this.publicState = { ...this.publicState, state: "disconnected" };
  }
  async signIn() {
    this.cancel();
    const attempt = this.attempt;
    try {
      const account = await this.account(AbortSignal.timeout(30000));
      if (account.loggedIn) return this.connect(account.label);
    } catch (error) {
      this.publicState = {
        ...this.publicState,
        state: "error",
        error:
          error instanceof Error && error.message === "claudeCodeMissing"
            ? "claudeCodeMissing"
            : "claudeCodeFailed",
      };
      return;
    }
    this.publicState = { ...this.publicState, state: "waiting", error: null };
    try {
      await this.openLogin();
    } catch {
      this.cancel();
      this.publicState = {
        ...this.publicState,
        state: "error",
        error: "claudeCodeFailed",
      };
      return;
    }
    let checking = false;
    this.poll = setInterval(async () => {
      if (checking || attempt !== this.attempt) return;
      checking = true;
      try {
        const account = await this.account(AbortSignal.timeout(20000));
        if (account.loggedIn && attempt === this.attempt) {
          this.cancel();
          await this.connect(account.label);
        }
      } catch {
        // Keep waiting until the deadline; the terminal may still be open.
      } finally {
        checking = false;
      }
    }, POLL_MS);
    this.deadline = setTimeout(() => {
      this.cancel();
      this.publicState = {
        ...this.publicState,
        state: "error",
        error: "authTimeout",
      };
    }, SIGN_IN_TIMEOUT_MS);
  }
  /** Disconnects Korikone only. Claude Code stays signed in for the user's own use. */
  async signOut() {
    this.cancel();
    this.cancelRequest();
    await this.db.set("claude-code-connected", false);
    await this.db.set("claude-code-account", null);
    this.publicState = {
      state: "disconnected",
      email: "",
      error: null,
      models: [],
    };
  }
  cancelRequest() {
    this.request?.abort();
  }
  async models(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.publicState.state !== "connected") throw new Error("notConnected");
    this.publicState.models = claudeCodeModels.map((m) => ({ ...m }));
    return this.publicState.models;
  }
  async generatePinned(model: string, input: string, signal: AbortSignal) {
    if (this.publicState.state !== "connected") throw new Error("notConnected");
    const args = claudeCodeArgs(model);
    if (this.request) throw new Error("busy");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) controller.abort();
    this.request = controller;
    try {
      controller.signal.throwIfAborted();
      const run = await this.run(
        args,
        input,
        AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
      );
      if (controller.signal.aborted) throw new Error("cancelled");
      try {
        return claudeCodeText(run);
      } catch (error) {
        if (error instanceof Error && error.message === "notConnected") {
          await this.db.set("claude-code-connected", false);
          this.publicState = {
            state: "disconnected",
            email: "",
            error: "claudeCodeSignedOut",
            models: [],
          };
        }
        throw error;
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      this.request = null;
    }
  }
}
