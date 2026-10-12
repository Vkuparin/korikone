// Tesseract runs in a child worker. No network or remote language fallback is allowed.
globalThis.fetch = (() => {
  throw new Error("OCR network forbidden");
}) as typeof fetch;
for (const name of ["node:http", "node:https"]) {
  const network = require(name);
  network.get = network.request = () => {
    throw new Error("OCR network forbidden");
  };
}
require("tesseract.js/src/worker-script/node/index.js");
