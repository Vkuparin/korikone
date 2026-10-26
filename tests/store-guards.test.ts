import { expect, test, vi } from "vitest";
import { storePermissionAllowed, withTimeout } from "../src/main/store-guards";

test("store pages get clipboard writes and fullscreen only", () => {
  for (const allowed of ["clipboard-sanitized-write", "fullscreen"])
    expect(storePermissionAllowed(allowed)).toBe(true);
  for (const denied of [
    "media",
    "geolocation",
    "notifications",
    "midi",
    "clipboard-read",
    "openExternal",
    "hid",
  ])
    expect(storePermissionAllowed(denied)).toBe(false);
});

test("a stalled page script fails as storeUnavailable and drops the page; a quick one is untouched", async () => {
  vi.useFakeTimers();
  try {
    const dropped = vi.fn();
    const stalled = withTimeout(new Promise(() => {}), 30_000, dropped);
    const outcome = expect(stalled).rejects.toThrow("storeUnavailable");
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
    expect(dropped).toHaveBeenCalledOnce();

    const kept = vi.fn();
    await expect(withTimeout(Promise.resolve(7), 30_000, kept)).resolves.toBe(
      7,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(kept).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
