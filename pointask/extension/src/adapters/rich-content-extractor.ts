import type { RichContentBlock, RichSelection } from '../shared/local-thread';
import { normalizeRichContentBlocks, richPlainText, textBlocks } from '../shared/rich-content';

// Math is rendered from several nested DOM nodes but represents one semantic
// value. Code is deliberately not atomic: users may select any part of it.
const MATH_ATOM_SELECTOR = '.katex, math';
const RICH_CONTEXT_SELECTOR = 'p, blockquote, ol, ul, li, pre, code, h1, h2, h3, h4, h5, h6, table, th, td';

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
    return element?.closest('.katex-display') ?? element?.closest(MATH_ATOM_SELECTOR);
  };
  const startAtom = findAtom(range.startContainer); const endAtom = findAtom(range.endContainer);
  if (startAtom) range.setStartBefore(startAtom); if (endAtom) range.setEndAfter(endAtom);
  return range;
}

function containsBoundary(element: Element, container: Node): boolean {
  return element === container || element.contains(container);
}

/**
 * Range.cloneContents() intentionally omits a common ancestor. Recreate the
 * semantic ancestor path for selections wholly inside a list, code block,
 * quote, paragraph, etc. so a partial selection remains structured.
 */
function cloneRichContents(range: Range): DocumentFragment {
  const fragment = range.cloneContents();
  const commonElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  if (!commonElement) return fragment;

  const contexts: Element[] = [];
  for (let current: Element | null = commonElement; current; current = current.parentElement) {
    if (current.matches(RICH_CONTEXT_SELECTOR)
      && containsBoundary(current, range.startContainer)
      && containsBoundary(current, range.endContainer)) contexts.push(current);
    if (current.matches('.markdown, [data-message-content]')) break;
  }
  const outermost = contexts.at(-1);
  if (!outermost) return fragment;

  let wrapped: Node = fragment;
  for (let current: Element | null = commonElement; current; current = current.parentElement) {
    const wrapper = current.cloneNode(false) as Element;
    if (wrapper.matches('ol')) {
      const firstSelectedItem = elementFromNode(range.startContainer)?.closest('li');
      if (firstSelectedItem?.parentElement === current) {
        const originalStart = Number(current.getAttribute('start') ?? 1);
        const itemIndex = [...current.children].filter((child) => child.matches('li')).indexOf(firstSelectedItem);
        if (itemIndex > 0) wrapper.setAttribute('start', String(originalStart + itemIndex));
      }
    }
    wrapper.append(wrapped);
    wrapped = wrapper;
    if (current === outermost) break;
  }
  const result = document.createDocumentFragment();
  result.append(wrapped);
  return result;
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
  if (node.matches('strong, b')) return [{ type: 'strong', children: children(node) }];
  if (node.matches('em, i')) return [{ type: 'emphasis', children: children(node) }];
  if (node.matches('del, s')) return [{ type: 'strikethrough', children: children(node) }];
  if (node.matches('p')) return [{ type: 'paragraph', children: children(node) }];
  if (node.matches('blockquote')) return [{ type: 'blockquote', children: children(node) }];
  if (node.matches('ol')) {
    const start = Number(node.getAttribute('start') ?? 1);
    return [{ type: 'ordered_list', items: [...node.children].filter((item) => item.matches('li')).map(listItem), ...(start !== 1 ? { start } : {}) }];
  }
  if (node.matches('ul')) return [{ type: 'unordered_list', items: [...node.children].filter((item) => item.matches('li')).map(listItem) }];
  if (node.matches('li')) return [listItem(node)];
  if (node.matches('table')) return [{ type: 'table', rows: [...node.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')].map((row) => ({
    type: 'table_row', cells: [...row.children].filter((cell) => cell.matches('th, td')).map((cell) => ({
      type: 'table_cell', children: children(cell), ...(cell.matches('th') ? { header: true } : {}),
    })),
  })) }];
  if (node.matches('thead, tbody, tfoot, tr, th, td')) return children(node);
  if (node.matches('br')) return [{ type: 'line_break' }];
  if (node.matches('h1, h2, h3, h4, h5, h6')) return [{ type: 'heading', level: Number(node.tagName.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, children: children(node) }];
  return children(node);
}

export function extractRichContent(range: Range): RichSelection {
  try {
    const expanded = expandRangeToRichAtoms(range);
    const blocks = normalizeRichContentBlocks(extractNode(cloneRichContents(expanded)));
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
