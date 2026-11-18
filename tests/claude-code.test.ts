import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeCode,
  claudeCodeArgs,
  claudeCodeText,
  type ClaudeRun,
  type ClaudeRunner,
} from "../src/ai/claude-code";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { chooseModel } from "../src/ai/models";
import { inferenceTasks } from "../src/ai/tasks";
import type { Storage } from "../src/application/service";

const memory = () => {
  const values = new Map<string, unknown>();
  return {
    values,
    db: {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: unknown) => void values.set(key, value),
    } as unknown as Storage,
  };
};
const result = (fields: Record<string, unknown>): ClaudeRun => ({
  code: fields.is_error ? 1 : 0,
  stdout: JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    api_error_status: null,
    ...fields,
  }),
  stderr: "",
});
const signedIn: ClaudeRun = {
  code: 0,
  stdout: JSON.stringify({ loggedIn: true, subscriptionType: "pro" }),
  stderr: "",
};
const signedOut: ClaudeRun = {
  code: 1,
  stdout: JSON.stringify({ loggedIn: false }),
  stderr: "",
};

async function connected(runner: ClaudeRunner) {
  const { db, values } = memory();
  const auth = vi.fn(runner);
  const claude = new ClaudeCode(db, auth, async () => {});
  values.set("claude-code-connected", true);
  await claude.init();
  return { claude, auth, values };
}

afterEach(() => vi.useRealTimers());

