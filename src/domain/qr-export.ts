/** One QR code carries at most this many UTF-8 bytes, header included. */
export const QR_MAX_BYTES = 1000;

const encoder = new TextEncoder();
export const utf8Bytes = (text: string) => encoder.encode(text).length;

/** `[n/m]`, with `+` when the part continues the previous part's last line. */
const header = (index: number, count: number, continues: boolean) =>
  `[${index}/${count}${continues ? "+" : ""}]\n`;
const headerPattern = /^\[(\d{1,3})\/(\d{1,3})(\+?)\]\n/;

/**
 * Splits the text export for QR codes. A list that fits is one code holding the plain text, so a
 * phone shows it unchanged. A longer one becomes numbered parts, each starting `[n/m]`, split at
 * line breaks where possible and otherwise between whole characters, never inside one.
 */
export function qrParts(text: string, maxBytes = QR_MAX_BYTES): string[] {
  if (!text.trim()) return [];
  if (utf8Bytes(text) <= maxBytes) return [text];
  const room = maxBytes - utf8Bytes(header(999, 999, true));
  const chunks: { body: string; continues: boolean }[] = [];
  let current = "";
  let continues = false;
  const push = () => {
    if (current) chunks.push({ body: current, continues });
    current = "";
    continues = false;
  };
  for (const line of text.split("\n")) {
    const joined = current ? `${current}\n${line}` : line;
    if (utf8Bytes(joined) <= room) {
      current = joined;
      continue;
    }
    push();
    if (utf8Bytes(line) <= room) {
      current = line;
      continue;
    }
    // One line longer than a part: cut it between code points.
    for (const character of line) {
      if (utf8Bytes(current + character) > room) {
        push();
        continues = true;
      }
      current += character;
    }
  }
  push();
  return chunks.map(
    (chunk, i) => header(i + 1, chunks.length, chunk.continues) + chunk.body,
  );
}

/**
 * The reverse of `qrParts`: parts in any order become the original text. It rejects a missing,
 * repeated or mixed-up part instead of returning a partial list.
 */
export function qrText(parts: string[]): string {
  if (!parts.length) throw new Error("emptyQr");
  if (parts.length === 1 && !headerPattern.test(parts[0])) return parts[0];
  const slots = new Map<number, { body: string; continues: boolean }>();
  let count = 0;
  for (const part of parts) {
    const match = headerPattern.exec(part);
    if (!match) throw new Error("invalidQr");
    const index = Number(match[1]);
    const total = Number(match[2]);
    count ||= total;
    if (total !== count || index < 1 || index > count)
      throw new Error("invalidQr");
    if (slots.has(index)) throw new Error("duplicateQr");
    slots.set(index, {
      body: part.slice(match[0].length),
      continues: match[3] === "+",
    });
  }
  if (slots.size !== count) throw new Error("missingQr");
  let text = "";
  for (const [position, { body, continues }] of [...slots.entries()].sort(
    ([a], [b]) => a - b,
  ))
    text += position === 1 ? body : continues ? body : `\n${body}`;
  return text;
}
