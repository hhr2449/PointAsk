import type { RichContentBlock, RichSelection } from '../shared/local-thread';
import { richPlainText, textBlocks } from '../shared/rich-content';

const ATOM_SELECTOR = '.katex, math, pre, code';
const BLOCK_NODE_SELECTOR = 'p, div, li, blockquote, h1, h2, h3, h4, h5, h6';

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
  const startAtom = findAtom(range.startContainer);
  const endAtom = findAtom(range.endContainer);
  if (startAtom) range.setStartBefore(startAtom);
  if (endAtom) range.setEndAfter(endAtom);
  return range;
}

function pushText(blocks: RichContentBlock[], content: string): void {
  if (!content) return;
  const previous = blocks.at(-1);
  if (previous?.type === 'text') previous.content += content;
  else blocks.push({ type: 'text', content });
}

function serialize(node: Node, blocks: RichContentBlock[]): void {
  if (node.nodeType === Node.TEXT_NODE) { pushText(blocks, node.textContent ?? ''); return; }
  if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return;
  if (node instanceof Element) {
    const isBlock = node.matches(BLOCK_NODE_SELECTOR);
    if (isBlock && blocks.length && blocks.at(-1)?.type !== 'line_break') blocks.push({ type: 'line_break' });
    if (node.matches('.katex, math')) {
      const latex = extractLatex(node);
      if (latex) blocks.push({ type: node.closest('.katex-display, [data-math-style="display"]') || node.getAttribute('display') === 'block' ? 'block_math' : 'inline_math', latex });
      else pushText(blocks, node.getAttribute('aria-label') || node.textContent || '');
      return;
    }
    if (node.matches('pre')) {
      const code = node.querySelector('code') ?? node;
      const language = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9);
      blocks.push({ type: 'code', content: code.textContent ?? '', ...(language ? { language } : {}) });
      return;
    }
    if (node.matches('code')) {
      const language = [...node.classList].find((name) => name.startsWith('language-'))?.slice(9);
      blocks.push({ type: 'code', content: node.textContent ?? '', ...(language ? { language } : {}) });
      return;
    }
    if (node.matches('br')) { blocks.push({ type: 'line_break' }); return; }
  }
  for (const child of node.childNodes) serialize(child, blocks);
}

export function extractRichContent(range: Range): RichSelection {
  try {
    const expanded = expandRangeToRichAtoms(range);
    const blocks: RichContentBlock[] = [];
    serialize(expanded.cloneContents(), blocks);
    const plainText = richPlainText(blocks);
    if (plainText) return { plainText, blocks };
    const fallback = expanded.toString().trim();
    return { plainText: fallback, blocks: textBlocks(fallback) };
  } catch {
    const fallback = range.toString().trim();
    return { plainText: fallback, blocks: textBlocks(fallback) };
  }
}

export function extractElementRichContent(element: HTMLElement): RichSelection {
  const range = document.createRange();
  range.selectNodeContents(element);
  return extractRichContent(range);
}
