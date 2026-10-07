import { Worker } from "node:worker_threads";
export class Database {
  private worker: Worker;
  private counter = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  constructor(path: string) {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: { path },
    });
    this.worker.on("message", ({ id, value, error }) => {
      const p = this.pending.get(id);
      this.pending.delete(id);
      if (error) p?.reject(new Error(error));
      else p?.resolve(value);
    });
    this.worker.on("error", () => {
      for (const p of this.pending.values())
        p.reject(new Error("storageFailed"));
      this.pending.clear();
    });
  }
  request(op: string, key: string, value?: unknown): Promise<any> {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, key, value });
    });
  }
  get(key: string) {
    return this.request("get", key);
  }
  set(key: string, value: unknown) {
    return this.request("set", key, value);
  }
  close() {
    return this.worker.terminate();
  }
}
