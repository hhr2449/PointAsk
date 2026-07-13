import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptAdapter } from '../src/adapters/chatgpt-adapter';
import { PendingAssociationCoordinator } from '../src/background/pending-association-coordinator';
import type { PendingThread } from '../src/bridge/pending-thread-manager';
import { WebConversationBridge } from '../src/bridge/web-conversation-bridge';
import type { PendingAssociation } from '../src/bridge/runtime-messages';
import { AnswerAttachmentMount } from '../src/content/answer-attachment-mount';
import { MAX_ATTACHED_ANSWER_LENGTH } from '../src/components/answer-attachment-confirmation';
import { readSelection, type SelectionData } from '../src/content/selection-manager';
import { SelectionToolbar } from '../src/content/selection-toolbar';
import { PendingBannerManager } from '../src/content/pending-banner-manager';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import { chatGptFixture } from './fixtures/chatgpt';
import { stableTextHash } from '../src/shared/text-utils';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pending = (id = 'pointask-pending-attach'): PendingThread => ({
  displayId: 'PA-001', answerMode: 'dedicated_branch',
  id,
  sourcePageUrl: 'https://chatgpt.com/c/source',
  sourceConversationKey: 'https://chatgpt.com/c/source',
  sourceMessageFingerprint: `fingerprint-${id}`,
  anchor: {
    pageUrl: 'https://chatgpt.com/c/source', prefixText: '', suffixText: '', paragraphHash: `paragraph-${id}`,
    assistantMessageHash: `assistant-${id}`, startOffset: 0, endOffset: 4, schemaVersion: 1, createdAt: '2026-07-12T00:00:00.000Z',
    selectedText: '来源选中文字', paragraphText: '来源段落', messageFingerprint: `fingerprint-${id}`,
    conversationKey: 'https://chatgpt.com/c/source', sourcePageUrl: 'https://chatgpt.com/c/source',
  },
  question: `对应问题-${id}`,
  generatedPrompt: `提示词-${id}`,
  promptMode: 'compact',
  status: 'waiting_for_answer',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
});

function association(id = 'pointask-pending-attach', sourceTab = 1, targetTab = 2) {
  const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
  coordinator.create(pending(id), sourceTab);
  coordinator.markTargetOpened(id, targetTab, 'https://chatgpt.com/c/target');
  coordinator.associate(id, targetTab, 'https://chatgpt.com/c/target');
  return { coordinator, record: coordinator.get(id)! };
}

function selectionData(selectedText = '用户主动选择的回答'): SelectionData {
  const element = document.getElementById('assistant-first') ?? document.body;
  return {
    selectedText,
    paragraphText: '回答段落',
    messageFingerprint: '',
    conversationKey: 'https://chatgpt.com/c/target',
    sourcePageUrl: 'https://chatgpt.com/c/target',
    rangeRect: new DOMRect(10, 10, 90, 20),
    anchorElement: element,
    sourceMessageElement: element,
  };
}

describe('attachment selection entry', () => {
  beforeEach(() => { document.body.innerHTML = chatGptFixture; });

  it('does not show an attachment action without an active pending thread', () => {
    const toolbar = new SelectionToolbar({ onFollowUp: vi.fn(), onAttach: vi.fn() });
    toolbar.show(selectionData());
    expect(document.querySelector('pointask-selection-toolbar')?.shadowRoot?.textContent).not.toContain('附加到 PointAsk');
    toolbar.destroy();
  });

  it('shows an attachment action for the exact active pending thread', () => {
    const toolbar = new SelectionToolbar({ onFollowUp: vi.fn(), onAttach: vi.fn() });
    toolbar.show(selectionData(), [association().record]);
    const host = document.querySelector('pointask-selection-toolbar');
    expect(host?.shadowRoot?.textContent).toContain('附加到 PA-001');
    expect(host?.shadowRoot?.querySelector('.pointask-attach')?.getAttribute('aria-label'))
      .toContain(pending().question);
    toolbar.destroy();
  });

  it('accepts an assistant selection without reading the complete assistant message', () => {
    const adapter = new ChatGptAdapter();
    const getText = vi.spyOn(adapter, 'getMessageText');
    const node = document.getElementById('assistant-first')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 4);
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
    const selection = {
      rangeCount: 1, isCollapsed: false, getRangeAt: () => range, toString: () => range.toString(),
    } as unknown as Selection;
    const result = readSelection(adapter, selection, false);
    expect(result?.selectedText).toBe('第一段脱');
    expect(result?.assistantMessageText).toBeUndefined();
    expect(getText).not.toHaveBeenCalled();
  });
});

