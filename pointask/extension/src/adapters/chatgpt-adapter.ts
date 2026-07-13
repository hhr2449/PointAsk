import type { CandidateAnswer, SiteAdapter } from './site-adapter';
import type { TextAnchor } from '../shared/local-thread';
import { normalizeWhitespace, stableTextHash } from '../shared/text-utils';
import { AnchorResolver, type AnchorResolution } from './anchor-resolver';
import { expandRangeToRichAtoms, extractElementRichContent, extractRichContent } from './rich-content-extractor';
import type { AnswerSourceLocator, RichSelection, WorkspaceContextMessage } from '../shared/local-thread';

const ASSISTANT_ROLE_SELECTOR = '[data-message-author-role="assistant"]';
const MESSAGE_SELECTOR = '[data-testid^="conversation-turn-"]';
const CONTENT_SELECTOR = '.markdown, [data-message-content]';
const BLOCK_SELECTOR = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6';
const STANDALONE_MATH_SELECTOR = '.katex-display, math[display="block"]';
const OBSERVER_DEBOUNCE_MS = 100;
const COMPOSER_SELECTOR = '#prompt-textarea, textarea[data-id="root"], [contenteditable="true"][data-placeholder]';
const SEND_BUTTON_SELECTOR = '[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]';

function elementFromNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function normalizeText(text: string): string {
  return normalizeWhitespace(text);
}

function fingerprint(text: string): string {
  return stableTextHash(text);
}

function mutationIsPointAskOnly(mutation: MutationRecord): boolean {
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.length > 0 && nodes.every((node) => {
    const element = elementFromNode(node);
    return element?.closest('[data-pointask-owned="true"]') !== null ||
      (element instanceof HTMLElement && element.tagName.toLowerCase().startsWith('pointask-'));
  });
}

export class ChatGptAdapter implements SiteAdapter {
  private readonly anchorResolver = new AnchorResolver();
  isSupportedPage(): boolean {
    return window.location.hostname === 'chatgpt.com';
  }

  findAssistantMessage(node: Node): HTMLElement | null {
    const candidate = elementFromNode(node)?.closest(MESSAGE_SELECTOR);
    return candidate instanceof HTMLElement && this.isAssistantMessage(candidate) ? candidate : null;
  }

  isAssistantMessage(element: HTMLElement): boolean {
    if (!element.matches(MESSAGE_SELECTOR)) return false;
    const roles = element.querySelectorAll('[data-message-author-role]');
    return roles.length === 1 && roles[0]?.matches(ASSISTANT_ROLE_SELECTOR) === true;
  }

  getMessageContent(element: HTMLElement): HTMLElement | null {
    if (!this.isAssistantMessage(element)) return null;
    const role = element.querySelector(ASSISTANT_ROLE_SELECTOR);
    const content = role?.querySelector(CONTENT_SELECTOR) ?? role;
    return content instanceof HTMLElement ? content : null;
  }

  getMessageText(element: HTMLElement): string {
    const content = this.getMessageContent(element);
    return content ? normalizeText(content.innerText || content.textContent || '') : '';
  }

  getMessageFingerprint(element: HTMLElement): string {
    if (!this.isAssistantMessage(element)) return '';
    const stableTurnId = element.getAttribute('data-testid') ?? '';
    return stableTurnId ? fingerprint(`${this.getConversationKey()}|${stableTurnId}`) : '';
  }

  getParagraphText(range: Range): string {
    const blocks = this.getSelectedBlocks(range);
    return blocks.length ? blocks.map((block) => extractElementRichContent(block).plainText).join('\n').trim() : '';
  }