describe("Claude Code adapter", () => {
  it("runs the unmodified CLI with no tools, MCP servers, settings or saved session", () => {
    const args = claudeCodeArgs("haiku");
    expect(args.slice(0, 5)).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "haiku",
    ]);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--disable-slash-commands");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(() => claudeCodeArgs("opus; rm")).toThrow("modelUnavailable");
  });

  it("reads the result text and maps failures to the app's codes", () => {
    expect(claudeCodeText(result({ result: '{"ok":true}' }))).toBe(
      '{"ok":true}',
    );
    expect(() =>
      claudeCodeText(
        result({
          is_error: true,
          result: "Claude AI usage limit reached|1790000000",
        }),
      ),
    ).toThrow("usageLimit");
    expect(() =>
      claudeCodeText(
        result({ is_error: true, api_error_status: 429, result: "" }),
      ),
    ).toThrow("usageLimit");
    expect(() =>
      claudeCodeText(
        result({
          is_error: true,
          result: "Not logged in · Please run /login",
        }),
      ),
    ).toThrow("notConnected");
    expect(() =>
      claudeCodeText(result({ subtype: "error_during_execution" })),
    ).toThrow("aiFailed");
    expect(() =>
      claudeCodeText({ code: 1, stdout: "not json", stderr: "boom" }),
    ).toThrow("aiFailed");
    expect(() =>
      claudeCodeText({ code: null, stdout: "", stderr: "", missing: true }),
    ).toThrow("claudeCodeMissing");
  });

  it("sends the prompt on stdin and returns the reply", async () => {
    const { claude, auth } = await connected(async () =>
      result({ result: "reply" }),
    );
    await expect(
      claude.generatePinned(
        "sonnet",
        "make a list",
        new AbortController().signal,
      ),
    ).resolves.toBe("reply");
    expect(auth).toHaveBeenCalledTimes(1);
    expect(auth.mock.calls[0][0]).toEqual(claudeCodeArgs("sonnet"));
    expect(auth.mock.calls[0][1]).toBe("make a list");
  });

  it("disconnects when Claude Code reports a sign-out during a request", async () => {
    const { claude, values } = await connected(async () =>
      result({ is_error: true, result: "Invalid API key · Please run /login" }),
    );
    await expect(
      claude.generatePinned("haiku", "x", new AbortController().signal),
    ).rejects.toThrow("notConnected");
    expect(claude.status()).toMatchObject({
      state: "disconnected",
      error: "claudeCodeSignedOut",
    });
    expect(values.get("claude-code-connected")).toBe(false);
  });

  it("reports cancellation instead of a failure when the shopper cancels", async () => {
    const controller = new AbortController();
    const { claude } = await connected(
      (_args, _input, signal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () =>
            resolve({ code: null, stdout: "", stderr: "" }),
          ),
        ),
    );
    const pending = claude.generatePinned("haiku", "x", controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("refuses requests and catalogues until connected", async () => {
    const { db } = memory();
    const run = vi.fn<ClaudeRunner>();
    const claude = new ClaudeCode(db, run, async () => {});
    await claude.init();
    await expect(claude.models()).rejects.toThrow("notConnected");
    await expect(
      claude.generatePinned("haiku", "x", new AbortController().signal),
    ).rejects.toThrow("notConnected");
    expect(run).not.toHaveBeenCalled();
  });

  it("connects at once when Claude Code is already signed in", async () => {
    const { db, values } = memory();
    const openLogin = vi.fn(async () => {});
    const claude = new ClaudeCode(db, async () => signedIn, openLogin);
    await claude.signIn();
    expect(openLogin).not.toHaveBeenCalled();
    expect(claude.status()).toMatchObject({
      state: "connected",
      email: "Claude Pro",
    });
    expect(values.get("claude-code-connected")).toBe(true);
  });

  it("opens Claude Code's own sign-in and waits until it reports signed in", async () => {
    vi.useFakeTimers();
    const { db } = memory();
    let loggedIn = false;
    const openLogin = vi.fn(async () => {});
    const claude = new ClaudeCode(
      db,
      async () => (loggedIn ? signedIn : signedOut),
      openLogin,
    );
    await claude.signIn();
    expect(openLogin).toHaveBeenCalledTimes(1);
    expect(claude.status().state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(3000);
    expect(claude.status().state).toBe("waiting");
    loggedIn = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(claude.status().state).toBe("connected");
  });

  it("times out a sign-in nobody finishes", async () => {
    vi.useFakeTimers();
    const { db } = memory();
    const claude = new ClaudeCode(
      db,
      async () => signedOut,
      async () => {},
    );
    await claude.signIn();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(claude.status()).toMatchObject({
      state: "error",
      error: "authTimeout",
    });
  });

  it("says so when Claude Code is not installed", async () => {
    const { db } = memory();
    const openLogin = vi.fn(async () => {});
    const claude = new ClaudeCode(
      db,
      async () => ({ code: null, stdout: "", stderr: "", missing: true }),
      openLogin,
    );
    await claude.signIn();
    expect(claude.status()).toMatchObject({
      state: "error",
      error: "claudeCodeMissing",
    });
    expect(openLogin).not.toHaveBeenCalled();
  });

  it("disconnects Korikone only, without signing out of Claude Code", async () => {
    const { claude, auth, values } = await connected(async () => signedIn);
    await claude.signOut();
    expect(auth).not.toHaveBeenCalled();
    expect(claude.status().state).toBe("disconnected");
    expect(values.get("claude-code-connected")).toBe(false);
  });

  it("serves the shared tasks as its own provider, and Automatic picks Haiku", async () => {
    const { claude } = await connected(async () => result({ result: "ok" }));
    const provider = new ChatGPTInferenceProvider(claude, "claude-code");
    const models = await provider.discoverModels(new AbortController().signal);
    expect(models.map((m) => [m.providerId, m.modelId])).toEqual([
      ["claude-code", "haiku"],
      ["claude-code", "sonnet"],
      ["claude-code", "opus"],
    ]);
    expect(
      chooseModel(models.map((m) => ({ slug: m.modelId, name: m.name }))),
    ).toBe("haiku");
    await expect(
      provider.invoke(
        {
          task: inferenceTasks[0],
          model: { providerId: "claude-code", modelId: "haiku" },
          prompt: "x",
          output: { mode: "text" },
          maxOutputCharacters: 1000,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ text: "ok", completion: "complete" });
  });
});
