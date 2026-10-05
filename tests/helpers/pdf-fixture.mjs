// Generated fixtures contain only synthetic text; no external documents.
export function pdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const children = [];
  for (const { text, rotation = 0 } of pages) {
    const page = objects.length + 1, stream = page + 1;
    children.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`);
    const content = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${children.join(' ')}] /Count ${pages.length} >>`;
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result).toString('base64');
}

