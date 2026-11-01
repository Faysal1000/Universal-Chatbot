import type { BlockType } from './api/documentTypes';

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
  table: 'Table',
  formula: 'Formula',
  figure: 'Figure',
  chart: 'Chart',
  caption: 'Caption',
  page_header: 'Page header',
  page_footer: 'Page footer',
};

/** "page_header" → "Page header". */
export function blockTypeLabel(blockType: BlockType): string {
  return BLOCK_TYPE_LABELS[blockType];
}
