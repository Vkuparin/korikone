import { test, expect } from "vitest";
import {
  DEFAULT_SIZE,
  initialBounds,
  readWindowState,
} from "../src/main/window-state";

const fullHd = { x: 0, y: 0, width: 1920, height: 1040 };
const laptop = { x: 0, y: 0, width: 1366, height: 728 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };

test("a first launch opens at the default size, shrunk to a small screen (B6.3)", () => {
  expect(initialBounds(null, [fullHd], fullHd)).toEqual({
    bounds: DEFAULT_SIZE,
    maximized: false,
  });
  // 1280 x 900 does not fit a 768 px laptop screen above the taskbar.
  expect(initialBounds(null, [laptop], laptop)).toEqual({
    bounds: { width: 1280, height: 728 },
    maximized: false,
  });
});

test("a saved size, place and maximized state come back on a connected screen (B6.3)", () => {
  const saved = { x: 2100, y: 80, width: 1500, height: 1000, maximized: true };
  expect(initialBounds(saved, [fullHd, right], fullHd)).toEqual({
    bounds: { x: 2100, y: 80, width: 1500, height: 1000 },
    maximized: true,
  });
  // A window partly past the screen edge is moved fully onto it.
  expect(
    initialBounds(
      { x: -300, y: 20, width: 1200, height: 800, maximized: false },
      [fullHd],
      fullHd,
    ).bounds,
  ).toEqual({ x: 0, y: 20, width: 1200, height: 800 });
  // A size larger than the screen it opens on is reduced to fit.
  expect(
    initialBounds(
      { x: 10, y: 10, width: 1900, height: 1200, maximized: false },
      [laptop],
      laptop,
    ).bounds,
  ).toEqual({ x: 0, y: 0, width: 1366, height: 728 });
});

test("a place on a disconnected screen falls back to the default, keeping maximized (B6.3)", () => {
  const saved = { x: 2100, y: 80, width: 1500, height: 1000, maximized: true };
  expect(initialBounds(saved, [fullHd], fullHd)).toEqual({
    bounds: DEFAULT_SIZE,
    maximized: true,
  });
});

test("only a valid saved state is read", () => {
  expect(
    readWindowState({ x: 1, y: 2, width: 800, height: 700, maximized: false }),
  ).toEqual({ x: 1, y: 2, width: 800, height: 700, maximized: false });
  for (const value of [
    undefined,
    null,
    "1280x900",
    { x: 1, y: 2, width: 100, height: 700, maximized: false },
    { x: 1.5, y: 2, width: 800, height: 700, maximized: false },
    { x: 1, y: 2, width: 800, height: 700 },
  ])
    expect(readWindowState(value)).toBeNull();
});
