import type { SiteAdapter } from '../adapters/site-adapter';
import type { RichSelection, TextAnchor } from '../shared/local-thread';
import { stableTextHash } from '../shared/text-utils';

export const MAX_SELECTION_LENGTH = 8_000;
const POINTASK_HOST_SELECTOR = '[data-pointask-owned="true"]';

export interface SelectionData {
  selectedText: string;
  paragraphText: string;
  assistantMessageText?: string;
  messageFingerprint: string;
  conversationKey: string;
  sourcePageUrl: string;
  rangeRect: DOMRect;
  anchorElement: HTMLElement;
  sourceMessageElement: HTMLElement;
  textAnchor?: TextAnchor;
  richSelection?: RichSelection;
  assistantFingerprintsBefore?: string[];
  /** A snapshot captured on mouseup, before toolbar interaction can collapse the DOM selection. */
  selectionRange?: Range;
}

export type SelectionHandler = (data: SelectionData | null) => void;

function elementFromNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function isEditable(node: Node): boolean {
  const element = elementFromNode(node);
  return element?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') !== null;
}

function isInsidePointAsk(node: Node): boolean {
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) {
    return root.host.matches(POINTASK_HOST_SELECTOR) || root.host.tagName.toLowerCase().startsWith('pointask-');
  }
  return elementFromNode(node)?.closest(POINTASK_HOST_SELECTOR) !== null;
}

function coveredNodes(range: Range): Node[] {
  const root = range.commonAncestorContainer;
  const nodes: Node[] = [root];
  if (root.nodeType === Node.TEXT_NODE) return nodes;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    try {
      if (range.intersectsNode(node)) nodes.push(node);
    } catch {
      // A detached or browser-owned node cannot be trusted as selection input.
    }
  }
  return nodes;
}

function offsetWithin(root: HTMLElement, container: Node, offset: number): number {
  if (container === root || root.contains(container)) {
    try {
      const prefix = document.createRange();
      prefix.selectNodeContents(root);
      prefix.setEnd(container, offset);
      return prefix.toString().length;
    } catch {
      // Fall through to the text walker for unusual browser DOM boundaries.
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === container) return total + offset;
    total += node.textContent?.length ?? 0;
  }
  return total;
}

function nodePath(root: HTMLElement, node: Node): number[] {
  const path: number[] = [];
  let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return [];
    path.unshift([...parent.childNodes].indexOf(current as ChildNode));
    current = parent;
  }
  return current === root ? path : [];
}

