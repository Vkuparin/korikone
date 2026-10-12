import { describe, expect, test } from "vitest";
import {
  QR_MAX_BYTES,
  qrParts,
  qrText,
  utf8Bytes,
} from "../src/domain/qr-export";
import { shoppingList } from "../src/domain/planner";
import { initialState } from "../src/domain/model";
import qrcode from "qrcode-generator";

const list = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `Tuote ${i + 1}: ${100 + i} g (extra)`,
  ).join("\n");

describe("F12.1 QR text export", () => {
  test("a short list is one code holding the plain text; an empty list has none", () => {
    expect(qrParts("Maito: 1000 ml (extra)")).toEqual([
      "Maito: 1000 ml (extra)",
    ]);
    expect(qrParts("")).toEqual([]);
    expect(qrParts("  \n ")).toEqual([]);
    // The real export of an empty list.
    expect(qrParts(shoppingList({ ...initialState(), staples: [] }))).toEqual(
      [],
    );
  });

  test("a long list is split into ordered numbered parts that each fit and decode back exactly", () => {
    const text = list(120);
    expect(utf8Bytes(text)).toBeGreaterThan(QR_MAX_BYTES * 2);
    const parts = qrParts(text);
    expect(parts.length).toBe(3);
    parts.forEach((part, i) => {
      expect(part.startsWith(`[${i + 1}/${parts.length}]\n`)).toBe(true);
      expect(utf8Bytes(part)).toBeLessThanOrEqual(QR_MAX_BYTES);
    });
    expect(qrText(parts)).toBe(text);
    // Scanned in any order, the same list comes back.
    expect(qrText([parts[2], parts[0], parts[1]])).toBe(text);
  });

  test("multibyte text is never cut inside a character, even inside one long line", () => {
    const text = `${"ä".repeat(900)}\n${"🥛".repeat(700)}\n${"ö".repeat(1500)}\nMaito`;
    const parts = qrParts(text);
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) {
      expect(utf8Bytes(part)).toBeLessThanOrEqual(QR_MAX_BYTES);
      // A cut character would not survive an encode/decode round trip.
      expect(new TextDecoder().decode(new TextEncoder().encode(part))).toBe(
        part,
      );
      expect(part).not.toContain("�");
    }
    expect(qrText(parts)).toBe(text);
  });

  test("a missing, repeated or foreign part is rejected rather than shown as a partial list", () => {
    const parts = qrParts(list(120));
    expect(() => qrText(parts.slice(1))).toThrow("missingQr");
    expect(() => qrText([parts[0], parts[0], parts[1]])).toThrow("duplicateQr");
    expect(() => qrText([parts[0], "[2/9]\nx", parts[2]])).toThrow("invalidQr");
    expect(() => qrText([])).toThrow("emptyQr");
  });

  test("every part of a long list fits one QR code of the pinned library", () => {
    qrcode.stringToBytes = (s: string) => [...new TextEncoder().encode(s)];
    for (const part of qrParts(list(120))) {
      const code = qrcode(0, "L");
      code.addData(part, "Byte");
      code.make();
      expect(code.getModuleCount()).toBeGreaterThan(20);
      expect(code.getModuleCount()).toBeLessThanOrEqual(177);
    }
  });
});
