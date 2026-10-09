import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
// Pinned s-kaupat-mcp release. Update together with src/stores/s-kaupat.ts.
const version = "1.2.0";
const files = {
  "s-kaupat-mcp.cjs": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/s-kaupat-mcp.cjs`,
    "17f973844c2216be3f51b7b272351025e5dd1dec0d209b1fce15fb8fd0fc032a",
  ],
  "tools.json": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/tools.json`,
    "a45d418363b3439cee9ddc1919ab2437d377db3e0395883c7f931c72b92461c4",
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
