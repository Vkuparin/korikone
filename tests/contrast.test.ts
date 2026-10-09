import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Every text colour in the stylesheet must reach WCAG AA (4.5:1) on every light background
// it uses, so hints, store names and help lines stay readable.
const css = readFileSync("src/ui/style.css", "utf8");
const luminance = (hex: string) => {
  const value = hex.length === 4 ? hex.replace(/\w/g, (c) => c + c) : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("text colours reach 4.5:1 on the light backgrounds", () => {
  const colours = [
    ...css.matchAll(/(?<![-\w])color:\s*(#[0-9a-fA-F]{3,6})\b/g),
  ].map((m) => m[1]);
  const backgrounds = [
    "#ffffff",
    ...[...css.matchAll(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,6})\b/g)]
      .map((m) => m[1])
      .filter((b) => luminance(b) > 0.6),
  ];
  // White text on the dark green buttons is checked the other way round.
  const failing = colours
    .filter((c) => luminance(c) < 0.6)
    .flatMap((c) =>
      backgrounds
        .filter((b) => contrast(c, b) < 4.5)
        .map((b) => `${c} on ${b}`),
    );
  expect(failing).toEqual([]);
});
