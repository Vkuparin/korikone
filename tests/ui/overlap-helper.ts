import type { Page } from "@playwright/test";

export type LayoutFinding = {
  kind:
    | "overlap"
    | "covered"
    | "clipped"
    | "spill"
    | "broken-word"
    | "crowded"
    | "page-overflow";
  /** A short description of the element: tag, classes and the start of its text or label. */
  element: string;
  /** The other element of an overlap, or the element that covers a click target. */
  other?: string;
  /** Overlapping or missing pixels, width x height. */
  size?: string;
};

/**
 * Measures the page as laid out, not as captured: the real boxes of controls and of text, what
 * a click at each control's centre would hit, and text cut by or spilling out of its box.
 * Run it after the state under test is visible. It scrolls while measuring and restores nothing.
 */
export function layoutFindings(page: Page): Promise<LayoutFinding[]> {
  return page.evaluate(() => {
    type Finding = {
      kind:
        | "overlap"
        | "covered"
        | "clipped"
        | "spill"
        | "broken-word"
        | "crowded"
        | "page-overflow";
      element: string;
      other?: string;
      size?: string;
    };
    const findings: Finding[] = [];
    const describe = (el: Element) => {
      const classes = [...el.classList].slice(0, 3).join(".");
      const text = (
        el.getAttribute("aria-label") ??
        (el as HTMLElement).innerText ??
        (el as HTMLInputElement).value ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);
      const parent = el.parentElement;
      const within = parent
        ? `${parent.tagName.toLowerCase()}${parent.classList[0] ? "." + parent.classList[0] : ""} > `
        : "";
      return `${within}${el.tagName.toLowerCase()}${classes ? "." + classes : ""}${text ? ` "${text}"` : ""}`;
    };
    const shown = (el: Element) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      // Closed disclosure content and text kept for screen readers only take no visible room.
      if (
        !el.checkVisibility({
          contentVisibilityAuto: true,
          opacityProperty: true,
          visibilityProperty: true,
        }) ||
        el.closest(".sr-only")
      )
        return false;
      if (style.visibility !== "visible" || style.display === "none")
        return false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.opacity === "0" || s.display === "none") return false;
        if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden"))
          return false;
      }
      return true;
    };
    // Position relative to the page for boxes in normal flow; pinned boxes are measured apart.
    const pinned = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === "fixed" || position === "sticky") return node;
      }
      return null;
    };
    // A box hidden by a scrolling ancestor is not on screen there, so it cannot overlap.
    const visibleBox = (el: Element, rect: DOMRect) => {
      let left = rect.left;
      let top = rect.top;
      let right = rect.right;
      let bottom = rect.bottom;
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "visible" && style.overflowY === "visible")
          continue;
        const box = node.getBoundingClientRect();
        if (style.overflowX !== "visible") {
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
        }
        if (style.overflowY !== "visible") {
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      return { left, top, right, bottom };
    };
    const controls = [
      ...document.querySelectorAll(
        "button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=switch]",
      ),
    ].filter(shown);
    const texts: { el: Element; rects: DOMRect[] }[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !node.textContent?.trim() || !shown(el)) continue;
      if (el.closest("option, script, style, title")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(
        (r) => r.width >= 1 && r.height >= 1,
      );
      if (rects.length) texts.push({ el, rects });
    }

    type Box = {
      el: Element;
      left: number;
      top: number;
      right: number;
      bottom: number;
      pin: Element | null;
      text: boolean;
    };
    const boxes: Box[] = [];
    for (const el of controls) {
      const box = visibleBox(el, el.getBoundingClientRect());
      if (box.right - box.left >= 1 && box.bottom - box.top >= 1)
        boxes.push({ el, ...box, pin: pinned(el), text: false });
    }
    for (const { el, rects } of texts)
      for (const rect of rects) {
        const box = visibleBox(el, rect);
        if (box.right - box.left >= 1 && box.bottom - box.top >= 1)
          boxes.push({ el, ...box, pin: pinned(el), text: true });
      }
    const seen = new Set<string>();
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el))
          continue;
        // Two pieces of text inside one control or label are that control's own layout.
        if (a.pin !== b.pin) continue;
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width < 3 || height < 3) continue;
        // A label wrapping its input, or text laid over its own control on purpose.
        const label = (x: Element, y: Element) =>
          x.closest("label")?.contains(y) || y.closest("label")?.contains(x);
        if (label(a.el, b.el) && !(a.text && b.text)) continue;
        const key = `${describe(a.el)}|${describe(b.el)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          kind: "overlap",
          element: describe(a.el),
          other: describe(b.el),
          size: `${Math.round(width)}x${Math.round(height)}`,
        });
      }

    // Two borderless text actions side by side with no room between them read as one link.
    const plain = (el: Element) => {
      const style = getComputedStyle(el);
      return (
        (parseFloat(style.borderTopWidth) === 0 ||
          /, 0\)$/.test(style.borderTopColor)) &&
        style.backgroundColor === "rgba(0, 0, 0, 0)" &&
        !el.matches("input, select, textarea")
      );
    };
    const links = boxes.filter((b) => !b.text && plain(b.el));
    for (const a of links)
      for (const b of links) {
        if (a === b || a.pin !== b.pin || a.left >= b.left) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const gap = b.left - a.right;
        const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (gap < 6 && gap > -3 && shared > 8)
          findings.push({
            kind: "crowded",
            element: describe(a.el),
            other: describe(b.el),
            size: `${Math.round(gap)}`,
          });
      }

    // Text cut off by a box that hides its overflow, or a single word broken across lines.
    const reported = new Set<Element>();
    for (const { el, rects } of texts) {
      const word = (el as HTMLElement).innerText.trim();
      if (
        // A hyphen is a legitimate place to wrap.
        !/[\s\-‐-—/]/.test(word) &&
        el.childElementCount === 0 &&
        new Set(rects.map((r) => Math.round(r.top))).size > 1 &&
        !reported.has(el)
      ) {
        reported.add(el);
        findings.push({ kind: "broken-word", element: describe(el) });
      }
      let cut = 0;
      let cutter: Element | null = null;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const scrolls = (value: string) =>
          value === "auto" || value === "scroll";
        if (scrolls(style.overflowX) || scrolls(style.overflowY)) break;
        const hides = (value: string) => value === "hidden" || value === "clip";
        const box = node.getBoundingClientRect();
        for (const rect of rects) {
          const x = hides(style.overflowX)
            ? Math.max(rect.right - box.right, box.left - rect.left)
            : 0;
          const y = hides(style.overflowY)
            ? Math.max(rect.bottom - box.bottom, box.top - rect.top)
            : 0;
          if (Math.max(x, y) > cut) {
            cut = Math.max(x, y);
            cutter = node;
          }
        }
      }
      if (cut > 2 && cutter)
        findings.push({
          kind: "clipped",
          element: describe(el),
          other: describe(cutter),
          size: `${Math.round(cut)}`,
        });
    }
    // Content running out of a control that does not hide it.
    for (const el of controls) {
      const node = el as HTMLElement;
      if (node.matches("input, select, textarea")) continue;
      const style = getComputedStyle(node);
      if (style.display === "inline" || style.overflowX !== "visible") continue;
      const over = node.scrollWidth - node.clientWidth;
      const tall = node.scrollHeight - node.clientHeight;
      if ((over > 1 || tall > 1) && node.clientWidth > 0)
        findings.push({
          kind: "spill",
          element: describe(el),
          size: `${Math.max(over, 0)}x${Math.max(tall, 0)}`,
        });
    }

    // What a click at the centre of each control reaches once it is scrolled into view.
    for (const el of controls) {
      if ((el as HTMLButtonElement).disabled) continue;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
        findings.push({
          kind: "covered",
          element: describe(el),
          other: "outside the window",
        });
        continue;
      }
      const hit = document.elementFromPoint(x, y);
      if (
        hit &&
        hit !== el &&
        !el.contains(hit) &&
        !hit.contains(el) &&
        !hit.closest("label")?.contains(el)
      )
        findings.push({
          kind: "covered",
          element: describe(el),
          other: describe(hit),
        });
    }
    const wide = document.documentElement.scrollWidth - innerWidth;
    if (wide > 0)
      findings.push({
        kind: "page-overflow",
        element: "html",
        size: `${wide}x0`,
      });
    scrollTo(0, 0);
    return findings;
  });
}
