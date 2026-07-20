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
  it('waits for the target composer and sends only after the explicit target-page action is authorized', async () => {
    const workspace = association('workspace-auto-send').record;
    const promptHash = 'workspace-prompt-hash';
    const record = { ...workspace,
      pendingThread: { ...workspace.pendingThread, answerMode: 'workspace' as const, promptHash },
      localThread: { ...workspace.localThread, answerMode: 'workspace' as const, status: 'waiting_for_submission' as const },
    };
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: record });
    const adapter = new ChatGptAdapter();
    vi.spyOn(adapter, 'waitForComposerReady').mockResolvedValue(true);
    vi.spyOn(adapter, 'waitForSubmitReady').mockResolvedValue(true);
    const fillComposer = vi.spyOn(adapter, 'fillComposer').mockReturnValue(true);
    const submitComposer = vi.spyOn(adapter, 'submitComposer').mockReturnValue(true);
    const hasSubmittedPrompt = vi.spyOn(adapter, 'hasSubmittedPrompt').mockReturnValueOnce(false).mockReturnValue(true);
    const authorize = vi.fn().mockResolvedValue(true);
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter, { authorize } as never);
    act(() => manager.applyRecord(record));
    expect(document.querySelector('pointask-pending-thread-banner')?.shadowRoot?.textContent)
      .toContain('发送追问');
    expect(fillComposer).not.toHaveBeenCalled();
    expect(submitComposer).not.toHaveBeenCalled();
    const execute = manager as unknown as { fill(id: string): Promise<boolean> };
    let success = false;
    await act(async () => { success = await execute.fill(record.pendingThread.id); });
    expect(success).toBe(true);
    expect(fillComposer).toHaveBeenCalledOnce();
    expect(submitComposer).toHaveBeenCalledOnce();
    expect(hasSubmittedPrompt).toHaveBeenCalledWith(promptHash);
    expect(authorize).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:reserve-prompt-submission', pendingThreadId: record.pendingThread.id }));
    act(() => manager.stop());
  });

  it('coalesces consecutive send attempts so the target button is clicked once', async () => {
    const workspace = association('workspace-double-click').record;
    const promptHash = 'workspace-double-click-hash';
    const record = { ...workspace,
      pendingThread: { ...workspace.pendingThread, answerMode: 'workspace' as const, promptHash },
      localThread: { ...workspace.localThread, answerMode: 'workspace' as const, status: 'waiting_for_submission' as const },
    };
    let releaseReady: (ready: boolean) => void = () => undefined;
    const ready = new Promise<boolean>((resolve) => { releaseReady = resolve; });
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: record });
    const adapter = new ChatGptAdapter();
    vi.spyOn(adapter, 'waitForComposerReady').mockReturnValue(ready);
    vi.spyOn(adapter, 'waitForSubmitReady').mockResolvedValue(true);
    vi.spyOn(adapter, 'fillComposer').mockReturnValue(true);
    const submitComposer = vi.spyOn(adapter, 'submitComposer').mockReturnValue(true);
    vi.spyOn(adapter, 'hasSubmittedPrompt').mockReturnValueOnce(false).mockReturnValue(true);
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter);
    act(() => manager.applyRecord(record));
    const execute = manager as unknown as { fill(id: string): Promise<boolean> };
    await act(async () => {
      const first = execute.fill(record.pendingThread.id);
      const second = execute.fill(record.pendingThread.id);
      expect(await second).toBe(false);
      releaseReady(true);
      expect(await first).toBe(true);
    });
    expect(submitComposer).toHaveBeenCalledOnce();
    act(() => manager.stop());
  });

  it('does not reserve a submission when clicking produced no rendered user turn', async () => {
    vi.useFakeTimers();
    const workspace = association('workspace-editor-error').record;
    const record = { ...workspace,
      pendingThread: { ...workspace.pendingThread, answerMode: 'workspace' as const, promptHash: 'editor-error-hash' },
      localThread: { ...workspace.localThread, answerMode: 'workspace' as const, status: 'waiting_for_submission' as const },
    };
    const runtime = {
      sendMessage: vi.fn().mockImplementation((message: { type?: string }) => Promise.resolve({
        ok: true, data: message.type === 'pointask:get-page-pending-threads' ? [] : record,
      })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const adapter = new ChatGptAdapter();
    vi.spyOn(adapter, 'waitForComposerReady').mockResolvedValue(true);
    vi.spyOn(adapter, 'waitForSubmitReady').mockResolvedValue(true);
    vi.spyOn(adapter, 'fillComposer').mockReturnValue(true);
    vi.spyOn(adapter, 'canSubmitComposer').mockReturnValue(true);
    vi.spyOn(adapter, 'submitComposer').mockReturnValue(true);
    vi.spyOn(adapter, 'hasSubmittedPrompt').mockReturnValue(false);
    const manager = new PendingBannerManager(new WebConversationBridge(runtime), new ClipboardManager(undefined, () => false), adapter);
    act(() => manager.applyRecord(record));
    const execute = manager as unknown as { fill(id: string): Promise<boolean> };
    let success = true;
    await act(async () => {
      const sending = execute.fill(record.pendingThread.id);
      await vi.advanceTimersByTimeAsync(15_100);
      success = await sending;
    });
    expect(success).toBe(false);
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:reserve-prompt-submission' }));
    act(() => manager.stop());
    vi.useRealTimers();
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

  it('attaches a staged Workspace answer after its older DOM node has been unloaded', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter();
    const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer);
    const base = association('workspace-attach-return').record;
    let current: PendingAssociation = {
      ...base,
      pendingThread: { ...base.pendingThread, roundId: base.localThread.messages[0]!.id, answerMode: 'workspace', promptHash: 'workspace-hash', status: 'answer_ready' },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', rounds: [{
        id: base.localThread.messages[0]!.id, pendingId: base.pendingThread.id, promptHash: 'workspace-hash', assistantFingerprintsBefore: [],
        status: 'answer_ready', persistenceStatus: 'staged', stagedAnswer: [{ type: 'paragraph', children: [{ type: 'text', content: '唯一匹配回答' }] }],
        answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: fingerprint },
        createdAt: base.createdAt, updatedAt: base.updatedAt,
      }] },
    };
    answer.remove();
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue(null);
    const extract = vi.spyOn(adapter, 'getMessageRichContent');
    const calls: string[] = [];
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) => {
      calls.push(message.type);
      if (message.type === 'pointask:attach-rounds') current = {
        ...current,
        pendingThread: { ...current.pendingThread, status: 'answer_attached' },
        localThread: { ...current.localThread, status: 'answer_attached', rounds: current.localThread.rounds?.map((round) => ({
          ...round, status: 'attached' as const, persistenceStatus: 'attached' as const, stagedAnswer: undefined, attachedAt: current.updatedAt,
        })), messages: [
          ...current.localThread.messages,
          { id: 'workspace-answer', role: 'assistant' as const, content: [{ type: 'text' as const, content: '唯一匹配回答' }], attachedManually: true, createdAt: current.updatedAt },
        ] },
      };
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter,
      { authorize: vi.fn().mockResolvedValue(true) } as never);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const banner = document.querySelector('pointask-pending-thread-banner')?.shadowRoot;
    expect(banner?.textContent).toContain('附加本轮并返回');
    const attachAndReturn = manager as unknown as { attachWorkspaceAnswer(id: string, returnAfter: boolean): Promise<boolean> };
    await act(async () => { await attachAndReturn.attachWorkspaceAnswer('workspace-attach-return', true); });
    expect(calls.indexOf('pointask:attach-rounds')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('pointask:pending-thread-updated')).toBeGreaterThan(calls.indexOf('pointask:attach-rounds'));
    expect(extract).not.toHaveBeenCalled();
    act(() => manager.stop());
  });

  it('does not return when Attach-and-return fails', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter();
    const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer); const base = association('workspace-attach-failure').record;
    const current: PendingAssociation = {
      ...base,
      pendingThread: { ...base.pendingThread, roundId: base.localThread.messages[0]!.id, answerMode: 'workspace', promptHash: 'workspace-hash', status: 'answer_ready' },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', rounds: [{
        id: base.localThread.messages[0]!.id, pendingId: base.pendingThread.id, promptHash: 'workspace-hash', assistantFingerprintsBefore: [],
        status: 'answer_ready', persistenceStatus: 'staged', stagedAnswer: [{ type: 'text', content: '回答' }],
        answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: fingerprint },
        createdAt: base.createdAt, updatedAt: base.updatedAt,
      }] },
    };
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue({ element: answer, fingerprint, streaming: false });
    vi.spyOn(adapter, 'getMessageRichContent').mockReturnValue({ plainText: '回答', blocks: [{ type: 'text', content: '回答' }] });
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) => Promise.resolve(message.type === 'pointask:attach-rounds'
      ? { ok: false, error: '附加失败，请重试' } : { ok: true, data: current }));
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter,
      { authorize: vi.fn().mockResolvedValue(true) } as never);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const attachAndReturn = manager as unknown as { attachWorkspaceAnswer(id: string, returnAfter: boolean): Promise<boolean> };
    await act(async () => { await attachAndReturn.attachWorkspaceAnswer('workspace-attach-failure', true); });
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'pointask:pending-thread-updated', action: 'return-source',
    }));
    expect(document.querySelector('pointask-pending-thread-banner')?.shadowRoot?.textContent).toContain('附加失败，请重试');
    act(() => manager.stop());
  });

  it('submits only selected reliable rounds and excludes a disabled ambiguous round from the payload', async () => {
    document.body.innerHTML = '<article id="answer-two"></article><article id="answer-three"></article>';
    const adapter = new ChatGptAdapter();
    const answerTwo = document.getElementById('answer-two')!; const answerThree = document.getElementById('answer-three')!;
    const base = association('workspace-selected-rounds').record;
    let current: PendingAssociation = {
      ...base,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId: 'q3', answerMode: 'workspace',
        promptHash: 'hash-3', status: 'answer_ready' },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', messages: ['q1', 'q2', 'q3'].map((id) => ({
        id, role: 'user' as const, content: [{ type: 'text' as const, content: `问题-${id}` }], attachedManually: false, createdAt: base.createdAt,
      })), rounds: ['q1', 'q2', 'q3'].map((id, index) => ({ id, pendingId: `pending-${id}`, promptHash: `hash-${index + 1}`,
        assistantFingerprintsBefore: [], status: 'answer_ready' as const, persistenceStatus: id === 'q1' ? 'not_captured' as const : 'staged' as const,
        stagedAnswer: id === 'q1' ? undefined : [{ type: 'text' as const, content: `回答-${id}` }],
        answerSource: id === 'q1' ? undefined : { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: `answer-${id.slice(1)}` },
        createdAt: base.createdAt, updatedAt: base.updatedAt })) },
    };
    vi.spyOn(adapter, 'findCandidateAnswer').mockImplementation((hash) => hash === 'hash-2'
      ? { element: answerTwo, fingerprint: 'answer-2', streaming: false }
      : hash === 'hash-3' ? { element: answerThree, fingerprint: 'answer-3', streaming: false } : null);
    vi.spyOn(adapter, 'getMessageRichContent').mockImplementation((element) => ({ plainText: element === answerTwo ? '回答二' : '回答三',
      blocks: [{ type: 'text', content: element === answerTwo ? '回答二' : '回答三' }] }));
    const attachMessages: Array<{ rounds: Array<{ roundId: string }> }> = [];
    const sendMessage = vi.fn().mockImplementation((message: { type: string; rounds?: Array<{ roundId: string }> }) => {
      if (message.type === 'pointask:attach-rounds') {
        attachMessages.push(message as { rounds: Array<{ roundId: string }> });
        const ids = new Set(message.rounds?.map((round) => round.roundId));
        current = { ...current, pendingThread: { ...current.pendingThread, status: 'answer_attached' }, localThread: {
          ...current.localThread, status: 'answer_attached', rounds: current.localThread.rounds?.map((round) => ids.has(round.id)
            ? { ...round, status: 'attached' as const, persistenceStatus: 'attached' as const, stagedAnswer: undefined, attachedAt: base.updatedAt } : round),
        } };
      }
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter,
      { authorize: vi.fn().mockResolvedValue(true) } as never);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { attachWorkspaceRounds(id: string, ids: string[]): Promise<boolean> };
    let saved = false;
    await act(async () => { saved = await internal.attachWorkspaceRounds('workspace-selected-rounds', ['q1', 'q2', 'q3']); });
    expect(saved).toBe(true);
    expect(attachMessages).toHaveLength(1);
    expect(attachMessages[0]!.rounds.map((round) => round.roundId)).toEqual(['q2', 'q3']);
    expect(current.localThread.rounds?.filter((round) => ['q2', 'q3'].includes(round.id)).every((round) =>
      round.persistenceStatus === 'attached' && round.stagedAnswer === undefined)).toBe(true);
    act(() => manager.stop());
  });

  it('skips an invalid staged round without blocking another selected staged round', async () => {
    document.body.innerHTML = '<article id="answer-two"></article><article id="answer-three"></article>';
    const adapter = new ChatGptAdapter();
    const answerTwo = document.getElementById('answer-two')!; const answerThree = document.getElementById('answer-three')!;
    const base = association('workspace-missing-rich-content').record;
    const current: PendingAssociation = { ...base,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId: 'q3', answerMode: 'workspace', promptHash: 'hash-3', status: 'answer_ready' },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', messages: ['q2', 'q3'].map((id) => ({
        id, role: 'user' as const, content: [{ type: 'text' as const, content: `问题-${id}` }], attachedManually: false, createdAt: base.createdAt,
      })), rounds: ['q2', 'q3'].map((id) => ({ id, pendingId: `pending-${id}`, promptHash: `hash-${id.slice(1)}`,
        assistantFingerprintsBefore: [], status: 'answer_ready' as const, persistenceStatus: 'staged' as const,
        stagedAnswer: id === 'q3' ? [] : [{ type: 'text' as const, content: `回答-${id}` }],
        answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: `answer-${id.slice(1)}` },
        createdAt: base.createdAt, updatedAt: base.updatedAt })) } };
    vi.spyOn(adapter, 'findCandidateAnswer').mockImplementation((hash) => hash === 'hash-2'
      ? { element: answerTwo, fingerprint: 'answer-2', streaming: false }
      : { element: answerThree, fingerprint: 'answer-3', streaming: false });
    vi.spyOn(adapter, 'getMessageRichContent').mockImplementation((element) => element === answerTwo
      ? { plainText: '回答二', blocks: [{ type: 'text', content: '回答二' }] }
      : { plainText: '', blocks: [] });
    let updated = current;
    const sendMessage = vi.fn().mockImplementation((message: { type: string; rounds?: Array<{ roundId: string }> }) => {
      if (message.type === 'pointask:attach-rounds') {
        const ids = new Set(message.rounds?.map((round) => round.roundId));
        updated = { ...updated, localThread: { ...updated.localThread, rounds: updated.localThread.rounds?.map((round) => ids.has(round.id)
          ? { ...round, status: 'attached' as const, persistenceStatus: 'attached' as const, stagedAnswer: undefined } : round) } };
      }
      return Promise.resolve({ ok: true, data: updated });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter,
      { authorize: vi.fn().mockResolvedValue(true) } as never);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { attachWorkspaceRounds(id: string, ids: string[]): Promise<boolean> };
    await act(async () => { await internal.attachWorkspaceRounds('workspace-missing-rich-content', ['q2', 'q3']); });
    const attach = sendMessage.mock.calls.map(([message]) => message).find((message) => message.type === 'pointask:attach-rounds');
    expect(attach?.rounds.map((round: { roundId: string }) => round.roundId)).toEqual(['q2']);
    expect(updated.localThread.rounds?.find((round) => round.id === 'q3')?.persistenceStatus).toBe('staged');
    act(() => manager.stop());
  });

  it('keeps a successful attachment when navigation fails and retry return never attaches again', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter(); const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer); const base = association('workspace-return-after-save').record;
    let current: PendingAssociation = { ...base,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId: base.localThread.messages[0]!.id,
        answerMode: 'workspace', promptHash: 'workspace-return-hash', status: 'answer_ready' },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', rounds: [{
        id: base.localThread.messages[0]!.id, pendingId: base.pendingThread.id, promptHash: 'workspace-return-hash', assistantFingerprintsBefore: [],
        status: 'answer_ready', persistenceStatus: 'staged', stagedAnswer: [{ type: 'text', content: '已保存回答' }],
        answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: fingerprint },
        createdAt: base.createdAt, updatedAt: base.updatedAt,
      }] } };
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue({ element: answer, fingerprint, streaming: false });
    vi.spyOn(adapter, 'getMessageRichContent').mockReturnValue({ plainText: '已保存回答', blocks: [{ type: 'text', content: '已保存回答' }] });
    let returnAttempts = 0;
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) => {
      if (message.type === 'pointask:attach-rounds') current = { ...current,
        pendingThread: { ...current.pendingThread, status: 'answer_attached' },
        localThread: { ...current.localThread, status: 'answer_attached', rounds: current.localThread.rounds?.map((round) => ({
          ...round, status: 'attached' as const, persistenceStatus: 'attached' as const, stagedAnswer: undefined, attachedAt: current.updatedAt,
        })), messages: [...current.localThread.messages, {
          id: 'answer-saved', roundId: current.localThread.messages[0]!.id, role: 'assistant' as const,
          content: [{ type: 'text' as const, content: '已保存回答' }], attachedManually: true, attachedAt: current.updatedAt, createdAt: current.updatedAt,
        }] } };
      if (message.type === 'pointask:pending-thread-updated') {
        returnAttempts++;
        return Promise.resolve(returnAttempts === 1 ? { ok: false, error: 'Source thread did not become ready' } : { ok: true });
      }
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter,
      { authorize: vi.fn().mockResolvedValue(true) } as never);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { attachWorkspaceAnswer(id: string, returnAfter: boolean): Promise<boolean>;
      runWorkspacePrimary(id: string): Promise<void> };
    await act(async () => { await internal.attachWorkspaceAnswer('workspace-return-after-save', true); });
    const shadow = document.querySelector('pointask-pending-thread-banner')?.shadowRoot;
    expect(shadow?.textContent).toContain('内容已附加，但未能返回原页面');
    expect(shadow?.textContent).toContain('重试返回');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'pointask:attach-rounds')).toHaveLength(1);
    await act(async () => { await internal.runWorkspacePrimary('workspace-return-after-save'); });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'pointask:attach-rounds')).toHaveLength(1);
    expect(returnAttempts).toBe(2);
    act(() => manager.stop());
  });

  it('continues in the same Workspace thread with a new round and never attaches the previous answer', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter();
    const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer);
    const base = association('workspace-continue-only').record;
    const firstRoundId = base.localThread.messages[0]!.id;
    let current: PendingAssociation = {
      ...base,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId: firstRoundId, answerMode: 'workspace',
        promptHash: 'workspace-first-hash', candidateAnswerFingerprint: fingerprint, status: 'answer_ready', targetConversationUrl: window.location.href },
      targetConversationUrl: window.location.href,
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', targetConversationUrl: window.location.href, rounds: [{ id: firstRoundId,
        pendingId: base.pendingThread.id, promptHash: 'workspace-first-hash', assistantFingerprintsBefore: [],
        candidateAnswerFingerprint: fingerprint, status: 'answer_ready', persistenceStatus: 'not_captured',
        createdAt: base.createdAt, updatedAt: base.updatedAt }] },
    };
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue({ element: answer, fingerprint, streaming: false });
    vi.spyOn(adapter, 'getAssistantMessageFingerprints').mockReturnValue([fingerprint]);
    vi.spyOn(adapter, 'waitForComposerReady').mockResolvedValue(true);
    vi.spyOn(adapter, 'waitForSubmitReady').mockResolvedValue(true);
    vi.spyOn(adapter, 'fillComposer').mockReturnValue(true);
    vi.spyOn(adapter, 'submitComposer').mockReturnValue(true);
    vi.spyOn(adapter, 'hasSubmittedPrompt').mockReturnValue(true);
    const sent: Array<{ type: string; [key: string]: unknown }> = [];
    let activeRoundIdWhenStaging: string | undefined;
    const sendMessage = vi.fn().mockImplementation((message: { type: string; [key: string]: unknown }) => {
      sent.push(message);
      if (message.type === 'pointask:stage-round-answer') {
        activeRoundIdWhenStaging = current.pendingThread.roundId;
        current = { ...current, localThread: { ...current.localThread,
          rounds: current.localThread.rounds?.map((round) => round.id === firstRoundId ? { ...round, persistenceStatus: 'staged' as const,
            stagedAnswer: [{ type: 'text' as const, content: '第一轮暂存回答' }], answerSource: {
              conversationUrl: window.location.href, conversationKey: window.location.href, messageFingerprint: fingerprint,
            } } : round) } };
      }
      if (message.type === 'pointask:create-pending-thread') current = {
        ...current, pendingThread: message.pendingThread as PendingThread,
        localThread: message.localThread as PendingAssociation['localThread'], updatedAt: '2026-07-12T01:00:00.000Z',
      };
      if (message.type === 'pointask:reserve-prompt-submission') current = {
        ...current,
        pendingThread: { ...current.pendingThread, submittedPromptHash: current.pendingThread.promptHash, status: 'waiting_for_answer' },
        localThread: { ...current.localThread, status: 'waiting_for_answer' },
      };
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter,
      { authorize: vi.fn().mockResolvedValue(true) } as never);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { continueWorkspaceThread(id: string, question: string): Promise<{ ok: boolean }> };
    let continued = { ok: false };
    await act(async () => { continued = await internal.continueWorkspaceThread('workspace-continue-only', '第二轮问题'); });
    expect(continued.ok).toBe(true);
    expect(sent.findIndex((message) => message.type === 'pointask:stage-round-answer'))
      .toBeLessThan(sent.findIndex((message) => message.type === 'pointask:create-pending-thread'));
    expect(activeRoundIdWhenStaging).toBe(firstRoundId);
    const create = sent.find((message) => message.type === 'pointask:create-pending-thread')!;
    const nextPending = create.pendingThread as PendingThread;
    const nextThread = create.localThread as PendingAssociation['localThread'];
    expect(nextPending.threadId).toBe(base.localThread.id);
    expect(nextPending.id).not.toBe(base.pendingThread.id);
    expect(nextPending.roundId).toBeTruthy();
    expect(nextThread.messages.map((message) => message.role)).toEqual(['user', 'user']);
    expect(nextThread.rounds).toHaveLength(2);
    expect(sent.some((message) => message.type === 'pointask:attach-answer' || message.type === 'pointask:attach-rounds')).toBe(false);
    act(() => manager.stop());
  });

  it('stages and attaches the latest completed round when Attach all is clicked without another follow-up', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter();
    const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer);
    const base = association('workspace-latest-direct-attach').record;
    const q1 = 'round-q1'; const q2 = 'round-q2';
    const locator = { conversationUrl: window.location.href, conversationKey: window.location.href, messageFingerprint: 'answer-q1' };
    let current: PendingAssociation = { ...base, targetConversationUrl: window.location.href,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId: q2, answerMode: 'workspace', promptHash: 'hash-q2',
        candidateAnswerFingerprint: fingerprint, status: 'answer_ready', targetConversationUrl: window.location.href },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', targetConversationUrl: window.location.href,
        messages: [
          { id: q1, role: 'user', content: [{ type: 'text', content: '第一问' }], attachedManually: false, createdAt: base.createdAt },
          { id: q2, role: 'user', content: [{ type: 'text', content: '第二问' }], attachedManually: false, createdAt: base.createdAt },
        ], rounds: [
          { id: q1, pendingId: 'older-pending', promptHash: 'hash-q1', assistantFingerprintsBefore: [], status: 'answer_ready',
            persistenceStatus: 'staged', stagedAnswer: [{ type: 'text', content: '第一答' }], answerSource: locator,
            createdAt: base.createdAt, updatedAt: base.updatedAt },
          { id: q2, pendingId: base.pendingThread.id, promptHash: 'hash-q2', assistantFingerprintsBefore: [],
            candidateAnswerFingerprint: fingerprint, status: 'answer_ready', persistenceStatus: 'not_captured',
            createdAt: base.createdAt, updatedAt: base.updatedAt },
        ] } };
    vi.spyOn(adapter, 'findCandidateAnswer').mockImplementation((hash) => hash === 'hash-q2'
      ? { element: answer, fingerprint, streaming: false } : null);
    const extract = vi.spyOn(adapter, 'getMessageRichContent');
    const sent: Array<{ type: string; rounds?: Array<{ roundId: string }>; captureFailed?: boolean }> = [];
    let stageAttempts = 0;
    const sendMessage = vi.fn().mockImplementation((message: { type: string; rounds?: Array<{ roundId: string }>; captureFailed?: boolean }) => {
      sent.push(message);
      if (message.type === 'pointask:stage-round-answer') {
        stageAttempts++;
        if (stageAttempts === 1) return Promise.resolve({ ok: false, error: 'The message port closed before a response was received.' });
        current = { ...current, localThread: { ...current.localThread,
          rounds: current.localThread.rounds?.map((round) => round.id === q2 ? { ...round, persistenceStatus: 'staged' as const,
            stagedAnswer: [{ type: 'text' as const, content: '第二答' }], answerSource: {
              conversationUrl: window.location.href, conversationKey: window.location.href, messageFingerprint: fingerprint,
            } } : round) } };
      }
      if (message.type === 'pointask:get-page-pending-threads') return Promise.resolve({ ok: true, data: [current] });
      if (message.type === 'pointask:attach-rounds') current = { ...current, localThread: { ...current.localThread,
        rounds: current.localThread.rounds?.map((round) => message.rounds?.some((payload) => payload.roundId === round.id)
          ? { ...round, status: 'attached' as const, persistenceStatus: 'attached' as const, stagedAnswer: undefined } : round) } };
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }),
      new ClipboardManager(undefined, () => false), adapter);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { attachSelectedRounds(id: string): Promise<PendingAssociation | null> };
    const outcome: { value: PendingAssociation | null } = { value: null };
    await act(async () => { outcome.value = await internal.attachSelectedRounds(base.pendingThread.id); });
    expect(sent.find((message) => message.type === 'pointask:stage-round-answer')).toBeTruthy();
    expect(sent.filter((message) => message.type === 'pointask:stage-round-answer')).toHaveLength(2);
    expect(sent.filter((message) => message.type === 'pointask:stage-round-answer').every((message) => message.captureFailed === false)).toBe(true);
    expect(sent.find((message) => message.type === 'pointask:attach-rounds')?.rounds?.map((round) => round.roundId)).toEqual([q1, q2]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(outcome.value?.localThread.rounds?.every((round) => round.persistenceStatus === 'attached')).toBe(true);
    act(() => manager.stop());
  });

  it('keeps an extracted answer retryable when staging persistence fails and never overwrites it as capture_failed', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter(); const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer); const base = association('workspace-stage-persist-failure').record;
    const roundId = 'round-persist-failure';
    const current: PendingAssociation = { ...base, targetConversationUrl: window.location.href,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId, answerMode: 'workspace', promptHash: 'persist-hash',
        candidateAnswerFingerprint: fingerprint, status: 'answer_ready', targetConversationUrl: window.location.href },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', targetConversationUrl: window.location.href,
        messages: [{ id: 'question-persist', roundId, role: 'user', content: [{ type: 'text', content: '问题' }],
          attachedManually: false, createdAt: base.createdAt }], rounds: [{ id: roundId, questionMessageId: 'question-persist',
          pendingId: base.pendingThread.id, promptHash: 'persist-hash', assistantFingerprintsBefore: [],
          candidateAnswerFingerprint: fingerprint, status: 'answer_ready', persistenceStatus: 'not_captured',
          createdAt: base.createdAt, updatedAt: base.updatedAt }] } };
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue({ element: answer, fingerprint, streaming: false });
    const sent: Array<{ type: string; captureFailed?: boolean }> = [];
    const sendMessage = vi.fn().mockImplementation((message: { type: string; captureFailed?: boolean }) => {
      sent.push(message);
      if (message.type === 'pointask:get-page-pending-threads') return Promise.resolve({ ok: true, data: [current] });
      if (message.type === 'pointask:stage-round-answer') return Promise.resolve({ ok: false, error: 'storage temporarily unavailable' });
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { ensureRoundStaged(threadId: string, roundId: string): Promise<{ ok: boolean; code: string }> };
    let result = { ok: true, code: '' };
    await act(async () => { result = await internal.ensureRoundStaged(current.localThread.id, roundId); });
    expect(result).toMatchObject({ ok: false, code: 'persist_failed' });
    expect(sent.filter((message) => message.type === 'pointask:stage-round-answer')).toHaveLength(2);
    expect(sent.some((message) => message.type === 'pointask:stage-round-answer' && message.captureFailed === true)).toBe(false);
    expect((manager as unknown as { records: Map<string, PendingAssociation> }).records.get(base.pendingThread.id)?.localThread.rounds?.[0])
      .toMatchObject({ persistenceStatus: 'not_captured', status: 'answer_ready' });
    act(() => manager.stop());
  });

  it('captures the recorded answer by fingerprint when its preceding prompt has been virtualized', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter();
    const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer);
    const base = association('workspace-remembered-answer').record;
    const roundId = base.localThread.messages[0]!.id;
    let current: PendingAssociation = { ...base, targetConversationUrl: window.location.href,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId: undefined, answerMode: 'workspace',
        promptHash: 'remembered-hash', candidateAnswerFingerprint: fingerprint, status: 'answer_ready', targetConversationUrl: window.location.href },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', targetConversationUrl: window.location.href,
        rounds: [{ id: roundId, pendingId: base.pendingThread.id, promptHash: 'remembered-hash', assistantFingerprintsBefore: [],
          candidateAnswerFingerprint: fingerprint, status: 'answer_ready', persistenceStatus: 'not_captured',
          createdAt: base.createdAt, updatedAt: base.updatedAt }] } };
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue(null);
    vi.spyOn(adapter, 'findAssistantMessageByFingerprint').mockReturnValue(answer);
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) => {
      if (message.type === 'pointask:stage-round-answer') current = { ...current, localThread: { ...current.localThread,
        rounds: current.localThread.rounds?.map((round) => ({ ...round, persistenceStatus: 'staged' as const,
          stagedAnswer: [{ type: 'text' as const, content: '唯一记录的回答' }], answerSource: {
            conversationUrl: window.location.href, conversationKey: window.location.href, messageFingerprint: fingerprint,
          } })) } };
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }),
      new ClipboardManager(undefined, () => false), adapter);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as {
      resolveWorkspaceRounds(record: PendingAssociation): Array<{ candidateReliable: boolean }>;
      ensureRoundStaged(threadId: string, roundId: string): Promise<{ ok: boolean }>;
    };
    const resolved = internal.resolveWorkspaceRounds(current)[0]!;
    expect(resolved.candidateReliable).toBe(true);
    let captured = { ok: false };
    await act(async () => { captured = await internal.ensureRoundStaged(current.localThread.id, roundId); });
    expect(captured.ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:stage-round-answer', roundId }));
    act(() => manager.stop());
  });

  it('reuses an already staged active round without extracting or persisting it again', async () => {
    const adapter = new ChatGptAdapter(); const base = association('workspace-stage-idempotent').record;
    const roundId = base.localThread.messages[0]!.id;
    const current: PendingAssociation = { ...base, targetConversationUrl: window.location.href,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId, answerMode: 'workspace', promptHash: 'staged-hash',
        status: 'answer_ready', targetConversationUrl: window.location.href },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', targetConversationUrl: window.location.href,
        rounds: [{ id: roundId, pendingId: base.pendingThread.id, promptHash: 'staged-hash', assistantFingerprintsBefore: [],
          status: 'answer_ready', persistenceStatus: 'staged', stagedAnswer: [{ type: 'text', content: '已暂存回答' }], answerSource: {
            conversationUrl: window.location.href, conversationKey: window.location.href, messageFingerprint: 'staged-answer',
          }, createdAt: base.createdAt, updatedAt: base.updatedAt }] } };
    const extract = vi.spyOn(adapter, 'getMessageRichContent');
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: current });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }),
      new ClipboardManager(undefined, () => false), adapter);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { ensureRoundStaged(threadId: string, id: string): Promise<{ ok: boolean; code: string }> };
    let result: { ok: boolean; code: string } = { ok: false, code: '' };
    await act(async () => { result = await internal.ensureRoundStaged(current.localThread.id, roundId); });
    expect(result).toMatchObject({ ok: true, code: 'already_staged' });
    expect(extract).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:stage-round-answer' }));
    act(() => manager.stop());
  });

  it('keeps the question when staging fails and continues only after the explicit skip action', async () => {
    document.body.innerHTML = '<main></main>';
    const adapter = new ChatGptAdapter(); const base = association('workspace-stage-failed').record;
    const roundId = base.localThread.messages[0]!.id; let current: PendingAssociation = { ...base,
      targetConversationUrl: window.location.href,
      pendingThread: { ...base.pendingThread, threadId: base.localThread.id, roundId, answerMode: 'workspace', promptHash: 'missing-answer-hash',
        candidateAnswerFingerprint: 'unloaded-answer', status: 'answer_ready', targetConversationUrl: window.location.href },
      localThread: { ...base.localThread, answerMode: 'workspace', status: 'answer_ready', targetConversationUrl: window.location.href,
        rounds: [{ id: roundId, pendingId: base.pendingThread.id, promptHash: 'missing-answer-hash', assistantFingerprintsBefore: [],
          candidateAnswerFingerprint: 'unloaded-answer', status: 'answer_ready', persistenceStatus: 'not_captured', answerSource: {
            conversationUrl: window.location.href, conversationKey: window.location.href, messageFingerprint: 'unloaded-answer',
          }, createdAt: base.createdAt, updatedAt: base.updatedAt }] } };
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue(null); vi.spyOn(adapter, 'findAssistantMessageByFingerprint').mockReturnValue(null);
    vi.spyOn(adapter, 'waitForComposerReady').mockResolvedValue(true); vi.spyOn(adapter, 'waitForSubmitReady').mockResolvedValue(true);
    vi.spyOn(adapter, 'fillComposer').mockReturnValue(true); vi.spyOn(adapter, 'hasSubmittedPrompt').mockReturnValue(true);
    const sent: Array<{ type: string; [key: string]: unknown }> = [];
    const sendMessage = vi.fn().mockImplementation((message: { type: string; [key: string]: unknown }) => {
      sent.push(message);
      if (message.type === 'pointask:stage-round-answer') current = { ...current, localThread: { ...current.localThread,
        rounds: current.localThread.rounds?.map((round) => ({ ...round, persistenceStatus: 'capture_failed' as const, stagedAnswer: undefined })) } };
      if (message.type === 'pointask:create-pending-thread') current = { ...current, pendingThread: message.pendingThread as PendingThread,
        localThread: message.localThread as PendingAssociation['localThread'] };
      return Promise.resolve({ ok: true, data: current });
    });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false), adapter,
      { authorize: vi.fn().mockResolvedValue(true) } as never);
    await act(async () => { manager.applyRecord(current); await Promise.resolve(); });
    const internal = manager as unknown as { continueWorkspaceThread(id: string, question: string, skip?: boolean): Promise<{ ok: boolean; captureFailed?: boolean }> };
    let failed: { ok: boolean; captureFailed?: boolean } = { ok: true };
    await act(async () => { failed = await internal.continueWorkspaceThread('workspace-stage-failed', '下一轮问题'); });
    expect(failed).toMatchObject({ ok: false, captureFailed: true });
    expect((failed as { error?: string }).error).toContain('回答当前未加载');
    expect(sent.some((message) => message.type === 'pointask:create-pending-thread')).toBe(false);
    let skipped = { ok: false };
    await act(async () => { skipped = await internal.continueWorkspaceThread('workspace-stage-failed', '下一轮问题', true); });
    expect(skipped.ok).toBe(true);
    const created = sent.find((message) => message.type === 'pointask:create-pending-thread')!;
    const oldRound = (created.localThread as PendingAssociation['localThread']).rounds?.find((round) => round.id === roundId);
    expect(oldRound).toMatchObject({ persistenceStatus: 'capture_failed' });
    expect(oldRound?.stagedAnswer).toBeUndefined();
    act(() => manager.stop());
  });

  it('requires manual selection when two Workspace threads match the same answer', async () => {
    document.body.innerHTML = chatGptFixture;
    const adapter = new ChatGptAdapter();
    const answer = document.querySelector<HTMLElement>('[data-testid="conversation-turn-2"]')!;
    const fingerprint = adapter.getMessageFingerprint(answer);
    const records = ['workspace-ambiguous-one', 'workspace-ambiguous-two'].map((id, index) => {
      const base = association(id).record;
      return {
        ...base,
        pendingThread: { ...base.pendingThread, answerMode: 'workspace' as const, promptHash: `workspace-hash-${index}`, status: 'answer_ready' as const },
        localThread: { ...base.localThread, answerMode: 'workspace' as const, status: 'answer_ready' as const },
      };
    });
    vi.spyOn(adapter, 'findCandidateAnswer').mockReturnValue({ element: answer, fingerprint, streaming: false });
    const manager = new PendingBannerManager(new WebConversationBridge({
      sendMessage: vi.fn().mockImplementation((message: { pendingThreadId?: string }) => Promise.resolve({
        ok: true,
        data: records.find((record) => record.pendingThread.id === message.pendingThreadId) ?? records[0],
      })),
    }), new ClipboardManager(undefined, () => false), adapter);
    await act(async () => {
      for (const record of records) manager.applyRecord(record);
      await Promise.resolve();
    });
    const banner = document.querySelector('pointask-pending-thread-banner')?.shadowRoot;
    expect(banner?.textContent).toContain('匹配不明确');
    expect(banner?.textContent).toContain('先选择回答内容');
    expect(banner?.textContent).not.toContain('附加本轮并返回');
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
