import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
// Pinned s-kaupat-mcp release. Update together with src/stores/s-kaupat.ts.
const version = "1.0.0";
const files = {
  "s-kaupat-mcp.cjs": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/s-kaupat-mcp.cjs`,
    "887d21f9c55878bb52fe257700ad35fc43a64a17105aad0ef2db588025705bb6",
  ],
  "tools.json": [
    `https://github.com/Vkuparin/s-kaupat-mcp/releases/download/v${version}/tools.json`,
    "463963f34ad19f23387d18b083e9a590a69622569a9910fed8ae3e8e6be53f40",
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
