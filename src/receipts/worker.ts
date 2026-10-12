import { parentPort, workerData } from "node:worker_threads";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { createWorker, PSM, type Worker as OCRWorker } from "tesseract.js";
import { finnishOCR, receiptLimits } from "./ocr-assets";

// PDF.js needs these before its module is initialized in a Node worker.
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
function checkRaster(width: number, height: number) {
  if (
    !Number.isFinite(width * height) ||
    width < 1 ||
    height < 1 ||
    width > receiptLimits.rasterDimension ||
    height > receiptLimits.rasterDimension ||
    width * height > receiptLimits.rasterPixels
  )
    throw new Error("receiptTooLarge");
}
// PDF.js also creates intermediate canvases for images, masks and transforms.
class BoundedCanvasFactory {
  create(width: number, height: number) {
    checkRaster(width, height);
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(
    target: ReturnType<BoundedCanvasFactory["create"]>,
    width: number,
    height: number,
  ) {
    checkRaster(width, height);
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target: ReturnType<BoundedCanvasFactory["create"]>) {
    target.canvas.width = 1;
    target.canvas.height = 1;
  }
}

async function extract() {
  const { path, assets } = workerData as { path: string; assets: string };
  if ((await stat(path)).size > receiptLimits.bytes)
    throw new Error("receiptTooLarge");
  const data = new Uint8Array(await readFile(path));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
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
    CanvasFactory: BoundedCanvasFactory,
  });
  loading.onPassword = () => {
    void loading.destroy();
  };
  let ocr: OCRWorker | undefined;
  try {
    const document = await loading.promise;
    if (document.numPages > receiptLimits.pages)
      throw new Error("receiptTooLarge");
    let text = "";
    const ocrPages: number[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      try {
        const content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items) {
          if ("str" in item) pageText += item.str + (item.hasEOL ? "\n" : " ");
        }
        if (!pageText.trim()) {
          const viewport = page.getViewport({ scale: receiptLimits.dpi / 72 });
          const width = Math.ceil(viewport.width),
            height = Math.ceil(viewport.height);
          checkRaster(width, height);
          const canvas = createCanvas(width, height);
          try {
            const context = canvas.getContext("2d");
            await page.render({
              canvas: canvas as unknown as HTMLCanvasElement,
              canvasContext: context as unknown as CanvasRenderingContext2D,
              viewport,
            }).promise;
            // Empty pages keep the existing no-text behavior without starting OCR.
            const pixels = context.getImageData(0, 0, width, height).data;
            let ink = false;
            for (let p = 0; p < pixels.length; p += 4) {
              if (
                pixels[p] < 245 ||
                pixels[p + 1] < 245 ||
                pixels[p + 2] < 245
              ) {
                ink = true;
                break;
              }
            }
            if (ink) {
              if (!ocr) {
                const modelPath = join(assets, "fin.traineddata");
                if ((await stat(modelPath)).size !== finnishOCR.bytes)
                  throw new Error("receiptUnreadable");
                const model = await readFile(modelPath);
                if (
                  createHash("sha256").update(model).digest("hex") !==
                  finnishOCR.sha256
                )
                  throw new Error("receiptUnreadable");
                ocr = await createWorker("fin", 1, {
                  langPath: assets,
                  gzip: false,
                  cacheMethod: "none",
                  workerPath: fileURLToPath(
                    new URL("./receipt-ocr-worker.cjs", import.meta.url),
                  ),
                  errorHandler: () => {},
                });
                await ocr.setParameters({
                  tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                });
              }
              const result = await ocr.recognize(canvas.toBuffer("image/png"));
              pageText = result.data.text;
              if (!pageText.trim()) throw new Error("receiptNoText");
              ocrPages.push(i);
            }
          } finally {
            canvas.width = 1;
            canvas.height = 1;
          }
        }
        text += pageText + (i < document.numPages ? "\n\f\n" : "\n");
        if (text.length > receiptLimits.characters)
          throw new Error("receiptTooLarge");
      } finally {
        page.cleanup();
      }
    }
    if (!text.trim()) throw new Error("receiptNoText");
    return { text, ocrPages };
  } finally {
    await ocr?.terminate();
    await loading.destroy();
  }
}
extract()
  .then((result) => parentPort!.postMessage(result))
  .catch((error) =>
    parentPort!.postMessage({
      error: ["receiptTooLarge", "receiptNoText"].includes(error?.message)
        ? error.message
        : "receiptUnreadable",
    }),
  );
