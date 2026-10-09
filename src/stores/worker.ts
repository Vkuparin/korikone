import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
const kRuokaTools = [
  "search_stores",
  "search_products",
  "get_cart",
  "auth_status",
  "start_login",
  "login_status",
  "cancel_login",
  "add_to_cart",
  "update_cart_item",
];
export type WorkerOptions = {
  command: string;
  script?: string;
  args: string[];
  env: Record<string, string>;
  checksum: string;
  version: string;
  tools: string[];
  errors?: (result: unknown) => Error | null;
  schemaVersion?: string;
};
function environment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (p): p is [string, string] => typeof p[1] === "string",
    ),
  );
}
/** A pinned stdio MCP worker: checksum, version and tool list are verified before any call. */
export class McpWorker {
  private client: Client | null = null;
  private connection: Promise<void> | null = null;
  private allowed: Set<string>;
  constructor(protected options: WorkerOptions) {
    this.allowed = new Set(options.tools);
  }
  protected async before() {}
  private async connect() {
    await this.before();
    if (this.client) return;
    if (this.connection) return this.connection;
    this.connection = (async () => {
      const file = this.options.script ?? this.options.command;
      if (!existsSync(file)) throw new Error("workerMissing");
      if (
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex") !== this.options.checksum
      )
        throw new Error("workerIncompatible");
      const client = new Client({ name: "korikone", version: "0.2.0-alpha.1" });
      const transport = new StdioClientTransport({
        command: this.options.command,
        args: this.options.script
          ? [this.options.script, ...this.options.args]
          : this.options.args,
        env: { ...environment(), ...this.options.env },
        stderr: "pipe",
      });
      // Do not persist raw worker logs: they can contain account data.
      transport.stderr?.on("data", () => {});
      try {
        await client.connect(transport);
        if (client.getServerVersion()?.version !== this.options.version)
          throw new Error("workerIncompatible");
        const tools = await client.listTools();
        if (
          [...this.allowed].some(
            (name) => !tools.tools.some((t) => t.name === name),
          )
        )
          throw new Error("workerIncompatible");
        this.client = client;
      } catch (error) {
        await client.close();
        throw error;
      }
    })();
    try {
      await this.connection;
    } finally {
      this.connection = null;
    }
  }
  async call(
    name: string,
    args: Record<string, unknown>,
    timeout = 90000,
  ): Promise<unknown> {
    if (!this.allowed.has(name)) throw new Error("unsupported");
    await this.connect();
    const result = await this.client!.callTool(
      { name, arguments: args },
      undefined,
      { timeout },
    );
    const data = result.structuredContent ?? this.parseText(result.content);
    if (result.isError)
      throw this.options.errors?.(data) ?? new Error("storeUnavailable");
    if (
      this.options.schemaVersion &&
      (data as { schemaVersion?: unknown } | null)?.schemaVersion !==
        this.options.schemaVersion
    )
      throw new Error("workerIncompatible");
    return data;
  }
  private parseText(content: unknown): unknown {
    const parts = z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .safeParse(content);
    if (!parts.success) return null;
    const text = parts.data
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async close() {
    const client = this.client;
    this.client = null;
    if (client) await client.close();
  }
}
export class KRuokaWorker extends McpWorker {
  private browser: ChildProcess | null = null;
  constructor(
    executable: string,
    private profile: string,
    private chrome: string | null,
  ) {
    super({
      command: executable,
      args: ["serve"],
      env: {
        K_RUOKA_PROFILE: profile,
        K_RUOKA_CHROME: chrome ?? "",
        K_RUOKA_MIN_REQUEST_INTERVAL_MS: "700",
      },
      checksum:
        "6b662fbe702dfea353689c7f7042c53a417f426e58e255d33aedb44f52392f2d",
      version: "0.1.3",
      tools: kRuokaTools,
    });
  }
  protected async before() {
    if (this.browser) throw new Error("closeStoreWindow");
    if (!this.chrome) throw new Error("chromeRequired");
  }
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const data = await super.call(name, args);
    if (data === null) throw new Error("workerIncompatible");
    return data;
  }
  async handoff() {
    if (!this.chrome) throw new Error("chromeRequired");
    await this.close();
    this.browser = spawn(
      this.chrome,
      [
        `--user-data-dir=${this.profile}`,
        "--new-window",
        "https://www.k-ruoka.fi/kauppa/ostoskori",
      ],
      { stdio: "ignore", windowsHide: false },
    );
    this.browser.once("exit", () => {
      this.browser = null;
    });
    this.browser.once("error", () => {
      this.browser = null;
    });
  }
}
export function findChrome(): string | null {
  const paths = [
    join(
      process.env.PROGRAMFILES ?? "C:/Program Files",
      "Google/Chrome/Application/chrome.exe",
    ),
    join(
      process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)",
      "Google/Chrome/Application/chrome.exe",
    ),
    join(
      process.env.LOCALAPPDATA ?? "",
      "Google/Chrome/Application/chrome.exe",
    ),
  ];
  return paths.find(existsSync) ?? null;
}
