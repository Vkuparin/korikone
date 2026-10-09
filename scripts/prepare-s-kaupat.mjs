import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
// Pinned s-kaupat-mcp release. Update together with src/stores/s-kaupat.ts.
const version = "1.3.0";
const files = {
  "s-kaupat-mcp-1.3.0.tgz": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/s-kaupat-mcp-${version}.tgz`,
    "0fa73e9952aa0c944d753da677a5a5c4aef34aa1bb0cfd4a33f605fe4cca6d77",
  ],
  "s-kaupat-mcp.cjs": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/s-kaupat-mcp.cjs`,
    "ebbeb08f1904c33e69c90304ef394b863f3a0235b059929f4e917742f4c72cdd",
  ],
  "tools.json": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/tools.json`,
    "33b2d52fbf029dccfc026fd02b84a0faf936b5b7542f95ae851130e6e04d6aaa",
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
