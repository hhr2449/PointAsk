import type { RichContentBlock, RichSelection } from '../shared/local-thread';
import { normalizeRichContentBlocks, richPlainText, textBlocks } from '../shared/rich-content';

const ATOM_SELECTOR = '.katex, math, pre, code';

function elementFromNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

export function extractLatex(element: Element): string {
  return element.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    || element.getAttribute('data-latex')?.trim()
    || element.getAttribute('aria-label')?.trim()
    || '';
}

export function expandRangeToRichAtoms(input: Range): Range {
  const range = input.cloneRange();
  const findAtom = (node: Node) => {
    const element = elementFromNode(node);
    return element?.closest('.katex-display') ?? element?.closest(ATOM_SELECTOR);
  };
  const startAtom = findAtom(range.startContainer); const endAtom = findAtom(range.endContainer);
  if (startAtom) range.setStartBefore(startAtom); if (endAtom) range.setEndAfter(endAtom);
  return range;
}

function children(element: Element | DocumentFragment): RichContentBlock[] {
  return [...element.childNodes].flatMap(extractNode);
}

function listItem(element: Element): RichContentBlock {
  return { type: 'list_item', children: children(element) };
}

function extractNode(node: Node): RichContentBlock[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const content = node.textContent ?? '';
    return !content || /^\s+$/.test(content) ? [] : [{ type: 'text', content }];
  }
  if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return [];
  if (node instanceof DocumentFragment) return children(node);
  if (node.matches('.katex, math')) {
    const latex = extractLatex(node);
    if (!latex) return node.textContent?.trim() ? [{ type: 'text', content: node.textContent.trim() }] : [];
    return [{ type: node.closest('.katex-display, [data-math-style="display"]') || node.getAttribute('display') === 'block' ? 'block_math' : 'inline_math', latex }];
  }
  if (node.matches('pre')) {
    const code = node.querySelector('code') ?? node;
    const language = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9);
    return [{ type: 'code_block', content: code.textContent ?? '', ...(language ? { language } : {}) }];
  }
  if (node.matches('code')) return [{ type: 'inline_code', content: node.textContent ?? '' }];
  if (node.matches('p')) return [{ type: 'paragraph', children: children(node) }];
  if (node.matches('blockquote')) return [{ type: 'blockquote', children: children(node) }];
  if (node.matches('ol')) {
    const start = Number(node.getAttribute('start') ?? 1);
    return [{ type: 'ordered_list', items: [...node.children].filter((item) => item.matches('li')).map(listItem), ...(start !== 1 ? { start } : {}) }];
  }
  if (node.matches('ul')) return [{ type: 'unordered_list', items: [...node.children].filter((item) => item.matches('li')).map(listItem) }];
  if (node.matches('li')) return [listItem(node)];
  if (node.matches('br')) return [{ type: 'line_break' }];
  if (node.matches('h1, h2, h3, h4, h5, h6')) return [{ type: 'paragraph', children: children(node) }];
  return children(node);
}

export function extractRichContent(range: Range): RichSelection {
  try {
    const expanded = expandRangeToRichAtoms(range);
    const blocks = normalizeRichContentBlocks(extractNode(expanded.cloneContents()));
    const plainText = richPlainText(blocks);
    if (plainText) return { plainText, blocks };
    const fallback = expanded.toString().trim(); return { plainText: fallback, blocks: textBlocks(fallback) };
  } catch {
    const fallback = range.toString().trim(); return { plainText: fallback, blocks: textBlocks(fallback) };
  }
}

export function extractElementRichContent(element: HTMLElement): RichSelection {
  const range = document.createRange(); range.selectNodeContents(element); return extractRichContent(range);
}
