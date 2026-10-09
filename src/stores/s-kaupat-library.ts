import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRuntime, loadConfig, type SKaupatRuntime } from "s-kaupat-mcp";
import {
  S_KAUPAT_VERSION,
  S_KAUPAT_SCHEMA,
  S_KAUPAT_TOOLS,
  sKaupatError,
} from "./s-kaupat";

/** Uses the released client shared with standalone MCP, with Korikone's tool restrictions. */
export class SKaupatLibrary {
  private runtime: SKaupatRuntime | null = null;
  private client: Client | null = null;
  private starting: Promise<void> | null = null;

  constructor(
    private options: {
      dataDir: string;
      host?: { url: string; key: string };
      demo?: boolean;
    },
  ) {}

  private async start() {
    if (this.client) return;
    this.starting ??= (async () => {
      const { config } = loadConfig({
        env: {
          SKAUPAT_ORDERING: "false",
          SKAUPAT_LOGIN_SCOPE: "data-dir",
          ...(this.options.host
            ? { SKAUPAT_HOST_KEY: this.options.host.key }
            : {}),
        },
        argv: [
          "--data-dir",
          this.options.dataDir,
          ...(this.options.demo ? ["--demo"] : []),
          ...(this.options.host
            ? ["--transport", "host", "--host-url", this.options.host.url]
            : []),
        ],
      });
      const runtime = createRuntime(config);
      const client = new Client({ name: "korikone", version: "0.5.0" });
      const [local, remote] = InMemoryTransport.createLinkedPair();
      try {
        await Promise.all([
          runtime.createMcpServer().connect(remote),
          client.connect(local),
        ]);
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        if (
          client.getServerVersion()?.version !== S_KAUPAT_VERSION ||
          S_KAUPAT_TOOLS.some((name) => !names.includes(name))
        )
          throw new Error("workerIncompatible");
        this.runtime = runtime;
        this.client = client;
      } catch (error) {
        await client.close();
        await runtime.close();
        throw error;
      }
    })().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    timeout = 60_000,
  ): Promise<unknown> {
    if (!S_KAUPAT_TOOLS.includes(name)) throw new Error("unsupported");
    await this.start();
    const result = await this.client!.callTool(
      { name, arguments: args },
      undefined,
      { timeout },
    );
    const data = result.structuredContent;
    if (result.isError) throw sKaupatError(data);
    if (
      (data as { schemaVersion?: unknown } | undefined)?.schemaVersion !==
      S_KAUPAT_SCHEMA
    )
      throw new Error("workerIncompatible");
    return data;
  }

  async close() {
    await this.starting?.catch(() => {});
    const client = this.client;
    const runtime = this.runtime;
    this.client = null;
    this.runtime = null;
    await client?.close();
    await runtime?.close();
  }
}
