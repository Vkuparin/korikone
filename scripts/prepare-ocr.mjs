import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const folder = new URL("../vendor/ocr/", import.meta.url);
const source = JSON.parse(
  await readFile(new URL("source.json", folder), "utf8"),
);
const model = new URL("fin.traineddata", folder);
const valid = (bytes) =>
  bytes.length === source.bytes &&
  createHash("sha256").update(bytes).digest("hex") === source.sha256;
try {
  const existing = await readFile(model);
  if (!valid(existing))
    throw new Error(
      "Bundled Finnish OCR model failed checksum; remove it and prepare again.",
    );
  console.log("Finnish OCR model checksum verified.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  // Build preparation only. Application workers never fetch assets.
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`OCR model download failed: ${response.status}`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > source.bytes)
      throw new Error("OCR model download exceeds pinned size");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (!valid(data)) throw new Error("OCR model download failed checksum");
  await mkdir(folder, { recursive: true });
  const temporary = fileURLToPath(new URL("fin.traineddata.partial", folder));
  await writeFile(temporary, data);
  await rename(temporary, model);
  console.log("Pinned Finnish OCR model prepared for offline use.");
}