export function readSelection(
  adapter: SiteAdapter,
  selection = window.getSelection(),
  captureAssistantContext = true,
): SelectionData | null {
  void captureAssistantContext;
  if (!adapter.isSupportedPage() || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;

  const range = typeof adapter.normalizeSelectionRange === 'function'
    ? adapter.normalizeSelectionRange(selection.getRangeAt(0)) : selection.getRangeAt(0).cloneRange();
  const selectionRange = range.cloneRange();
  const nodes = coveredNodes(range);
  if (nodes.some(isEditable) || nodes.some(isInsidePointAsk)) return null;
  const richSelection = typeof adapter.getRichSelection === 'function'
    ? adapter.getRichSelection(range)
    : (() => {
      const value = range.toString();
      return { plainText: value.trim(), blocks: value.trim() ? [{ type: 'text', content: value }] : [] } as RichSelection;
    })();
  const selectedText = richSelection.plainText.trim();
  if (!selectedText || selectedText.length > MAX_SELECTION_LENGTH) return null;

  const messages = new Set(nodes.map((node) => adapter.findAssistantMessage(node)).filter((message): message is HTMLElement => Boolean(message)));
  const startMessage = adapter.findAssistantMessage(range.startContainer);
  const endMessage = adapter.findAssistantMessage(range.endContainer);
  if (!startMessage || startMessage !== endMessage || messages.size !== 1 || !messages.has(startMessage)) return null;

  const content = adapter.getMessageContent(startMessage);
  if (!content || !content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;

  const paragraphText = adapter.getParagraphText(range);
  const anchorElement = adapter.getAnchorElement(range);
  if (!paragraphText || !anchorElement) return null;

  const assistantMessageText = undefined;
  const messageFingerprint = adapter.getMessageFingerprint(startMessage);
  if (!messageFingerprint) return null;

  const rangeRect = range.getBoundingClientRect();
  const blockText = anchorElement.textContent ?? '';
  const startOffset = offsetWithin(anchorElement, range.startContainer, range.startOffset);
  const endOffset = offsetWithin(anchorElement, range.endContainer, range.endOffset);
  const textAnchor: TextAnchor | undefined = {
    pageUrl: window.location.href,
    sourcePageUrl: window.location.href,
    conversationKey: adapter.getConversationKey(),
    messageFingerprint,
    assistantMessageHash: messageFingerprint,
    selectedText,
    prefixText: blockText.slice(Math.max(0, startOffset - 48), startOffset),
    suffixText: blockText.slice(endOffset, endOffset + 48),
    paragraphText,
    paragraphHash: stableTextHash(paragraphText),
    startOffset,
    endOffset,
    blockIndex: anchorElement.parentElement ? [...anchorElement.parentElement.children].indexOf(anchorElement) : undefined,
    nodePath: nodePath(anchorElement, range.startContainer),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
  };
  return {
    selectedText,
    paragraphText,
    assistantMessageText,
    messageFingerprint,
    conversationKey: adapter.getConversationKey(),
    sourcePageUrl: window.location.href,
    rangeRect,
    anchorElement,
    sourceMessageElement: startMessage,
    textAnchor,
    richSelection,
    assistantFingerprintsBefore: adapter.getAssistantMessageFingerprints(),
    selectionRange,
  };
}

export function hydrateSelectionContext(adapter: SiteAdapter, data: SelectionData): SelectionData | null {
  if (data.messageFingerprint) return data;
  if (!adapter.isAssistantMessage(data.sourceMessageElement)) return null;
  const messageFingerprint = adapter.getMessageFingerprint(data.sourceMessageElement);
  return messageFingerprint ? { ...data, messageFingerprint } : null;
}

export class SelectionManager {
  private cleanupObserver: (() => void) | null = null;
  private started = false;
  private preserveCollapsedSelection = false;
  private readonly onMouseUp = () => queueMicrotask(() => this.emitCurrentSelection());
  private readonly onSelectionChange = () => {
    const selection = window.getSelection();
    if ((!selection || selection.isCollapsed) && !this.preserveCollapsedSelection) this.onSelection(null);
  };
  private readonly onInvalidate = () => this.onSelection(null);

  constructor(
    private readonly adapter: SiteAdapter,
    private readonly onSelection: SelectionHandler,
    private readonly shouldCaptureAssistantContext: () => boolean = () => true,
  ) {}

  start(): void {
    if (this.started || !this.adapter.isSupportedPage()) return;
    this.started = true;
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('selectionchange', this.onSelectionChange);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('scroll', this.onInvalidate, true);
    window.addEventListener('resize', this.onInvalidate);
    this.cleanupObserver = this.adapter.observePageChanges(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) this.onSelection(null);
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('selectionchange', this.onSelectionChange);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('scroll', this.onInvalidate, true);
    window.removeEventListener('resize', this.onInvalidate);
    this.cleanupObserver?.();
    this.cleanupObserver = null;
    this.onSelection(null);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.onSelection(null);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!isInsidePointAsk(event.target as Node)) {
      this.preserveCollapsedSelection = false;
      this.onSelection(null);
      return;
    }
    this.preserveCollapsedSelection = true;
    setTimeout(() => { this.preserveCollapsedSelection = false; }, 0);
  };

  private emitCurrentSelection(): void {
    this.onSelection(readSelection(this.adapter, window.getSelection(), this.shouldCaptureAssistantContext()));
  }
}