describe('manual answer confirmation and storage', () => {
  it('waits for the target composer and sends without a second authorization prompt', async () => {
    const workspace = association('workspace-auto-send').record;
    const promptHash = 'workspace-prompt-hash';
    const record = { ...workspace,
      pendingThread: { ...workspace.pendingThread, answerMode: 'workspace' as const, promptHash },
      localThread: { ...workspace.localThread, answerMode: 'workspace' as const, status: 'waiting_for_submission' as const },
    };
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: record });
    const adapter = new ChatGptAdapter();
    const fillComposer = vi.spyOn(adapter, 'fillComposer').mockReturnValueOnce(false).mockReturnValue(true);
    vi.spyOn(adapter, 'canSubmitComposer').mockReturnValue(true);
    const submitComposer = vi.spyOn(adapter, 'submitComposer').mockReturnValue(true);
    const authorize = vi.fn().mockResolvedValue(false);
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter, { authorize } as never);
    act(() => manager.applyRecord(record));
    const execute = manager as unknown as { fill(id: string, skipAuthorization: boolean): Promise<boolean> };
    let success = false;
    await act(async () => { success = await execute.fill(record.pendingThread.id, true); });
    expect(success).toBe(true);
    expect(fillComposer).toHaveBeenCalledTimes(2);
    expect(submitComposer).toHaveBeenCalledOnce();
    expect(authorize).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:reserve-prompt-submission', pendingThreadId: record.pendingThread.id }));
    act(() => manager.stop());
  });

  it('keeps a current-conversation pending out of generic attachment choices and the top-right banner', () => {
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage: vi.fn() }), new ClipboardManager(undefined, () => false), new ChatGptAdapter());
    const current = association().record;
    act(() => manager.applyRecord({ ...current, pendingThread: { ...current.pendingThread, answerMode: 'current_conversation' },
      localThread: { ...current.localThread, answerMode: 'current_conversation', status: 'waiting_for_answer' } }));
    expect((document.querySelector('pointask-pending-thread-banner') as HTMLElement).style.display).toBe('none');
    expect(manager.getAttachmentAssociations()).toHaveLength(0);
    act(() => manager.stop());
  });

  it('immediately hides the top-right banner after a current-conversation attachment', () => {
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage: vi.fn() }), new ClipboardManager(undefined, () => false), new ChatGptAdapter());
    const current = association().record;
    act(() => manager.applyRecord({ ...current, pendingThread: { ...current.pendingThread, status: 'answer_attached' },
      localThread: { ...current.localThread, answerMode: 'current_conversation', status: 'answer_attached' } }));
    expect((document.querySelector('pointask-pending-thread-banner') as HTMLElement).style.display).toBe('none');
    act(() => manager.stop());
  });

  it('renders a thread-specific action beside the exact current-conversation answer and attaches once before returning', async () => {
    const prompt = '[PointAsk]\n本页面问题';
    document.body.innerHTML = `<article data-testid="conversation-turn-user"><div data-message-author-role="user"><div data-message-content>${prompt}</div></div></article>
      <article data-testid="conversation-turn-answer" data-is-streaming="true"><div data-message-author-role="assistant"><div class="markdown"><p>本页面完整回答</p></div></div></article>`;
    const adapter = new ChatGptAdapter(); const base = association('current-answer', 1, 1).record;
    let current: PendingAssociation = {
      ...base,
      pendingThread: { ...base.pendingThread, answerMode: 'current_conversation' as const, promptHash: stableTextHash(prompt), assistantFingerprintsBefore: [] },
      localThread: { ...base.localThread, displayId: 'PA-004', answerMode: 'current_conversation' as const, status: 'waiting_for_answer' as const },
    };
    const sendMessage = vi.fn().mockImplementation((message: { type: string; fingerprint?: string; richContent?: unknown[] }) => {
      if (message.type === 'pointask:candidate-answer-state') current = {
        ...current,
        pendingThread: { ...current.pendingThread, candidateAnswerFingerprint: message.fingerprint, status: document.querySelector('[data-is-streaming]') ? 'generating' : 'answer_ready' },
        localThread: { ...current.localThread, status: document.querySelector('[data-is-streaming]') ? 'generating' : 'answer_ready' },
      };
      if (message.type === 'pointask:attach-answer') current = {
        ...current,
        pendingThread: { ...current.pendingThread, status: 'answer_attached' },
        localThread: { ...current.localThread, status: 'answer_attached', messages: [
          ...current.localThread.messages,
          { id: 'answer', role: 'assistant' as const, content: message.richContent as never, attachedManually: true, createdAt: current.updatedAt },
        ] },
      };
      return Promise.resolve({ ok: true, data: current });
    });
    const authorize = vi.fn().mockResolvedValue(false);
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter, { authorize } as never);
    const returned = vi.fn().mockReturnValue(true); manager.setReturnToThreadHandler(returned);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    let action = document.querySelector('pointask-current-answer-actions');
    expect(action?.previousElementSibling?.getAttribute('data-testid')).toBe('conversation-turn-answer');
    expect(action?.shadowRoot?.textContent).toContain('附加并返回 PA-004');
    expect(action?.shadowRoot?.querySelector<HTMLButtonElement>('.pointask-primary')?.disabled).toBe(true);

    document.querySelector('[data-is-streaming]')?.removeAttribute('data-is-streaming');
    await act(async () => { (manager as unknown as { refreshCandidates(): void }).refreshCandidates(); await Promise.resolve(); });
    action = document.querySelector('pointask-current-answer-actions');
    const attach = action?.shadowRoot?.querySelector<HTMLButtonElement>('.pointask-primary');
    expect(attach?.disabled).toBe(false);
    await act(async () => { attach?.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'pointask:attach-answer')).toHaveLength(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:attach-answer', pendingThreadId: 'current-answer' }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:pending-thread-updated', pendingThreadId: 'current-answer', action: 'return-source' }));
    expect(returned).toHaveBeenCalledWith('current-answer');
    expect(document.querySelector('pointask-current-answer-actions')).toBeNull();
    expect(document.querySelector('pointask-answer-attachment-confirmation')).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
    act(() => manager.stop());
  });

  it('omits whole-answer attachment when ownership is not reliable', async () => {
    document.body.innerHTML = '<article data-testid="conversation-turn-answer"><div data-message-author-role="assistant"><div class="markdown">候选回答</div></div></article>';
    const adapter = new ChatGptAdapter(); const answer = document.querySelector('article') as HTMLElement;
    const fingerprint = adapter.getMessageFingerprint(answer); const base = association('uncertain-current', 1, 1).record;
    const current = {
      ...base,
      pendingThread: { ...base.pendingThread, answerMode: 'current_conversation' as const, promptHash: 'not-a-match', candidateAnswerFingerprint: fingerprint, status: 'answer_ready' as const },
      localThread: { ...base.localThread, displayId: 'PA-009', answerMode: 'current_conversation' as const, status: 'answer_ready' as const },
    };
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage: vi.fn().mockResolvedValue({ ok: true, data: current }) }),
      new ClipboardManager(undefined, () => false), adapter);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const action = document.querySelector('pointask-current-answer-actions');
    expect(action?.shadowRoot?.textContent).not.toContain('附加并返回');
    expect(action?.shadowRoot?.textContent).toContain('框选部分附加');
    expect(action?.shadowRoot?.textContent).toContain('仅返回原文');
    act(() => manager.stop());
  });

  it('attaches an explicitly selected part to only the requested current thread without confirmation', async () => {
    document.body.innerHTML = '<article data-testid="conversation-turn-answer"><div data-message-author-role="assistant"><div class="markdown"><p id="partial-answer">候选回答的一部分</p></div></div></article>';
    const adapter = new ChatGptAdapter(); const answer = document.querySelector('article') as HTMLElement;
    const fingerprint = adapter.getMessageFingerprint(answer); const base = association('partial-current', 1, 1).record;
    let current: PendingAssociation = {
      ...base,
      pendingThread: { ...base.pendingThread, answerMode: 'current_conversation', promptHash: 'not-a-match', candidateAnswerFingerprint: fingerprint, status: 'answer_ready' },
      localThread: { ...base.localThread, displayId: 'PA-010', answerMode: 'current_conversation', status: 'answer_ready' },
    };
    const sendMessage = vi.fn().mockImplementation((message: { type: string; selectedText?: string }) => {
      if (message.type === 'pointask:attach-answer') current = {
        ...current, pendingThread: { ...current.pendingThread, status: 'answer_attached' },
        localThread: { ...current.localThread, status: 'answer_attached', messages: [
          ...current.localThread.messages,
          { id: 'partial', role: 'assistant', content: [{ type: 'text', content: message.selectedText! }], attachedManually: true, createdAt: current.updatedAt },
        ] },
      };
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const partial = [...(document.querySelector('pointask-current-answer-actions')?.shadowRoot?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent === '框选部分附加');
    await act(() => partial?.click());
    expect(manager.getAttachmentAssociations().map((record) => record.pendingThread.id)).toEqual(['partial-current']);
    const data: SelectionData = {
      selectedText: '候选回答的一部分', paragraphText: '候选回答的一部分', messageFingerprint: fingerprint,
      conversationKey: adapter.getConversationKey(), sourcePageUrl: window.location.href, rangeRect: new DOMRect(),
      anchorElement: document.getElementById('partial-answer')!, sourceMessageElement: answer,
      richSelection: { plainText: '候选回答的一部分', blocks: [{ type: 'text', content: '候选回答的一部分' }] },
    };
    let attached = false;
    await act(async () => { attached = await manager.attachCurrentSelection(data, current); });
    expect(attached).toBe(true);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'pointask:attach-answer')).toHaveLength(1);
    expect(document.querySelector('pointask-answer-attachment-confirmation')).toBeNull();
    expect(document.querySelector('pointask-current-answer-actions')).toBeNull();
    act(() => manager.stop());
  });

  beforeEach(() => { document.body.innerHTML = chatGptFixture; });

  it('cancels without sending an attachment', async () => {
    const sendMessage = vi.fn();
    const mount = new AnswerAttachmentMount(new WebConversationBridge({ sendMessage }));
    const onCancel = vi.fn();
    await act(() => mount.open(selectionData(), association().record, vi.fn(), onCancel));
    const host = document.querySelector('pointask-answer-attachment-confirmation');
    const cancel = [...(host?.shadowRoot?.querySelectorAll('button') ?? [])].find((button) => button.textContent === '取消');
    await act(() => cancel?.click());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('requires confirmation, attaches only selected text, and saves the target URL', async () => {
    const { coordinator, record } = association();
    const selectedText = '仅保存这一段主动选择的回答';
    const sendMessage = vi.fn().mockImplementation((message: { pendingThreadId: string; selectedText: string; replace: boolean }) => {
      const updated = coordinator.attachAnswer(message.pendingThreadId, 2, message.selectedText, 'https://chatgpt.com/c/target-final', message.replace);
      return Promise.resolve({ ok: true, data: updated });
    });
    const onAttached = vi.fn();
    const mount = new AnswerAttachmentMount(new WebConversationBridge({ sendMessage }));
    await act(() => mount.open(selectionData(selectedText), record, onAttached, vi.fn()));
    expect(sendMessage).not.toHaveBeenCalled();
    const confirm = document.querySelector('pointask-answer-attachment-confirmation')?.shadowRoot?.querySelector<HTMLButtonElement>('.pointask-primary');
    await act(async () => { confirm?.click(); await Promise.resolve(); await Promise.resolve(); });
    const saved = coordinator.get(pending().id)?.localThread;
    expect(saved?.messages.at(-1)).toMatchObject({ content: [{ type: 'text', content: selectedText }], role: 'assistant', attachedManually: true });
    expect(saved?.targetConversationUrl).toBe('https://chatgpt.com/c/target-final');
    expect(saved?.status).toBe('answer_attached');
    expect(onAttached).toHaveBeenCalledOnce();
  });

  it('rejects an over-limit answer before mounting confirmation UI', () => {
    const mount = new AnswerAttachmentMount(new WebConversationBridge({ sendMessage: vi.fn() }));
    expect(mount.open(selectionData('答'.repeat(MAX_ATTACHED_ANSWER_LENGTH + 1)), association().record, vi.fn(), vi.fn())).toBe(false);
    expect(document.querySelector('pointask-answer-attachment-confirmation')).toBeNull();
  });

  it('shows a safe error when the background rejects attachment', async () => {
    const bridge = new WebConversationBridge({
      sendMessage: vi.fn().mockResolvedValue({ ok: false, error: '当前页面关联已失效' }),
    });
    const mount = new AnswerAttachmentMount(bridge);
    await act(() => mount.open(selectionData(), association().record, vi.fn(), vi.fn()));
    const host = document.querySelector('pointask-answer-attachment-confirmation');
    const confirm = host?.shadowRoot?.querySelector<HTMLButtonElement>('.pointask-primary');
    await act(async () => { confirm?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host?.shadowRoot?.textContent).toContain('附加失败：当前页面关联已失效');
  });

  it('does not cross two pending threads and requires explicit replacement', () => {
    const first = association('first', 1, 11);
    const second = association('second', 2, 22);
    expect(first.coordinator.attachAnswer('wrong-id', 11, '回答', 'https://chatgpt.com/c/a', false)).toBeNull();
    first.coordinator.attachAnswer('first', 11, '第一版回答', 'https://chatgpt.com/c/a', false);
    expect(first.coordinator.attachAnswer('first', 11, '意外覆盖', 'https://chatgpt.com/c/a', false)).toBeNull();
    const replaced = first.coordinator.attachAnswer('first', 11, '替换回答', 'https://chatgpt.com/c/a', true);
    expect(replaced?.localThread.messages.at(-1)?.content).toEqual([{ type: 'text', content: '替换回答' }]);
    expect(second.coordinator.get('second')?.localThread.messages).toHaveLength(1);
  });
});
