/** U18.1 contract values. `src/ui/style.css` must equal these once U18.2 and U18.4 apply them. */
export const basePalette = {
  light: {
    bg: "#f3f6f3",
    surface: "#ffffff",
    subtle: "#e8efe9",
    text: "#203b2e",
    muted: "#52665a",
    border: "#b6c6bb",
    controlBorder: "#76877c",
    focus: "#126eab",
    success: "#256343",
    warning: "#805000",
    warningBg: "#fff1d3",
    error: "#ae303b",
    errorBg: "#fff0f1",
  },
  dark: {
    bg: "#131416",
    surface: "#1d1f22",
    subtle: "#2a2d31",
    text: "#eceef0",
    muted: "#b4b9c0",
    border: "#5d636b",
    controlBorder: "#8a919a",
    focus: "#81c7fa",
    success: "#8fd6a8",
    warning: "#f3c778",
    warningBg: "#3a301c",
    error: "#ffb3ba",
    errorBg: "#3d2327",
  },
} as const;
export const chainPalette = {
  light: {
    s: {
      action: "#256343",
      onAction: "#ffffff",
      actionText: "#256343",
      actionSoft: "#dfeee4",
    },
    k: {
      action: "#b34700",
      onAction: "#ffffff",
      actionText: "#a84300",
      actionSoft: "#ffe8d6",
    },
    neutral: {
      action: "#3f4a54",
      onAction: "#ffffff",
      actionText: "#3f4a54",
      actionSoft: "#e3e7ea",
    },
  },
  dark: {
    s: {
      action: "#8fd6a8",
      onAction: "#10261a",
      actionText: "#8fd6a8",
      actionSoft: "#1f3528",
    },
    k: {
      action: "#ffa44f",
      onAction: "#2b1600",
      actionText: "#ffa44f",
      actionSoft: "#3d2a17",
    },
    neutral: {
      action: "#c5ccd4",
      onAction: "#16181b",
      actionText: "#c5ccd4",
      actionSoft: "#30343a",
    },
  },
} as const;

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2 contrast ratio of two opaque colours. */
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
