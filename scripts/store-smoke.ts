import { KRuokaWorker, findChrome } from "../src/stores/worker";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { resolve } from "node:path";
const worker = new KRuokaWorker(
  resolve("vendor/k-ruoka/k-ruoka-mcp.exe"),
  resolve(".runtime/catalogue-smoke-profile"),
  findChrome(),
);
try {
  const provider = new KRuokaProvider((name, args) => worker.call(name, args));
  const stores = await provider.searchStores("Ruoholahti");
  console.log(JSON.stringify({ stores }));
  if (stores[0])
    console.log(
      JSON.stringify({
        products: await provider.searchProducts(stores[0], "pasta", "pasta"),
      }),
    );
} finally {
  await worker.close();
}
