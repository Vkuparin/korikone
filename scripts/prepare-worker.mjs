import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const directory = resolve("vendor/k-ruoka");
await mkdir(directory, { recursive: true });
const url =
  "https://github.com/nikosavola/k-ruoka-mcp/releases/download/v0.1.3/k_ruoka_mcp-0.1.3-py3-none-win_amd64.whl";
const expected =
  "2bda8fd257286da6554b65375d0fa878211ffc8b48f13e5c6d2d1365276c09db";
const zip = resolve(directory, "worker.zip");
let bytes;
try {
  bytes = await readFile(zip);
} catch {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Worker download: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(bytes).digest("hex") !== expected)
  throw new Error("Worker checksum mismatch");
await writeFile(zip, bytes);
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${resolve(directory, "unpacked").replaceAll("'", "''")}' -Force`,
  ],
  { windowsHide: true },
);
await copyFile(
  resolve(directory, "unpacked/k_ruoka_mcp-0.1.3.data/scripts/k-ruoka-mcp.exe"),
  resolve(directory, "k-ruoka-mcp.exe"),
);
await copyFile(
  resolve(directory, "unpacked/k_ruoka_mcp-0.1.3.dist-info/licenses/LICENSE"),
  resolve(directory, "LICENSE"),
);
console.log("Prepared k-ruoka-mcp 0.1.3 (verified Windows wheel).");
