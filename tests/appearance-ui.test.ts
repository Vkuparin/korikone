import { afterEach, expect, it, vi } from "vitest";
import { subscribeAppearance } from "../src/ui/appearance";
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
      getAppearanceBootstrap: () => {
        order.push("read");
        return { preference: "system", resolved: "dark" };
      },
    },
  });
  const changed = vi.fn();
  const stop = subscribeAppearance(changed);
  expect(order).toEqual(["subscribe", "read"]);
  expect(dataset).toEqual({ appearance: "system", theme: "dark" });
  listener?.({ preference: "light", resolved: "light" });
  expect(dataset).toEqual({ appearance: "light", theme: "light" });
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(listener).toBeUndefined();
});
