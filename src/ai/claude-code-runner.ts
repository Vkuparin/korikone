import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ClaudeRun, ClaudeRunner } from "./claude-code";

/** How to start the installed Claude Code: a native binary, or the npm package's script under Node. */
export type ClaudeCommand = {
  file: string;
  prefix: string[];
  env: NodeJS.ProcessEnv;
};

const where = (name: string) =>
  new Promise<string[]>((resolve) =>
    execFile(
      process.platform === "win32" ? "where.exe" : "which",
      [name],
      { windowsHide: true, timeout: 10000 },
      (error, stdout) =>
        resolve(
          error
            ? []
            : stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
        ),
    ),
  );

/**
 * Finds the user's Claude Code. Windows `.cmd` shims cannot take an empty argument without a
 * shell, so for an npm install the package's own binary or script is started directly.
 */
export async function findClaudeCode(
  nodeBinary = process.execPath,
): Promise<ClaudeCommand | null> {
  const env = { ...process.env };
  if (process.platform !== "win32") {
    const found = await where("claude");
    return found[0] ? { file: found[0], prefix: [], env } : null;
  }
  const candidates = [
    join(homedir(), ".local", "bin", "claude.exe"),
    ...(await where("claude")),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (/\.exe$/i.test(candidate)) return { file: candidate, prefix: [], env };
    if (/\.cmd$/i.test(candidate)) {
      const pkg = join(
        dirname(candidate),
        "node_modules",
        "@anthropic-ai",
        "claude-code",
      );
      const binary = join(pkg, "bin", "claude.exe");
      if (existsSync(binary)) return { file: binary, prefix: [], env };
      const script = join(pkg, "cli.js");
      if (existsSync(script))
        return {
          file: nodeBinary,
          prefix: [script],
          env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
        };
    }
  }
  return null;
}

/** Runs Claude Code in an empty folder so no project instructions or settings are picked up. */
export function claudeCodeRunner(workDir: string): ClaudeRunner {
  let command: Promise<ClaudeCommand | null> | null = null;
  return async (args, input, signal): Promise<ClaudeRun> => {
    command ??= findClaudeCode();
    const found = await command;
    if (!found) {
      command = null;
      return { code: null, stdout: "", stderr: "", missing: true };
    }
    await mkdir(workDir, { recursive: true });
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(found.file, [...found.prefix, ...args], {
        cwd: workDir,
        env: found.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        signal,
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < 2_000_000) stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 20_000) stderr += chunk;
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") command = null;
        resolve({
          code: null,
          stdout,
          stderr,
          missing: error.code === "ENOENT",
        });
      });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.on("error", () => {});
      child.stdin.end(input, "utf8");
    });
  };
}

/** A terminal running `claude auth login`, so sign-in completes in Anthropic's own flow. */
export async function openClaudeLogin(
  workDir: string,
  open: (path: string) => Promise<string>,
) {
  const found = await findClaudeCode();
  if (!found) throw new Error("claudeCodeMissing");
  await mkdir(workDir, { recursive: true });
  if (process.platform !== "win32") throw new Error("claudeCodeFailed");
  const quote = (value: string) => `"${value.replace(/"/g, "")}"`;
  const script = join(workDir, "claude-sign-in.cmd");
  await writeFile(
    script,
    [
      "@echo off",
      "title Claude Code sign-in",
      ...(found.env.ELECTRON_RUN_AS_NODE ? ["set ELECTRON_RUN_AS_NODE=1"] : []),
      [found.file, ...found.prefix].map(quote).join(" ") + " auth login",
      "echo.",
      "echo You can close this window and return to Korikone.",
      "pause",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const error = await open(script);
  if (error) throw new Error("claudeCodeFailed");
}
