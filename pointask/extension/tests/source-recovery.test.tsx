import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import { PendingThreadManager } from '../src/bridge/pending-thread-manager';
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
});
