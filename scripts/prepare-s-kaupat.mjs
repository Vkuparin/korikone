import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
// Pinned s-kaupat-mcp release. Update together with src/stores/s-kaupat.ts.
const version = "1.1.0";
const files = {
  "s-kaupat-mcp.cjs": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/s-kaupat-mcp.cjs`,
    "49093b6cfc48723c07a8270ee7c8d2e920f6ed86e6730121c1686537e7966ade",
  ],
  "tools.json": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/tools.json`,
    "e5e221f56b30a3b90515797c514792b7852fff73af1e16ac4f62d457a6fd46da",
  ],
  LICENSE: [
    `https://raw.githubusercontent.com/Vkuparin/s-kaupat-mcp/v${version}/LICENSE`,
    "9ec87395cec695799e062423d534579791f2c9b054c124e94f88477c676732eb",
  ],
};
const directory = resolve("vendor/s-kaupat");
await mkdir(directory, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [name, [url, expected]] of Object.entries(files)) {
  const target = resolve(directory, name);
  try {
    if (sha(await readFile(target)) === expected) continue;
  } catch {
    /* Not downloaded yet. */
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name} download: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== expected) throw new Error(`${name} checksum mismatch`);
  await writeFile(target, bytes);
}
console.log(`Prepared s-kaupat-mcp ${version} (verified release files).`);
