// Small synthetic PDF, with no customer information or external resources.
export function receiptPDF(
  text: string | string[],
  font: "Helvetica" | "Courier" = "Helvetica",
) {
  const pages = typeof text === "string" ? [text] : text;
  const hex = (value: string) =>
    [...value]
      .map((char) => {
        const code = char === "€" ? 0x80 : char.codePointAt(0)!;
        if (code > 255) throw new Error("Unsupported fixture character");
        return code.toString(16).padStart(2, "0");
      })
      .join("");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`,
  ];
  for (const page of pages) {
    const contentId = objects.length + 2;
    const stream = page ? `BT /F1 12 Tf 30 150 Td <${hex(page)}> Tj ET` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return output;
}
