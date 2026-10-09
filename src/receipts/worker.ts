import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function extract() {
  const data = new Uint8Array(await readFile(workerData as string));
  const loading = getDocument({
    data,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl: fileURLToPath(
      new URL(
        "./standard_fonts/",
        import.meta.resolve("pdfjs-dist/package.json"),
      ),
    ).replace(/\\/g, "/"),
    verbosity: 0,
  });
  loading.onPassword = () => {
    void loading.destroy();
  };
  try {
    const document = await loading.promise;
    if (document.numPages > 100) throw new Error("receiptTooLarge");
    let text = "";
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      }
      text += "\n";
      page.cleanup();
      if (text.length > 50000) throw new Error("receiptTooLarge");
    }
    if (!text.trim()) throw new Error("receiptNoText");
    parentPort!.postMessage({ text });
  } finally {
    await loading.destroy();
  }
}
extract().catch((error) =>
  parentPort!.postMessage({
    error: ["receiptTooLarge", "receiptNoText"].includes(error?.message)
      ? error.message
      : "receiptUnreadable",
  }),
);
