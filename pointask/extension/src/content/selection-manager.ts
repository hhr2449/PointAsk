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

function offsetWithin(root: HTMLElement, container: Node, offset: number): number {
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

  const rawSelectedText = selection.toString().trim();
  if (rawSelectedText.length > MAX_SELECTION_LENGTH) return null;
  const range = typeof adapter.normalizeSelectionRange === 'function'
    ? adapter.normalizeSelectionRange(selection.getRangeAt(0)) : selection.getRangeAt(0).cloneRange();
  const richSelection = typeof adapter.getRichSelection === 'function'
    ? adapter.getRichSelection(range)
    : { plainText: rawSelectedText, blocks: rawSelectedText ? [{ type: 'text', content: rawSelectedText }] : [] } as RichSelection;
  const selectedText = richSelection.plainText.trim();
  if (!selectedText || selectedText.length > MAX_SELECTION_LENGTH) return null;
  if (isEditable(range.startContainer) || isEditable(range.endContainer)) return null;
  if (isInsidePointAsk(range.startContainer) || isInsidePointAsk(range.endContainer)) return null;

  const startMessage = adapter.findAssistantMessage(range.startContainer);
  const endMessage = adapter.findAssistantMessage(range.endContainer);
  if (!startMessage || startMessage !== endMessage) return null;

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
  private readonly onMouseUp = () => queueMicrotask(() => this.emitCurrentSelection());
  private readonly onSelectionChange = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) this.onSelection(null);
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
    if (!isInsidePointAsk(event.target as Node)) this.onSelection(null);
  };

  private emitCurrentSelection(): void {
    this.onSelection(readSelection(this.adapter, window.getSelection(), this.shouldCaptureAssistantContext()));
  }
}
