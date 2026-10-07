import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
const client = new Client({
  name: "korikone-contract-check",
  version: "0.1.0",
});
await client.connect(
  new StdioClientTransport({
    command: resolve("vendor/k-ruoka/k-ruoka-mcp.exe"),
    args: ["serve"],
    stderr: "pipe",
  }),
);
try {
  console.log(
    JSON.stringify(
      {
        server: client.getServerVersion(),
        tools: (await client.listTools()).tools,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
