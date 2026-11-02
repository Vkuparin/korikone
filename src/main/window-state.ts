import { z } from "zod";

/** The window's last size and place, kept outside the shopping profile (B6.3). */
export const WINDOW_STATE_KEY = "window-state";
export const DEFAULT_SIZE = { width: 1280, height: 900 };
export const MIN_SIZE = { width: 680, height: 600 };
/** How much of the title bar must stay on a screen for a saved place to be used again. */
const VISIBLE = { width: 120, height: 38 };

export type Rect = { x: number; y: number; width: number; height: number };
export type WindowState = Rect & { maximized: boolean };

const windowStateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(MIN_SIZE.width).max(20000),
  height: z.number().int().min(MIN_SIZE.height).max(20000),
  maximized: z.boolean(),
});

export function readWindowState(value: unknown): WindowState | null {
  const parsed = windowStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Where the window opens. A saved place is reused when enough of its title bar lies on a screen
 * that is still connected, with its size kept within that screen. Otherwise the window opens at
 * the default size, shrunk to fit the primary screen's work area, and the system centres it.
 */
export function initialBounds(
  saved: WindowState | null,
  workAreas: Rect[],
  primary: Rect,
): {
  bounds: Partial<Rect> & { width: number; height: number };
  maximized: boolean;
} {
  const fit = (size: { width: number; height: number }, area: Rect) => ({
    width: Math.max(MIN_SIZE.width, Math.min(size.width, area.width)),
    height: Math.max(MIN_SIZE.height, Math.min(size.height, area.height)),
  });
  if (saved) {
    const area = workAreas.find((area) => {
      const left = Math.max(saved.x, area.x);
      const right = Math.min(saved.x + saved.width, area.x + area.width);
      const top = Math.max(saved.y, area.y);
      const bottom = Math.min(saved.y + VISIBLE.height, area.y + area.height);
      return right - left >= VISIBLE.width && bottom - top >= VISIBLE.height;
    });
    if (area) {
      const size = fit(saved, area);
      return {
        bounds: {
          x: Math.min(
            Math.max(saved.x, area.x),
            area.x + area.width - size.width,
          ),
          y: Math.min(
            Math.max(saved.y, area.y),
            area.y + area.height - size.height,
          ),
          ...size,
        },
        maximized: saved.maximized,
      };
    }
  }
  return {
    bounds: fit(DEFAULT_SIZE, primary),
    maximized: saved?.maximized ?? false,
  };
}
