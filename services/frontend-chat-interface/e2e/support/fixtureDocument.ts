/**
 * A one-page text PDF with facts that exist nowhere else in the corpus, so a question about them is answered
 * from (and cites) this document. Built in code to keep binary files out of the repository.
 */
export const FIXTURE_DOCUMENT_TITLE = 'Chat e2e fixture: Orion Lighthouse visitor guide';
export const FIXTURE_FILE_NAME = 'orion-lighthouse-visitor-guide.pdf';
export const FIXTURE_QUESTION = 'What time does the Orion Lighthouse visitor centre open?';

const FIXTURE_LINES = [
  'Orion Lighthouse Visitor Guide',
  '',
  'Opening hours: the Orion Lighthouse visitor centre opens at 08:15 every day',
  'and closes at 18:45. On public holidays it opens at 10:00.',
  '',
  'Guided tours: a guided tour of the Orion Lighthouse costs 450 taka per person.',
  'Children under twelve join the tour free of charge.',
  '',
  'Keeper: the current keeper of the Orion Lighthouse is Rahela Karim.',
];

function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

/** Serialises PDF objects with a correct cross-reference table. */
function assemblePdf(objects: readonly string[]): Uint8Array<ArrayBuffer> {
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function buildFixturePdf(): Uint8Array<ArrayBuffer> {
  const textOperations = FIXTURE_LINES.map((line) => `(${escapePdfText(line)}) Tj T*`).join('\n');
  const content = `BT\n/F1 12 Tf\n16 TL\n72 760 Td\n${textOperations}\nET`;
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}
