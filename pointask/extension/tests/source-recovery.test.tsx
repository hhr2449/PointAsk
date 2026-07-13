import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import { PendingThreadManager } from '../src/bridge/pending-thread-manager';
import type { PendingThread } from '../src/bridge/pending-thread-manager';
import { InlineThreadManager } from '../src/content/inline-thread-manager';
import type { LocalThread, TextAnchor } from '../src/shared/local-thread';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { ThreadStore } from '../src/storage/thread-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const createdAt = '2026-07-12T00:00:00.000Z';
const anchor: TextAnchor = {
  pageUrl: 'https://chatgpt.com/c/source', sourcePageUrl: 'https://chatgpt.com/c/source',
  conversationKey: 'https://chatgpt.com/c/source', messageFingerprint: 'message', assistantMessageHash: 'message',
  selectedText: '来源文字', prefixText: '', suffixText: '', paragraphText: '来源文字所在段落', paragraphHash: 'paragraph',
  startOffset: 0, endOffset: 4, schemaVersion: 1, createdAt,
};
const waiting: LocalThread = {
  displayId: 'PA-001', answerMode: 'dedicated_branch',
  id: 'thread-recovery', anchor, sourcePageUrl: anchor.sourcePageUrl, sourceConversationKey: anchor.conversationKey,
  sourceMessageFingerprint: anchor.messageFingerprint,
  messages: [{ id: 'q1', role: 'user', content: [{ type: 'text', content: '为什么？' }], attachedManually: false, createdAt }],
  status: 'waiting_for_answer', createdAt, updatedAt: createdAt,
};

