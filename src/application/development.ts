import type { Storage } from "./service";
import { Service } from "./service";
import { DemoProvider } from "../stores/demo";
import type { StoreProvider } from "../stores/provider";

/** Separate planning data, journals and fixture carts from the live profile. */
export async function createService(
  db: Storage,
  development: boolean,
  live: StoreProvider[],
) {
  const storage: Storage = development
    ? {
        get: (key) => db.get(`development:${key}`),
        set: (key, value) => db.set(`development:${key}`, value),
      }
    : db;
  const service = new Service(storage);
  service.developmentMode = development;
  for (const provider of live)
    service.registry.register(
      development ? new DemoProvider(provider.id) : provider,
    );
  await service.init();
  return service;
}
