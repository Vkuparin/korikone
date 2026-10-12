// F13.1 investigation only. OCR packages and language assets live under ignored scratch.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve("scratch/ocr-spike");
const candidate = createRequire(join(root, "package.json"));
const local = createRequire(resolve("package.json"));
const { createWorker } = candidate("tesseract.js");
const { createCanvas, DOMMatrix, ImageData, Path2D } = local("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
await build({
  entryPoints: ["src/receipts/parsers/index.ts"],
  outfile: join(root, "parser.mjs"),
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
});
const { parseReceipt } = await import(
  `file:///${join(root, "parser.mjs").replaceAll("\\", "/")}`
);
const fixtures = JSON.parse(
  await readFile("tests/fixtures/receipts/ocr-benchmark.json", "utf8"),
);
const normalize = (s) =>
  s.normalize("NFC").toLocaleLowerCase("fi").replace(/\s+/g, " ").trim();
function distance(a, b) {
  let prior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        prior[j] + 1,
        prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prior = row;
  }
  return prior[b.length];
}
async function files(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

const packageSizes = [];
const payload = [];
for (const entry of await readdir(join(root, "node_modules"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
  const folder = join(root, "node_modules", entry.name);
  const pkg = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
  let shared = false;
  try {
    shared = local(`${pkg.name}/package.json`).version === pkg.version;
  } catch {
    /* new dependency */
  }
  let bytes = 0;
  for (const path of await files(folder)) {
    const content = await readFile(path);
    bytes += content.length;
    if (!shared) payload.push(content);
  }
  packageSizes.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    bytes,
    alreadyPresent: shared,
  });
}
const language = await readFile(join(root, "lang/fin.traineddata"));
payload.push(language, await readFile(join(root, "lang/LICENSE")));
const rawPayloadBytes = payload.reduce((sum, p) => sum + p.length, 0);
const compressedPayloadBytes = gzipSync(Buffer.concat(payload), {
  level: 9,
}).length;

await mkdir(join(root, "results"), { recursive: true });
const workerPath = join(root, "worker-local.cjs");
await writeFile(
  workerPath,
  `global.fetch = () => { throw new Error('OCR network forbidden'); };\nfor (const module of ['node:http', 'node:https']) { const network = require(module); network.request = network.get = () => { throw new Error('OCR network forbidden'); }; }\nrequire(${JSON.stringify(candidate.resolve("tesseract.js/src/worker-script/node/index.js"))});\n`,
);
const started = performance.now();
const worker = await createWorker("fin", 1, {
  langPath: join(root, "lang"),
  gzip: false,
  cacheMethod: "none",
  workerPath,
  errorHandler: (error) => {
    throw error;
  },
});
const coldInitMs = performance.now() - started;
await worker.setParameters({ tessedit_pageseg_mode: "6" });
const results = [];
try {
  for (const receipt of fixtures.receipts)
    for (const variant of fixtures.variants) {
      const id = `${receipt.id}-${variant.id}`;
      const input = new Uint8Array(
        await readFile(join(root, "scans", `${id}.pdf`)),
      );
      const before = performance.now();
      const loading = getDocument({
        data: input,
        useSystemFonts: false,
        useWorkerFetch: false,
        disableFontFace: true,
        isEvalSupported: false,
        enableXfa: false,
        verbosity: 0,
      });
      try {
        const doc = await loading.promise;
        const page = await doc.getPage(1);
        const text = await page.getTextContent();
        if (text.items.some((item) => "str" in item && item.str.trim()))
          throw new Error("Fixture has a text layer");
        const viewport = page.getViewport({ scale: 300 / 72 });
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          canvas,
        }).promise;
        const raster = canvas.toBuffer("image/png");
        const renderMs = performance.now() - before;
        const ocrStart = performance.now();
        const output = await worker.recognize(raster);
        const ocrMs = performance.now() - ocrStart;
        const actual = output.data.text;
        const reference = receipt.rows.join("\n");
        const expectedRows = receipt.criticalRows.map((index) =>
          normalize(receipt.rows[index]),
        );
        const recognizedRows = actual.split(/\r?\n/).map(normalize);
        const parsed = parseReceipt(actual);
        const result = {
          id,
          dpi: variant.dpi,
          renderMs: Math.round(renderMs),
          ocrMs: Math.round(ocrMs),
          coldTotalMs: Math.round(coldInitMs + renderMs + ocrMs),
          characterErrors: distance(normalize(reference), normalize(actual)),
          referenceCharacters: normalize(reference).length,
          exactCriticalRows: expectedRows.filter((row) =>
            recognizedRows.includes(row),
          ).length,
          criticalRows: expectedRows.length,
          priceTokens: receipt.expectedPrices.filter((price) =>
            actual.includes(price),
          ).length,
          expectedPriceTokens: receipt.expectedPrices.length,
          parserOutcome: parsed.outcome,
          parserFacts: parsed.outcome === "event" ? parsed.facts : null,
          expectedTotalCents: receipt.expectedTotalCents,
          expectedProductCount: receipt.expectedProductCount,
          confidence: output.data.confidence,
          rasterPixels: canvas.width * canvas.height,
        };
        results.push(result);
        await writeFile(join(root, "results", `${id}.txt`), actual);
        await writeFile(join(root, "results", `${id}.png`), raster);
        console.log(
          JSON.stringify({
            id,
            characterErrors: result.characterErrors,
            exactCriticalRows: result.exactCriticalRows,
            priceTokens: result.priceTokens,
            parserOutcome: result.parserOutcome,
            coldTotalMs: result.coldTotalMs,
          }),
        );
        page.cleanup();
      } finally {
        await loading.destroy();
      }
    }
} finally {
  await worker.terminate();
}
const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  coldInitMs: Math.round(coldInitMs),
  networkDisabledInOCRWorker: true,
  language: {
    ...JSON.parse(await readFile(join(root, "language-source.json"), "utf8")),
    bytes: language.length,
    sha256: createHash("sha256").update(language).digest("hex"),
  },
  packages: packageSizes,
  rawPayloadBytes,
  gzipPayloadEstimateBytes: compressedPayloadBytes,
  lzmaPayloadEstimateBytes: await stat(join(root, "payload.7z")).then(
    (info) => info.size,
    () => null,
  ),
  results,
};
await writeFile(join(root, "results.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    rawPayloadBytes,
    gzipPayloadEstimateBytes: compressedPayloadBytes,
    coldInitMs: report.coldInitMs,
  }),
);
