import React from "react";
import qrcode from "qrcode-generator";
import { qrParts } from "../domain/qr-export";

// The library's default encoder is not UTF-8; list names carry ä and ö.
qrcode.stringToBytes = (s: string) => [...new TextEncoder().encode(s)];

function svg(payload: string) {
  const code = qrcode(0, "L");
  code.addData(payload, "Byte");
  code.make();
  return code.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

/**
 * The text export as one QR code, or several numbered ones for a long list. A snapshot for a
 * phone camera: it does not update, and the generated markup contains only the library's squares.
 */
export function QrExport({ text, fi }: { text: string; fi: boolean }) {
  const tr = (a: string, b: string) => (fi ? a : b);
  const parts = qrParts(text);
  if (!parts.length)
    return (
      <p className="muted" role="status">
        {tr(
          "Lista on tyhjä, joten QR-koodia ei ole.",
          "The list is empty, so there is no QR code.",
        )}
      </p>
    );
  return (
    <section
      className="qr-export"
      aria-label={tr("Lista QR-koodina", "List as a QR code")}
    >
      <p className="muted">
        {parts.length === 1
          ? tr(
              "Skannaa koodi puhelimella. Se on tilannekuva listasta eikä päivity.",
              "Scan the code with a phone. It is a snapshot of the list and does not update.",
            )
          : tr(
              `Lista on pitkä: skannaa kaikki ${parts.length} koodia missä tahansa järjestyksessä. Ne ovat tilannekuva eivätkä päivity.`,
              `The list is long: scan all ${parts.length} codes in any order. They are a snapshot and do not update.`,
            )}
      </p>
      <div className="qr-codes">
        {parts.map((part, i) => (
          <figure key={i}>
            <div
              className="qr-code"
              role="img"
              aria-label={
                parts.length === 1
                  ? tr("QR-koodi", "QR code")
                  : tr(
                      `QR-koodi ${i + 1}/${parts.length}`,
                      `QR code ${i + 1} of ${parts.length}`,
                    )
              }
              dangerouslySetInnerHTML={{ __html: svg(part) }}
            />
            {parts.length > 1 && (
              <figcaption>
                {tr("Koodi", "Code")} {i + 1}/{parts.length}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </section>
  );
}