describe('source card live recovery', () => {
  it('restores two complete rounds once, preserves collapse state, and exposes header shortcuts', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    const restored: LocalThread = { ...waiting, expanded: false, status: 'answer_attached', messages: [
      ...waiting.messages,
      { id: 'a1', role: 'assistant', content: [{ type: 'text', content: '第一答' }], attachedManually: true, createdAt },
      { id: 'q2', role: 'user', content: [{ type: 'text', content: '第二问' }], attachedManually: false, createdAt },
      { id: 'a2', role: 'assistant', content: [{ type: 'text', content: '第二答' }], attachedManually: true, createdAt },
    ] };
    const anchorElement = document.getElementById('anchor') as HTMLElement;
    let firstMount = false; let secondMount = true;
    await act(() => { firstMount = manager.mount(restored, anchorElement); secondMount = manager.mount(restored, anchorElement); });
    expect(firstMount).toBe(true); expect(secondMount).toBe(false);
    expect(document.querySelectorAll('pointask-inline-thread')).toHaveLength(1);
    const shadow = manager.getHost(restored.id)?.shadowRoot;
    expect(shadow?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(shadow?.textContent).toContain('继续追问'); expect(shadow?.textContent).toContain('2 轮');
    expect(shadow?.querySelectorAll('.pointask-primary-action')).toHaveLength(1);
    expect(shadow?.querySelector('.pointask-summary')?.textContent).toContain('为什么？');
  });

  it('replaces an already-mounted waiting card with persisted attached data', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const store = new ThreadStore(new MemoryStorageDriver());
    const manager = new InlineThreadManager(
      new PendingThreadManager(), new ClipboardManager(undefined, () => false), undefined, undefined, undefined, store,
    );
    const anchorElement = document.getElementById('anchor') as HTMLElement;
    await act(() => manager.mount(waiting, anchorElement));
    const attached: LocalThread = {
      ...waiting,
      status: 'answer_attached',
      expanded: false,
      messages: [
        ...waiting.messages,
        { id: 'a1', role: 'assistant', content: [{ type: 'text', content: '用户手动附加的回答' }], answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: 'answer' }, attachedManually: true, createdAt },
      ],
    };
    await store.upsert(attached);
    await act(() => manager.mount(attached, anchorElement));
    const host = manager.getHost(attached.id);
    expect(host?.shadowRoot?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('false');
    await act(() => manager.toggle(attached.id));
    expect(host?.shadowRoot?.textContent).toContain('用户手动附加的回答');
  });

  it('does not guess a fallback position when ChatGPT replaces the source DOM subtree', async () => {
    document.body.innerHTML = '<section id="turn"><p id="anchor">来源段落</p></section><p id="recovery">恢复位置</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    const anchorElement = document.getElementById('anchor') as HTMLElement;
    await act(() => manager.mount(waiting, anchorElement));
    const host = manager.getHost(waiting.id)!;
    document.getElementById('turn')?.remove();
    expect(host.isConnected).toBe(false);
    await act(() => manager.syncVisible(new Set([waiting.id])));
    expect(host.isConnected).toBe(false);
    expect(document.querySelectorAll('pointask-inline-thread')).toHaveLength(0);
    const replacementAnchor = document.createElement('p'); replacementAnchor.textContent = '来源段落';
    document.getElementById('recovery')?.insertAdjacentElement('beforebegin', replacementAnchor);
    await act(() => manager.mount(waiting, replacementAnchor));
    expect(manager.getHost(waiting.id)?.isConnected).toBe(true);
    expect(manager.getHost(waiting.id)?.previousElementSibling).toBe(replacementAnchor);
  });

  it('keeps multiple cards beside the exact source block without reordering them during persistence refresh', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p><p id="after">后续正文</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    const source = document.getElementById('anchor') as HTMLElement;
    const second = { ...waiting, id: 'thread-second', displayId: 'PA-002' };
    await act(() => { manager.mount(waiting, source); manager.mount(second, source); });
    expect([...document.body.children].map((element) => element.id || element.getAttribute('data-pointask-thread-id')))
      .toEqual(['anchor', waiting.id, second.id, 'after']);
    await act(() => manager.mount(waiting, source));
    expect([...document.body.children].map((element) => element.id || element.getAttribute('data-pointask-thread-id')))
      .toEqual(['anchor', waiting.id, second.id, 'after']);
  });

  it('persists independent expanded states and closes only the clicked card', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const store = new ThreadStore(new MemoryStorageDriver());
    const second: LocalThread = { ...waiting, id: 'thread-second', displayId: 'PA-002' };
    await store.upsert(waiting); await store.upsert(second);
    const manager = new InlineThreadManager(
      new PendingThreadManager(), new ClipboardManager(undefined, () => false), undefined, undefined, undefined, store,
    );
    const source = document.getElementById('anchor') as HTMLElement;
    await act(() => { manager.mount(waiting, source); manager.mount(second, source); });
    await act(() => { manager.toggle(waiting.id); manager.toggle(second.id); });

    await vi.waitFor(async () => {
      const stored = await store.listByConversation(anchor.conversationKey);
      expect(stored.filter((thread) => thread.expanded).map((thread) => thread.id).sort()).toEqual([second.id, waiting.id].sort());
    });
    expect(manager.getHost(waiting.id)?.shadowRoot?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(manager.getHost(second.id)?.shadowRoot?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('true');

    await act(() => manager.toggle(waiting.id));
    await vi.waitFor(async () => {
      const stored = await store.listByConversation(anchor.conversationKey);
      expect(stored.filter((thread) => thread.expanded).map((thread) => thread.id)).toEqual([second.id]);
    });
    expect(manager.getHost(waiting.id)?.shadowRoot?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(manager.getHost(second.id)?.shadowRoot?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps current-page attachment on the answer and exposes only navigation from the card header', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    await act(() => manager.mount({ ...waiting, answerMode: 'current_conversation', status: 'answer_ready', expanded: false }, document.getElementById('anchor') as HTMLElement));
    const header = manager.getHost(waiting.id)?.shadowRoot?.querySelector('.pointask-header-actions');
    expect(header?.textContent).toContain('查看新回答');
    expect(header?.textContent).not.toContain('附加');
    expect(manager.getHost(waiting.id)?.shadowRoot?.querySelector('.pointask-thread-body')).toBeNull();
  });

  it('shows only answer progress and navigation on a generating current-conversation card', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    await act(() => manager.mount({ ...waiting, answerMode: 'current_conversation', status: 'generating', expanded: true }, document.getElementById('anchor') as HTMLElement));
    const shadow = manager.getHost(waiting.id)?.shadowRoot;
    expect(shadow?.querySelector('.pointask-header-actions')?.textContent).toContain('查看新回答');
    expect(shadow?.querySelector('.pointask-status')?.textContent).toContain('正在回答');
    expect(shadow?.textContent).not.toContain('一键附加');
  });

  it('renders the more menu in the global fixed overlay and keeps it inside the viewport', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    await act(() => manager.mount({ ...waiting, expanded: true }, document.getElementById('anchor') as HTMLElement));
    const host = manager.getHost(waiting.id)!; const trigger = host.shadowRoot?.querySelector<HTMLButtonElement>('.pointask-more-trigger');
    if (!trigger) throw new Error('Expected the more-menu trigger');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 724, left: 280, right: 312, width: 32, height: 24 } as DOMRect);
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(180);
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(210);
    await act(() => trigger.click());
    const overlays = [...document.querySelectorAll('pointask-thread-menu-overlay')];
    const overlay = overlays.at(-1) as HTMLElement; const menu = overlay.shadowRoot?.querySelector<HTMLElement>('.pointask-more-menu');
    expect(host.shadowRoot?.querySelector('.pointask-more-menu')).toBeNull();
    expect(menu).not.toBeNull();
    expect(menu?.style.position || getComputedStyle(menu!).position).toBe('fixed');
    expect(Number.parseFloat(menu?.style.top ?? '999')).toBeLessThan(700);
    expect(Number.parseFloat(menu?.style.left ?? '-1')).toBeGreaterThanOrEqual(8);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(overlay.shadowRoot?.querySelector('.pointask-more-menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    scrollHeight.mockRestore(); scrollWidth.mockRestore();
  });

  it('expands and highlights the current-conversation card when its answer is attached', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    const current: LocalThread = { ...waiting, answerMode: 'current_conversation', expanded: false };
    await act(() => manager.mount(current, document.getElementById('anchor') as HTMLElement));
    const pendingThread: PendingThread = {
      id: current.id, displayId: current.displayId, answerMode: 'current_conversation', sourcePageUrl: current.sourcePageUrl,
      sourceConversationKey: current.sourceConversationKey, sourceMessageFingerprint: current.sourceMessageFingerprint, anchor,
      question: '为什么？', generatedPrompt: '提示词', promptMode: 'compact', status: 'answer_attached', createdAt, updatedAt: createdAt,
    };
    const attached: LocalThread = { ...current, status: 'answer_attached', messages: [
      ...current.messages,
      { id: 'answer', role: 'assistant', content: [{ type: 'text', content: '新回答' }], attachedManually: true, createdAt },
    ] };
    await act(() => manager.handleAssociationUpdate({ pendingThread, localThread: attached, sourceTabId: 1, targetTabId: 1,
      targetConversationUrl: current.sourcePageUrl, associationStatus: 'associated', createdAt, updatedAt: createdAt }));
    const host = manager.getHost(current.id)!;
    expect(host.shadowRoot?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(host.shadowRoot?.textContent).toContain('新回答');
    expect(host.classList.contains('pointask-thread-highlight')).toBe(true);
  });

  it('reveals the exact source card by thread ID after returning', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    await act(() => manager.mount({ ...waiting, expanded: false }, document.getElementById('anchor') as HTMLElement));
    const host = manager.getHost(waiting.id)!; const scrollIntoView = vi.fn(); Object.defineProperty(host, 'scrollIntoView', { value: scrollIntoView });
    let revealed = false; await act(() => { revealed = manager.reveal(waiting.id); }); expect(revealed).toBe(true);
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' }));
    expect(host.shadowRoot?.querySelector('.pointask-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

});