  normalizeSelectionRange(range: Range): Range { return expandRangeToRichAtoms(range); }
  getRichSelection(range: Range): RichSelection { return extractRichContent(range); }
  getMessageRichContent(element: HTMLElement): RichSelection {
    const content = this.getMessageContent(element);
    return content ? extractElementRichContent(content) : { plainText: '', blocks: [] };
  }
  getAssistantMessageFingerprints(): string[] {
    return [...document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)].filter((message) => this.isAssistantMessage(message))
      .map((message) => this.getMessageFingerprint(message)).filter(Boolean);
  }
  getConversationContextMessages(): WorkspaceContextMessage[] {
    return [...document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)].flatMap((message) => {
      const roleNode = message.querySelector<HTMLElement>('[data-message-author-role]');
      const role = roleNode?.dataset.messageAuthorRole;
      if (!roleNode || (role !== 'user' && role !== 'assistant')) return [];
      const turnId = message.getAttribute('data-testid');
      if (!turnId) return [];
      const content = roleNode.querySelector<HTMLElement>(CONTENT_SELECTOR) ?? roleNode;
      const text = normalizeText(content.innerText || content.textContent || '');
      if (!text) return [];
      return [{ fingerprint: fingerprint(`${this.getConversationKey()}|${turnId}`), role, content: text } satisfies WorkspaceContextMessage];
    });
  }
  findAssistantMessageByFingerprint(fingerprintValue: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)]
      .find((message) => this.isAssistantMessage(message) && this.getMessageFingerprint(message) === fingerprintValue) ?? null;
  }
  isMessageStreaming(element: HTMLElement): boolean {
    return element.matches('[data-is-streaming="true"], .result-streaming') ||
      element.querySelector('[data-is-streaming="true"], .result-streaming, [data-testid="stop-button"]') !== null;
  }
  fillComposer(prompt: string): boolean {
    const composer = document.querySelector<HTMLElement>(COMPOSER_SELECTOR);
    if (!composer || !prompt.trim()) return false;
    composer.focus({ preventScroll: true });
    if (composer instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(composer, prompt);
    } else {
      composer.textContent = prompt;
    }
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    return composer instanceof HTMLTextAreaElement ? composer.value === prompt : composer.textContent === prompt;
  }
  canSubmitComposer(): boolean {
    const button = document.querySelector<HTMLButtonElement>(SEND_BUTTON_SELECTOR);
    return Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  }
  submitComposer(): boolean {
    const button = document.querySelector<HTMLButtonElement>(SEND_BUTTON_SELECTOR);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click();
    return true;
  }
  findCandidateAnswer(promptHash: string, assistantFingerprintsBefore: string[]): CandidateAnswer | null {
    if (!promptHash) return null;
    const baseline = new Set(assistantFingerprintsBefore);
    const turns = [...document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)];
    const candidates: CandidateAnswer[] = [];
    for (let index = 1; index < turns.length; index++) {
      const message = turns[index]!;
      if (!this.isAssistantMessage(message)) continue;
      const messageFingerprint = this.getMessageFingerprint(message);
      if (!messageFingerprint || baseline.has(messageFingerprint)) continue;
      const previous = turns[index - 1]!;
      const userRole = previous.querySelector('[data-message-author-role="user"]');
      const userContent = userRole?.querySelector(CONTENT_SELECTOR) ?? userRole;
      const userText = normalizeText((userContent as HTMLElement | null)?.innerText || userContent?.textContent || '');
      if (!userText || stableTextHash(userText) !== promptHash) continue;
      candidates.push({
        element: message,
        fingerprint: messageFingerprint,
        streaming: this.isMessageStreaming(message) || (index === turns.length - 1 && document.querySelector('[data-testid="stop-button"]') !== null),
      });
    }
    return candidates.length === 1 ? candidates[0]! : null;
  }
  resolveAnswerSource(locator: AnswerSourceLocator): HTMLElement | null {
    const exact = this.findAssistantMessageByFingerprint(locator.messageFingerprint);
    if (exact) return exact;
    if (!locator.selectedText) return null;
    const matches = [...document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)].filter((message) => {
      if (!this.isAssistantMessage(message)) return false;
      const text = this.getMessageRichContent(message).plainText;
      return text.includes(locator.selectedText!) && (!locator.prefixText || text.includes(locator.prefixText)) &&
        (!locator.suffixText || text.includes(locator.suffixText));
    });
    return matches.length === 1 ? matches[0]! : null;
  }
  getRecoveryMountElement(): HTMLElement | null {
    for (const message of document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)) {
      if (this.isAssistantMessage(message)) return this.getMessageContent(message) ?? message;
    }
    return document.body;
  }
  getScrollContainer(element: HTMLElement): HTMLElement | Window {
    for (let current = element.parentElement; current && current !== document.body; current = current.parentElement) {
      const overflowY = getComputedStyle(current).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return current;
    }
    return window;
  }

  getAnchorElement(range: Range): HTMLElement | null {
    return this.getSelectedBlocks(range)[0] ?? null;
  }

  private getSelectedBlocks(range: Range): HTMLElement[] {
    const selectedBlock = (node: Node) => elementFromNode(node)?.closest(BLOCK_SELECTOR) ?? elementFromNode(node)?.closest(STANDALONE_MATH_SELECTOR);
    const start = selectedBlock(range.startContainer);
    const end = selectedBlock(range.endContainer);
    if (!(start instanceof HTMLElement) || !(end instanceof HTMLElement)) return [];
    if (start === end) return [start];
    const startContent = start.closest(CONTENT_SELECTOR);
    const endContent = end.closest(CONTENT_SELECTOR);
    if (!startContent || startContent !== endContent) return [];
    const blocks = [...startContent.querySelectorAll<HTMLElement>(`${BLOCK_SELECTOR}, ${STANDALONE_MATH_SELECTOR}`)]
      .filter((block) => !block.parentElement?.closest(BLOCK_SELECTOR));
    const startIndex = blocks.indexOf(start);
    const endIndex = blocks.indexOf(end);
    return startIndex >= 0 && endIndex >= startIndex ? blocks.slice(startIndex, endIndex + 1) : [];
  }

  resolveTextAnchor(anchor: TextAnchor, pageReady = true): AnchorResolution {
    const messages = document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR);
    const candidates = [];
    for (const message of messages) {
      if (!this.isAssistantMessage(message)) continue;
      const content = this.getMessageContent(message);
      if (!content) continue;
      const messageFingerprint = this.getMessageFingerprint(message);
      candidates.push({
        messageFingerprint,
        assistantMessageHash: messageFingerprint,
        blocks: (() => {
          const blocks = [...content.querySelectorAll<HTMLElement>(`${BLOCK_SELECTOR}, ${STANDALONE_MATH_SELECTOR}`)]
            .filter((block) => !block.parentElement?.closest(BLOCK_SELECTOR));
          const candidates = blocks.map((element, blockIndex) => ({
            element, blockIndex, text: element.innerText || element.textContent || '',
          }));
          for (let start = 0; start < blocks.length; start++) {
            for (let end = start + 1; end < Math.min(blocks.length, start + 6); end++) {
              candidates.push({
                element: blocks[start]!,
                blockIndex: start,
                text: blocks.slice(start, end + 1).map((block) => block.innerText || block.textContent || '').join('\n'),
              });
            }
          }
          return candidates;
        })(),
      });
    }
    return this.anchorResolver.resolve(anchor, candidates, pageReady);
  }

  getConversationKey(): string {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    return `${window.location.origin}${path}`;
  }

  observePageChanges(callback: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver((mutations) => {
      if (mutations.every(mutationIsPointAskOnly)) return;
      clearTimeout(timer);
      timer = setTimeout(callback, OBSERVER_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }
}
