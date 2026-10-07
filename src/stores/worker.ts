import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
const allowed = new Set([
  "search_stores",
  "search_products",
  "get_cart",
  "auth_status",
  "start_login",
  "login_status",
  "cancel_login",
  "add_to_cart",
  "update_cart_item",
]);
export class KRuokaWorker {
  private client: Client | null = null;
  private connection: Promise<void> | null = null;
  private browser: ChildProcess | null = null;
  constructor(
    private executable: string,
    private profile: string,
    private chrome: string | null,
  ) {}
  private async connect() {
    if (this.browser) throw new Error("closeStoreWindow");
    if (this.client) return;
    if (this.connection) return this.connection;
    this.connection = (async () => {
      if (!this.chrome) throw new Error("chromeRequired");
      if (!existsSync(this.executable)) throw new Error("workerMissing");
      if (
        createHash("sha256")
          .update(await readFile(this.executable))
          .digest("hex") !==
        "6b662fbe702dfea353689c7f7042c53a417f426e58e255d33aedb44f52392f2d"
      )
        throw new Error("workerIncompatible");
      const client = new Client({ name: "korikone", version: "0.1.0" });
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (p): p is [string, string] => typeof p[1] === "string",
        ),
      );
      const transport = new StdioClientTransport({
        command: this.executable,
        args: ["serve"],
        env: {
          ...env,
          K_RUOKA_PROFILE: this.profile,
          K_RUOKA_CHROME: this.chrome,
          K_RUOKA_MIN_REQUEST_INTERVAL_MS: "700",
        },
        stderr: "pipe",
      });
      // Do not persist raw worker logs: they can contain account data.
      transport.stderr?.on("data", () => {});
      try {
        await client.connect(transport);
        if (client.getServerVersion()?.version !== "0.1.3")
          throw new Error("workerIncompatible");
        const tools = await client.listTools();
        if (
          [...allowed].some((name) => !tools.tools.some((t) => t.name === name))
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
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!allowed.has(name)) throw new Error("unsupported");
    await this.connect();
    const result = await this.client!.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 90000 },
    );
    if (result.isError) throw new Error("storeUnavailable");
    if (result.structuredContent) return result.structuredContent;
    const content = z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .parse(result.content);
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("workerIncompatible");
    }
  }
  async close() {
    const client = this.client;
    this.client = null;
    if (client) await client.close();
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
