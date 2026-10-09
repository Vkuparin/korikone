import { build } from "esbuild";
await build({
  entryPoints: ["src/receipts/worker.ts"],
  outfile: "dist/main/receipt-worker.js",
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["pdfjs-dist/*"],
  target: "node24",
});
await build({
  entryPoints: ["src/main/main.ts"],
  outdir: "dist/main",
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron", "@modelcontextprotocol/sdk/*", "s-kaupat-mcp"],
  target: "node24",
});
await build({
  entryPoints: ["src/main/preload.ts"],
  outfile: "dist/main/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node24",
});
await build({
  entryPoints: ["src/persistence/worker.ts"],
  outfile: "dist/main/worker.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
