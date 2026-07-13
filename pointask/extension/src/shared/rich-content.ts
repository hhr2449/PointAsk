import type { RichContentBlock, RichSelection } from './local-thread';

export function textBlocks(value: string): RichContentBlock[] {
  return value.trim() ? [{ type: 'text', content: value }] : [];
}

const inlineTypes = new Set<RichContentBlock['type']>([
  'text', 'inline_code', 'inline_math', 'strong', 'emphasis', 'strikethrough',
]);

function normalizeSequence(values: RichContentBlock[], nested = false): RichContentBlock[] {
  const result: RichContentBlock[] = [];
  let pendingBreak = false;
  const push = (block: RichContentBlock) => {
    const previous = result.at(-1);
    if (block.type === 'text' && previous?.type === 'text') previous.content += block.content;
    else result.push(block);
  };
  for (const value of values) {
    const block = normalizeBlock(value);
    if (!block) continue;
    if (block.type === 'line_break') { pendingBreak = result.length > 0; continue; }
    if (pendingBreak && nested && result.length && inlineTypes.has(result.at(-1)!.type) && inlineTypes.has(block.type)) push({ type: 'line_break' });
    pendingBreak = false; push(block);
  }
  while (result.at(-1)?.type === 'line_break') result.pop();
  return result;
}

function normalizeBlock(block: RichContentBlock): RichContentBlock | null {
  if (block.type === 'text') return block.content && !/^\s+$/.test(block.content) ? { type: 'text', content: block.content } : null;
  if (block.type === 'inline_code') return block.content ? { type: 'inline_code', content: block.content } : null;
  if (block.type === 'code' || block.type === 'code_block') {
    return block.content ? { type: 'code_block', content: block.content.replace(/^\n|\n$/g, ''), ...(block.language ? { language: block.language } : {}) } : null;
  }
  if (block.type === 'inline_math' || block.type === 'block_math') return block.latex ? block : null;
  if (block.type === 'line_break') return block;
  if (block.type === 'strong' || block.type === 'emphasis' || block.type === 'strikethrough'
    || block.type === 'paragraph' || block.type === 'blockquote' || block.type === 'list_item' || block.type === 'heading' || block.type === 'table_cell') {
    const children = normalizeSequence(block.children, true);
    if (!children.length) return null;
    if (block.type === 'strong' || block.type === 'emphasis' || block.type === 'strikethrough') return { type: block.type, children };
    if (block.type === 'heading') return { type: 'heading', level: block.level, children };
    if (block.type === 'table_cell') return { type: 'table_cell', children, ...(block.header ? { header: true } : {}) };
    return { type: block.type, children };
  }
  if (block.type === 'table') {
    const rows = normalizeSequence(block.rows).filter((item) => item.type === 'table_row');
    return rows.length ? { type: 'table', rows } : null;
  }
  if (block.type === 'table_row') {
    const cells = normalizeSequence(block.cells).filter((item) => item.type === 'table_cell');
    return cells.length ? { type: 'table_row', cells } : null;
  }
  const items = normalizeSequence(block.items).filter((item) => item.type === 'list_item');
  if (!items.length) return null;
  return block.type === 'ordered_list'
    ? { type: 'ordered_list', items, ...(block.start && block.start !== 1 ? { start: block.start } : {}) }
    : { type: 'unordered_list', items };
}

export function normalizeRichContentBlocks(blocks: RichContentBlock[]): RichContentBlock[] {
  const normalized = normalizeSequence(blocks);
  const grouped: RichContentBlock[] = [];
  let inline: RichContentBlock[] = [];
  const flush = () => {
    if (inline.length === 1 && inline[0]?.type === 'text') grouped.push(inline[0]);
    else if (inline.length) grouped.push({ type: 'paragraph', children: normalizeSequence(inline, true) });
    inline = [];
  };
  for (const block of normalized) {
    if (inlineTypes.has(block.type) || block.type === 'line_break') inline.push(block);
    else { flush(); grouped.push(block); }
  }
  flush();
  return grouped.filter((block) => block.type !== 'paragraph' || block.children.length > 0);
}

