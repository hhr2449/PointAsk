import type { RichContentBlock, RichSelection } from './local-thread';

export function textBlocks(value: string): RichContentBlock[] {
  return value.trim() ? [{ type: 'text', content: value }] : [];
}

export function richPlainText(blocks: RichContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'line_break') return '\n';
    if (block.type === 'inline_math' || block.type === 'block_math') return block.latex;
    return block.content;
  }).join('').trim();
}

export function asRichSelection(value: string | RichSelection): RichSelection {
  return typeof value === 'string' ? { plainText: value, blocks: textBlocks(value) } : value;
}

export function normalizeRichBlocks(value: unknown): RichContentBlock[] | null {
  if (typeof value === 'string') return textBlocks(value);
  if (!Array.isArray(value)) return null;
  const blocks: RichContentBlock[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const block = raw as Record<string, unknown>;
    if (block.type === 'line_break') blocks.push({ type: 'line_break' });
    else if (block.type === 'text' && typeof block.content === 'string') blocks.push({ type: 'text', content: block.content });
    else if (block.type === 'code' && typeof block.content === 'string' && (block.language === undefined || typeof block.language === 'string')) {
      blocks.push({ type: 'code', content: block.content, ...(block.language ? { language: block.language } : {}) });
    } else if ((block.type === 'inline_math' || block.type === 'block_math') && typeof block.latex === 'string') {
      blocks.push({ type: block.type, latex: block.latex });
    } else return null;
  }
  return blocks.length ? blocks : null;
}
