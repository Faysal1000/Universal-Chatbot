/**
 * Builds a small, valid one-page PDF with real text (a digital page, so rag parses it without
 * a vision model). The text carries a unique marker so every run uploads a new document
 * instead of hitting rag's SHA-256 deduplication.
 */
export function buildSamplePdf(marker: string): Buffer {
  const lines = [
    'Universal Chatbot admin console end-to-end check',
    `Marker ${marker}`,
    'Office hours are 9 am to 5 pm, Sunday to Thursday.',
    'Support requests are answered within two working days.',
  ];
  const textOperations = lines
    .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 20} Td (${line}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(textOperations)} >>\nstream\n${textOperations}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