export function richPlainText(blocks: RichContentBlock[]): string {
  const render = (block: RichContentBlock): string => {
    if (block.type === 'line_break') return '\n';
    if (block.type === 'inline_math' || block.type === 'block_math') return block.latex;
    if (block.type === 'text' || block.type === 'inline_code' || block.type === 'code' || block.type === 'code_block') return block.content;
    if (block.type === 'ordered_list' || block.type === 'unordered_list') return block.items.map(render).join('\n');
    if (block.type === 'table') return block.rows.map(render).join('\n');
    if (block.type === 'table_row') return block.cells.map(render).join('\t');
    return block.children.map(render).join('');
  };
  return normalizeRichContentBlocks(blocks).map(render).join('\n').trim();
}

export function asRichSelection(value: string | RichSelection): RichSelection {
  return typeof value === 'string' ? { plainText: value, blocks: textBlocks(value) } : value;
}

export function normalizeRichBlocks(value: unknown): RichContentBlock[] | null {
  if (typeof value === 'string') return normalizeRichContentBlocks(textBlocks(value));
  if (!Array.isArray(value)) return null;
  const parse = (raw: unknown): RichContentBlock | null => {
    if (!raw || typeof raw !== 'object') return null;
    const block = raw as Record<string, unknown>; const type = block.type;
    if (type === 'line_break') return { type };
    if ((type === 'text' || type === 'inline_code') && typeof block.content === 'string') return { type, content: block.content };
    if ((type === 'code' || type === 'code_block') && typeof block.content === 'string' && (block.language === undefined || typeof block.language === 'string')) {
      return { type, content: block.content, ...(block.language ? { language: block.language as string } : {}) };
    }
    if ((type === 'inline_math' || type === 'block_math') && typeof block.latex === 'string') return { type, latex: block.latex };
    if ((type === 'strong' || type === 'emphasis' || type === 'strikethrough'
      || type === 'paragraph' || type === 'blockquote' || type === 'list_item' || type === 'heading' || type === 'table_cell') && Array.isArray(block.children)) {
      const children = block.children.map(parse); if (children.some((item) => !item)) return null;
      if (type === 'strong' || type === 'emphasis' || type === 'strikethrough') return { type, children: children as RichContentBlock[] };
      if (type === 'heading') return Number.isInteger(block.level) && Number(block.level) >= 1 && Number(block.level) <= 6
        ? { type, level: Number(block.level) as 1 | 2 | 3 | 4 | 5 | 6, children: children as RichContentBlock[] } : null;
      if (type === 'table_cell') return block.header === undefined || typeof block.header === 'boolean'
        ? { type, children: children as RichContentBlock[], ...(block.header ? { header: true } : {}) } : null;
      return { type, children: children as RichContentBlock[] };
    }
    if (type === 'table' && Array.isArray(block.rows)) {
      const rows = block.rows.map(parse); return rows.every((item) => item?.type === 'table_row') ? { type, rows: rows as RichContentBlock[] } : null;
    }
    if (type === 'table_row' && Array.isArray(block.cells)) {
      const cells = block.cells.map(parse); return cells.every((item) => item?.type === 'table_cell') ? { type, cells: cells as RichContentBlock[] } : null;
    }
    if ((type === 'ordered_list' || type === 'unordered_list') && Array.isArray(block.items)) {
      const items = block.items.map(parse); if (items.some((item) => !item)) return null;
      return type === 'ordered_list'
        ? { type, items: items as RichContentBlock[], ...(typeof block.start === 'number' ? { start: block.start } : {}) }
        : { type, items: items as RichContentBlock[] };
    }
    return null;
  };
  const parsed = value.map(parse); if (parsed.some((block) => !block)) return null;
  const normalized = normalizeRichContentBlocks(parsed as RichContentBlock[]);
  return normalized.length ? normalized : null;
}
