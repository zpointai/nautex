type PdfLine = {
  text: string;
  size?: number;
  bold?: boolean;
  gapAfter?: number;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 42;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 46;

function escapePdfText(value: string) {
  return value
    .replace(/€/g, "EUR")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(text: string, size: number, maxWidth = PAGE_WIDTH - MARGIN_X * 2) {
  const approxCharWidth = size * 0.52;
  const maxChars = Math.max(24, Math.floor(maxWidth / approxCharWidth));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + " " + word).length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current += " " + word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function createSimplePdf(title: string, lines: PdfLine[]) {
  const pages: string[] = [];
  let current = "";
  let y = PAGE_HEIGHT - MARGIN_TOP;

  const newPage = () => {
    if (current) pages.push(current);
    current = "";
    y = PAGE_HEIGHT - MARGIN_TOP;
  };

  const write = (text: string, size = 10, bold = false) => {
    if (y < MARGIN_BOTTOM) newPage();
    current += `BT /${bold ? "F2" : "F1"} ${size} Tf ${MARGIN_X} ${y} Td (${escapePdfText(text)}) Tj ET\n`;
    y -= Math.max(size + 4, 13);
  };

  write(title, 16, true);
  y -= 6;

  for (const line of lines) {
    const size = line.size ?? 9;
    for (const wrapped of wrapText(line.text, size)) {
      write(wrapped, size, line.bold);
    }
    if (line.gapAfter) y -= line.gapAfter;
  }
  if (current) pages.push(current);

  const objects: string[] = [];
  const addObject = (value: string) => {
    objects.push(value);
    return objects.length;
  };

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const pageIds: number[] = [];
  for (const page of pages) {
    const contentId = addObject(`<< /Length ${Buffer.byteLength(page, "utf8")} >>\nstream\n${page}endstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
