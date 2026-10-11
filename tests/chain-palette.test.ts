import { expect, test } from "vitest";
import { basePalette, chainPalette, contrast } from "./fixtures/chain-palette";

const themes = ["light", "dark"] as const;
const chains = ["s", "k", "neutral"] as const;

test("base text and status colours reach 4.5:1 on every surface they sit on", () => {
  const failing: string[] = [];
  for (const theme of themes) {
    const p = basePalette[theme];
    for (const [name, colour] of Object.entries({
      text: p.text,
      muted: p.muted,
      success: p.success,
      warning: p.warning,
      error: p.error,
    }))
      for (const [surface, background] of Object.entries({
        bg: p.bg,
        surface: p.surface,
        subtle: p.subtle,
      }))
        if (contrast(colour, background) < 4.5)
          failing.push(`${theme} ${name} on ${surface}`);
    for (const [name, colour, background] of [
      ["warning on warning-bg", p.warning, p.warningBg],
      ["error on error-bg", p.error, p.errorBg],
      ["text on warning-bg", p.text, p.warningBg],
      ["text on error-bg", p.text, p.errorBg],
    ])
      if (contrast(colour, background) < 4.5) failing.push(`${theme} ${name}`);
  }
  expect(failing).toEqual([]);
});

test("each chain accent is readable as fill, as text and on its soft selection", () => {
  const failing: string[] = [];
  for (const theme of themes)
    for (const chain of chains) {
      const p = basePalette[theme],
        c = chainPalette[theme][chain];
      const text: [string, string, string][] = [
        ["on-action on action", c.onAction, c.action],
        ["action-text on bg", c.actionText, p.bg],
        ["action-text on surface", c.actionText, p.surface],
        ["action-text on subtle", c.actionText, p.subtle],
        ["action-text on action-soft", c.actionText, c.actionSoft],
        ["text on action-soft", p.text, c.actionSoft],
        ["muted on action-soft", p.muted, c.actionSoft],
      ];
      for (const [name, a, b] of text)
        if (contrast(a, b) < 4.5) failing.push(`${theme} ${chain} ${name}`);
      // A filled control must be visible as a control on each surface.
      for (const surface of [p.bg, p.surface, p.subtle])
        if (contrast(c.action, surface) < 3)
          failing.push(`${theme} ${chain} fill on ${surface}`);
    }
  expect(failing).toEqual([]);
});

test("focus rings and control boundaries reach 3:1 on every surface they are drawn on", () => {
  const failing: string[] = [];
  for (const theme of themes) {
    const p = basePalette[theme];
    const surfaces = [
      p.bg,
      p.surface,
      p.subtle,
      p.warningBg,
      p.errorBg,
      ...chains.map((chain) => chainPalette[theme][chain].actionSoft),
    ];
    for (const surface of surfaces) {
      if (contrast(p.focus, surface) < 3)
        failing.push(`${theme} focus on ${surface}`);
      if (contrast(p.controlBorder, surface) < 3)
        failing.push(`${theme} control border on ${surface}`);
    }
  }
  expect(failing).toEqual([]);
});

test("chain accents differ from each other and never replace a status colour", () => {
  for (const theme of themes) {
    const { s, k, neutral } = chainPalette[theme];
    expect(new Set([s.action, k.action, neutral.action]).size).toBe(3);
    expect(new Set([s.actionSoft, k.actionSoft, neutral.actionSoft]).size).toBe(
      3,
    );
    // Status roles are fixed per theme; no chain block may redefine them.
    for (const chain of chains)
      expect(Object.keys(chainPalette[theme][chain]).sort()).toEqual([
        "action",
        "actionSoft",
        "actionText",
        "onAction",
      ]);
    // K orange is a different colour from the warning text it may sit near.
    expect(k.action).not.toBe(basePalette[theme].warning);
    expect(k.actionSoft).not.toBe(basePalette[theme].warningBg);
  }
});

test("the dark base is neutral charcoal with separable surfaces", () => {
  const p = basePalette.dark;
  for (const colour of [p.bg, p.surface, p.subtle, p.border, p.controlBorder]) {
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(colour.slice(i, i + 2), 16),
    );
    // No channel dominates: at most a slight cool cast, never the old green tint.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
    expect(g).toBeLessThanOrEqual(b);
  }
  expect(contrast(p.surface, p.bg)).toBeGreaterThan(1.1);
  expect(contrast(p.subtle, p.surface)).toBeGreaterThan(1.15);
});
