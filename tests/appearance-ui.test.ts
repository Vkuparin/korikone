import { afterEach, expect, it, vi } from "vitest";
import { applyAppearance, subscribeAppearance } from "../src/ui/appearance";
import type { AppearanceBootstrap } from "../src/domain/appearance";

afterEach(() => vi.unstubAllGlobals());

it("subscribes before reading the current appearance and returns exact cleanup", () => {
  const dataset: Record<string, string> = {};
  let listener: ((value: AppearanceBootstrap) => void) | undefined;
  const cleanup = vi.fn(() => {
    listener = undefined;
  });
  const order: string[] = [];
  vi.stubGlobal("document", { documentElement: { dataset } });
  vi.stubGlobal("window", {
    korikone: {
      onAppearanceChange: (callback: typeof listener) => {
        order.push("subscribe");
        listener = callback;
        return cleanup;
      },
      getAppearanceBootstrap: (): AppearanceBootstrap => {
        order.push("read");
        return {
          preference: "system",
          resolved: "dark",
          chain: "k",
          sequence: 3,
        };
      },
    },
  });
  const changed = vi.fn();
  const stop = subscribeAppearance(changed);
  expect(order).toEqual(["subscribe", "read"]);
  expect(dataset).toEqual({ appearance: "system", theme: "dark", chain: "k" });
  listener?.({
    preference: "light",
    resolved: "light",
    chain: "s",
    sequence: 4,
  });
  expect(dataset).toEqual({ appearance: "light", theme: "light", chain: "s" });
  expect(changed).toHaveBeenCalledTimes(2);
  // An event published before the value already shown must not bring the old chain back.
  listener?.({
    preference: "system",
    resolved: "dark",
    chain: "k",
    sequence: 2,
  });
  expect(dataset).toEqual({ appearance: "light", theme: "light", chain: "s" });
  expect(changed).toHaveBeenCalledTimes(2);
  expect(
    applyAppearance({
      preference: "dark",
      resolved: "dark",
      chain: "neutral",
      sequence: 5,
    }),
  ).toBe(true);
  expect(dataset.chain).toBe("neutral");
  stop();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(listener).toBeUndefined();
});
