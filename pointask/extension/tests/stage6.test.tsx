import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingAssociationCoordinator } from '../src/background/pending-association-coordinator';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import { PendingThreadManager, type PendingThread } from '../src/bridge/pending-thread-manager';
import { buildPrompt } from '../src/bridge/prompt-builder';
import type { PointAskRuntimeMessage } from '../src/bridge/runtime-messages';
import { WebConversationBridge } from '../src/bridge/web-conversation-bridge';
import { InlineThreadManager } from '../src/content/inline-thread-manager';
import type { LocalMessage, LocalThread, TextAnchor } from '../src/shared/local-thread';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { ThreadStore } from '../src/storage/thread-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const timestamp = '2026-07-12T00:00:00.000Z';
const anchor: TextAnchor = {
  pageUrl: 'https://chatgpt.com/c/source', prefixText: '', suffixText: '', paragraphHash: 'paragraph-multi',
  assistantMessageHash: 'assistant-multi', startOffset: 0, endOffset: 6, schemaVersion: 1, createdAt: timestamp,
  selectedText: '原始局部内容', paragraphText: '包含原始局部内容的段落。', messageFingerprint: 'fingerprint-multi',
  conversationKey: 'https://chatgpt.com/c/source', sourcePageUrl: 'https://chatgpt.com/c/source',
};

function pending(id = 'pointask-multi'): PendingThread {
  return {
    displayId: 'PA-001', answerMode: 'dedicated_branch',
    id, sourcePageUrl: anchor.sourcePageUrl, sourceConversationKey: anchor.conversationKey,
    sourceMessageFingerprint: anchor.messageFingerprint, anchor, question: '第一问', generatedPrompt: '第一轮提示词',
    promptMode: 'compact', status: 'waiting_for_answer', createdAt: timestamp, updatedAt: timestamp,
    targetConversationUrl: 'https://chatgpt.com/c/target',
  };
}

function attachedThread(id = 'pointask-multi'): LocalThread {
  return {
    displayId: 'PA-001', answerMode: 'dedicated_branch',
    id, anchor, sourcePageUrl: anchor.sourcePageUrl, sourceConversationKey: anchor.conversationKey,
    sourceMessageFingerprint: anchor.messageFingerprint, targetConversationUrl: 'https://chatgpt.com/c/target',
    messages: [
      { id: 'q1', role: 'user', content: [{ type: 'text', content: '第一问' }], attachedManually: false, createdAt: timestamp },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', content: '第一答' }], answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: 'a1' }, attachedManually: true, createdAt: timestamp },
    ],
    status: 'answer_attached', createdAt: timestamp, updatedAt: timestamp,
  };
}

describe('multi-turn prompt and thread flow', () => {
  beforeEach(() => { document.body.innerHTML = '<p id="anchor">来源段落</p>'; });

  it('adds a second question and opens its target without sending from the source page', async () => {
    const pendingManager = new PendingThreadManager(() => new Date(timestamp), () => 'unused');
    pendingManager.restore(pending());
    let currentThread = attachedThread();
    const sent: PointAskRuntimeMessage[] = [];
    const runtime = {
      sendMessage: vi.fn().mockImplementation((message: PointAskRuntimeMessage) => {
        sent.push(message);
        if (message.type === 'pointask:update-local-thread' || message.type === 'pointask:create-pending-thread') {
          if ('localThread' in message && message.localThread) currentThread = message.localThread;
        }
        return Promise.resolve({
          ok: true,
          data: {
            pendingThread: pendingManager.get('pointask-multi'), localThread: currentThread,
            sourceTabId: 1, targetTabId: 2, targetConversationUrl: 'https://chatgpt.com/c/target',
            associationStatus: 'target_opened', createdAt: timestamp, updatedAt: timestamp,
          },
        });
      }),
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    const manager = new InlineThreadManager(
      pendingManager,
      new ClipboardManager({ writeText }, vi.fn()),
      new WebConversationBridge(runtime),
      undefined,
      () => new Date(timestamp),
    );
    await act(() => manager.mount(attachedThread(), document.getElementById('anchor') as HTMLElement));
    await act(async () => { await manager.continueThread('pointask-multi', '第二问'); });

    expect(manager.getThread('pointask-multi')?.messages.map((message) => message.content[0]?.type === 'text' ? message.content[0].content : ''))
      .toEqual(['第一问', '第一答', '第二问']);
    const update = sent.find((message) => message.type === 'pointask:create-pending-thread' &&
      'pendingThread' in message && message.pendingThread.threadId === 'pointask-multi');
    expect(update && 'pendingThread' in update ? update.pendingThread.generatedPrompt : '').toContain('用户：第一问');
    expect(update && 'pendingThread' in update ? update.pendingThread.generatedPrompt : '').toContain('局部回答：第一答');
    expect(update && 'pendingThread' in update ? update.pendingThread.generatedPrompt : '').toContain('我的问题：\n第二问');
    expect(update && 'pendingThread' in update ? update.pendingThread.id : '').not.toBe('pointask-multi');
    expect(update && 'pendingThread' in update ? update.pendingThread.roundId : '').toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
    expect(sent.some((message) => message.type === 'pointask:open-answer-page')).toBe(true);
    expect(sent.some((message) => message.type === 'pointask:reserve-prompt-submission')).toBe(false);
  });

  it('renders each round as one collapsible unit and keeps historical rounds collapsed by default', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const thread = attachedThread();
    thread.messages.push(
      { id: 'q2', role: 'user', content: [{ type: 'text', content: '第二问：解释 CUDA 内存模型' }], attachedManually: false, createdAt: timestamp },
      { id: 'a2', role: 'assistant', content: [{ type: 'text', content: '第二答' }], answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: 'a2' }, attachedManually: true, createdAt: timestamp },
    );
    thread.expanded = true;
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false));
    await act(() => manager.mount(thread, document.getElementById('anchor') as HTMLElement));
    const shadow = manager.getHost(thread.id)?.shadowRoot;
    const toggles = shadow?.querySelectorAll<HTMLButtonElement>('.pointask-round-toggle');
    expect(toggles).toHaveLength(2);
    expect(toggles?.[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(toggles?.[1]?.getAttribute('aria-expanded')).toBe('true');
    expect(shadow?.textContent).toContain('问题 1：第一问');
    expect(shadow?.textContent).toContain('问题 2：第二问：解释 CUDA 内存模型');
    expect(shadow?.textContent).not.toContain('用户问题');
    expect(shadow?.textContent).not.toContain('已附加');
    expect(shadow?.querySelectorAll('.pointask-round-question')).toHaveLength(1);
    expect(shadow?.querySelector('.pointask-round-question-label')).toBeNull();
    expect(shadow?.querySelector('.pointask-round-answer .pointask-secondary')).not.toBeNull();
  });

  it('opens only the round that receives a new answer', async () => {
    const thread = attachedThread();
    thread.messages.push({ id: 'q2', role: 'user', content: [{ type: 'text', content: '第二问' }], attachedManually: false, createdAt: timestamp });
    thread.status = 'waiting_for_answer';
    thread.expanded = true;
    thread.collapsedRoundIds = ['q1', 'q2'];
    const pendingManager = new PendingThreadManager();
    pendingManager.restore(pending());
    const manager = new InlineThreadManager(pendingManager, new ClipboardManager(undefined, () => false));
    await act(() => manager.mount(thread, document.getElementById('anchor') as HTMLElement));
    const updatedThread: LocalThread = {
      ...thread,
      messages: [...thread.messages, {
        id: 'a2', role: 'assistant', content: [{ type: 'text', content: '第二答' }],
        answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: 'a2' },
        attachedManually: true, createdAt: timestamp,
      }],
      status: 'answer_attached',
    };
    act(() => manager.handleAssociationUpdate({
      pendingThread: { ...pending(), status: 'answer_attached' }, localThread: updatedThread,
      sourceTabId: 1, targetTabId: 2, targetConversationUrl: 'https://chatgpt.com/c/target',
      associationStatus: 'associated', createdAt: timestamp, updatedAt: timestamp,
    }));
    const toggles = manager.getHost(thread.id)?.shadowRoot?.querySelectorAll<HTMLButtonElement>('.pointask-round-toggle');
    expect(toggles?.[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(toggles?.[1]?.getAttribute('aria-expanded')).toBe('true');
    expect(manager.getThread(thread.id)?.collapsedRoundIds).toEqual(['q1']);
  });

  it('persists round fold state and restores it after remounting', async () => {
    document.body.innerHTML = '<p id="anchor">来源段落</p>';
    const driver = new MemoryStorageDriver();
    const store = new ThreadStore(driver);
    const thread = attachedThread();
    thread.messages.push(
      { id: 'q2', role: 'user', content: [{ type: 'text', content: '第二问' }], attachedManually: false, createdAt: timestamp },
      { id: 'a2', role: 'assistant', content: [{ type: 'text', content: '第二答' }], answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: 'a2' }, attachedManually: true, createdAt: timestamp },
    );
    thread.expanded = true;
    await store.upsert(thread);
    const manager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false), undefined, undefined, undefined, store);
    await act(() => manager.mount(thread, document.getElementById('anchor') as HTMLElement));
    await act(async () => { await manager.toggleRound(thread.id, 'q1'); });
    await vi.waitFor(async () => {
      const stored = await store.get(thread.id);
      expect(stored?.collapsedRoundIds).toEqual([]);
    });
    expect(manager.getHost(thread.id)?.shadowRoot?.querySelectorAll<HTMLButtonElement>('.pointask-round-toggle')[0]?.getAttribute('aria-expanded')).toBe('true');

    const remounted = (await store.get(thread.id))!;
    const nextManager = new InlineThreadManager(new PendingThreadManager(), new ClipboardManager(undefined, () => false), undefined, undefined, undefined, store);
    await act(() => nextManager.mount(remounted, document.getElementById('anchor') as HTMLElement));
    expect(nextManager.getHost(thread.id)?.shadowRoot?.querySelectorAll<HTMLButtonElement>('.pointask-round-toggle')[0]?.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps recent rounds under a deterministic history character budget', () => {
    const messages: LocalMessage[] = Array.from({ length: 10 }, (_, index) => [
      { id: `q${index}`, role: 'user' as const, content: [{ type: 'text' as const, content: `问题${index}-${'问'.repeat(900)}` }], attachedManually: false, createdAt: timestamp },
      { id: `a${index}`, role: 'assistant' as const, content: [{ type: 'text' as const, content: `回答${index}-${'答'.repeat(900)}` }], attachedManually: true, createdAt: timestamp },
    ]).flat();
    const prompt = buildPrompt({ selectedText: anchor.selectedText, paragraphText: anchor.paragraphText, userQuestion: '最新问题', previousLocalMessages: messages, mode: 'compact' });
    expect(prompt).toContain('回答9-');
    expect(prompt).not.toContain('问题0-');
    expect(prompt).toBe(buildPrompt({ selectedText: anchor.selectedText, paragraphText: anchor.paragraphText, userQuestion: '最新问题', previousLocalMessages: messages, mode: 'compact' }));
    expect(prompt.length).toBeLessThan(7_000);
  });

  it('deletes one complete round while preserving legal role order, then deletes the whole thread', async () => {
    const pendingManager = new PendingThreadManager();
    pendingManager.restore(pending());
    const thread = attachedThread();
    thread.messages.push(
      { id: 'q2', role: 'user', content: [{ type: 'text', content: '第二问' }], attachedManually: false, createdAt: timestamp },
      { id: 'a2', role: 'assistant', content: [{ type: 'text', content: '第二答' }], answerSource: { conversationUrl: 'https://chatgpt.com/c/target', conversationKey: 'https://chatgpt.com/c/target', messageFingerprint: 'a2' }, attachedManually: true, createdAt: timestamp },
    );
    const manager = new InlineThreadManager(pendingManager, new ClipboardManager(undefined, () => false));
    await act(() => manager.mount(thread, document.getElementById('anchor') as HTMLElement));
    await act(async () => { await manager.deleteRound(thread.id, 'q1'); });
    expect(manager.getThread(thread.id)?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(manager.getThread(thread.id)?.messages[0]?.content).toEqual([{ type: 'text', content: '第二问' }]);
    await act(() => manager.delete(thread.id));
    expect(manager.getThread(thread.id)).toBeNull();
    expect(document.querySelector('pointask-inline-thread')).toBeNull();
  });
});

describe('conversation association conflicts and restoration', () => {
  it('stages a completed Workspace round once and clears only its temporary answer after attachment', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(timestamp));
    const value = { ...pending('workspace-stage'), threadId: 'workspace-stage', roundId: 'q1', answerMode: 'workspace' as const,
      promptHash: 'stage-hash', status: 'answer_ready' as const, targetConversationUrl: 'https://chatgpt.com/c/shared' };
    const local: LocalThread = { ...attachedThread('workspace-stage'), answerMode: 'workspace', status: 'answer_ready',
      messages: [{ id: 'q1', role: 'user', content: [{ type: 'text', content: '第一问' }], attachedManually: false, createdAt: timestamp }],
      rounds: [{ id: 'q1', pendingId: value.id, promptHash: 'stage-hash', assistantFingerprintsBefore: [], status: 'answer_ready',
        persistenceStatus: 'not_captured', createdAt: timestamp, updatedAt: timestamp }] };
    coordinator.create(value, 1, local); coordinator.markTargetOpened(value.id, 20, 'https://chatgpt.com/c/shared');
    const locator = { conversationUrl: 'https://chatgpt.com/c/shared', conversationKey: 'https://chatgpt.com/c/shared', messageFingerprint: 'answer-q1' };
    const first = coordinator.stageRoundAnswer(value.id, 20, 'q1', 'stage-hash', 'https://chatgpt.com/c/shared', false,
      [{ type: 'text', content: '暂存回答' }], locator)!;
    const second = coordinator.stageRoundAnswer(value.id, 20, 'q1', 'stage-hash', 'https://chatgpt.com/c/shared', false,
      [{ type: 'text', content: '不应覆盖' }], locator)!;
    expect(second.localThread.rounds?.[0]).toMatchObject({ persistenceStatus: 'staged', stagedAnswer: [{ type: 'text', content: '暂存回答' }] });
    expect(second.localThread.messages).toHaveLength(1);
    const attached = coordinator.attachRounds(value.id, 20, [{ roundId: 'q1', richContent: first.localThread.rounds![0]!.stagedAnswer!,
      answerSource: locator }], 'https://chatgpt.com/c/shared')!;
    expect(attached.localThread.rounds?.[0]).toMatchObject({ persistenceStatus: 'attached' });
    expect(attached.localThread.rounds?.[0]?.stagedAnswer).toBeUndefined();
    expect(attached.localThread.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  });

  it('keeps staged answers isolated between two PA threads in one Workspace', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(timestamp));
    for (const [id, roundId] of [['stage-one', 'q-one'], ['stage-two', 'q-two']] as const) {
      const value = { ...pending(id), threadId: id, roundId, answerMode: 'workspace' as const, workspaceId: 'shared',
        promptHash: `hash-${id}`, status: 'answer_ready' as const, targetConversationUrl: 'https://chatgpt.com/c/shared' };
      const local: LocalThread = { ...attachedThread(id), answerMode: 'workspace', workspaceId: 'shared', status: 'answer_ready',
        messages: [{ id: roundId, role: 'user', content: [{ type: 'text', content: id }], attachedManually: false, createdAt: timestamp }],
        rounds: [{ id: roundId, pendingId: id, promptHash: `hash-${id}`, assistantFingerprintsBefore: [], status: 'answer_ready',
          persistenceStatus: 'not_captured', createdAt: timestamp, updatedAt: timestamp }] };
      coordinator.create(value, id === 'stage-one' ? 1 : 2, local); coordinator.markTargetOpened(id, 20, 'https://chatgpt.com/c/shared');
    }
    const locator = { conversationUrl: 'https://chatgpt.com/c/shared', conversationKey: 'https://chatgpt.com/c/shared', messageFingerprint: 'answer-one' };
    coordinator.stageRoundAnswer('stage-one', 20, 'q-one', 'hash-stage-one', 'https://chatgpt.com/c/shared', false,
      [{ type: 'text', content: '只属于第一条线程' }], locator);
    expect(coordinator.get('stage-one')?.localThread.rounds?.[0]?.persistenceStatus).toBe('staged');
    expect(coordinator.get('stage-two')?.localThread.rounds?.[0]?.persistenceStatus).toBe('not_captured');
    expect(coordinator.get('stage-two')?.localThread.rounds?.[0]?.stagedAnswer).toBeUndefined();
  });

  it('atomically attaches multiple reliable rounds by roundId and remains idempotent', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(timestamp));
    const workspacePending = { ...pending('workspace-batch'), threadId: 'workspace-batch', roundId: 'q3',
      answerMode: 'workspace' as const, promptHash: 'prompt-3', status: 'answer_ready' as const };
    const local: LocalThread = {
      ...attachedThread('workspace-batch'), answerMode: 'workspace', status: 'answer_ready',
      messages: [
        { id: 'q1', role: 'user', content: [{ type: 'text', content: '第一问' }], attachedManually: false, createdAt: timestamp },
        { id: 'q2', role: 'user', content: [{ type: 'text', content: '第二问' }], attachedManually: false, createdAt: timestamp },
        { id: 'q3', role: 'user', content: [{ type: 'text', content: '第三问' }], attachedManually: false, createdAt: timestamp },
      ],
      rounds: ['q1', 'q2', 'q3'].map((id, index) => ({ id, pendingId: `p${index + 1}`, promptHash: `prompt-${index + 1}`,
        assistantFingerprintsBefore: [], status: 'answer_ready' as const, persistenceStatus: 'staged' as const,
        stagedAnswer: [{ type: 'text' as const, content: id === 'q1' ? '第一答' : id === 'q2' ? '第二答' : '第三答' }],
        answerSource: { conversationUrl: 'https://chatgpt.com/c/shared', conversationKey: 'https://chatgpt.com/c/shared', messageFingerprint: `answer-${id}` },
        createdAt: timestamp, updatedAt: timestamp })),
    };
    coordinator.create(workspacePending, 1, local);
    coordinator.markTargetOpened(workspacePending.id, 20, 'https://chatgpt.com/c/shared');
    const source = (id: string) => ({ conversationUrl: 'https://chatgpt.com/c/shared', conversationKey: 'https://chatgpt.com/c/shared',
      messageFingerprint: `answer-${id}` });
    const first = coordinator.attachRounds(workspacePending.id, 20, [
      { roundId: 'q1', richContent: [{ type: 'text', content: '第一答' }], answerSource: source('q1') },
      { roundId: 'q2', richContent: [{ type: 'text', content: '第二答' }], answerSource: source('q2') },
      { roundId: 'q2', richContent: [{ type: 'text', content: '第二答' }], answerSource: source('q2') },
    ], 'https://chatgpt.com/c/shared')!;
    expect(first.localThread.messages.map((message) => `${message.role}:${message.id}`)).toEqual([
      'user:q1', 'assistant:pointask-answer-q1', 'user:q2', 'assistant:pointask-answer-q2', 'user:q3',
    ]);
    expect(first.localThread.rounds?.map((round) => round.status)).toEqual(['attached', 'attached', 'answer_ready']);
    expect(first.localThread.rounds?.map((round) => round.persistenceStatus)).toEqual(['attached', 'attached', 'staged']);
    expect(first.localThread.rounds?.find((round) => round.id === 'q3')?.stagedAnswer).toEqual([{ type: 'text', content: '第三答' }]);
    const second = coordinator.attachRounds(workspacePending.id, 20, [
      { roundId: 'q1', richContent: [{ type: 'text', content: '不应重复' }], answerSource: source('q1') },
      { roundId: 'q2', richContent: [{ type: 'text', content: '不应重复' }], answerSource: source('q2') },
    ], 'https://chatgpt.com/c/shared')!;
    expect(second.localThread.messages).toEqual(first.localThread.messages);
  });

  it('keeps two Workspace pending threads isolated on their shared target tab', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(timestamp));
    for (const [id, displayId] of [['workspace-one', 'PA-001'], ['workspace-two', 'PA-002']] as const) {
      const pendingThread = { ...pending(id), displayId, answerMode: 'workspace' as const, workspaceId: 'shared' };
      const local = { ...attachedThread(id), displayId, answerMode: 'workspace' as const, workspaceId: 'shared',
        messages: [{ id: `q-${id}`, role: 'user' as const, content: [{ type: 'text' as const, content: id }], attachedManually: false, createdAt: timestamp }], status: 'waiting_for_submission' as const };
      coordinator.create(pendingThread, id === 'workspace-one' ? 1 : 2, local);
      expect(coordinator.associate(id, 20, 'https://chatgpt.com/c/shared')).not.toBeNull();
    }
    coordinator.attachAnswer('workspace-two', 20, '第二条回答', 'https://chatgpt.com/c/shared', false);
    expect(coordinator.get('workspace-one')?.localThread.messages).toHaveLength(1);
    expect(coordinator.get('workspace-two')?.localThread.messages).toHaveLength(2);
  });

  it('requires confirmation to change target tabs and rejects concurrent active pending on one target tab', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(timestamp));
    coordinator.create(pending('one'), 1);
    coordinator.create(pending('two'), 2);
    coordinator.markManualBranch('one', 1);
    coordinator.markManualBranch('two', 2);
    expect(coordinator.associate('one', 10, 'https://chatgpt.com/c/one')).not.toBeNull();
    expect(coordinator.associate('two', 10, 'https://chatgpt.com/c/two')).toBeNull();
    expect(coordinator.associate('one', 11, 'https://chatgpt.com/c/relinked')).toBeNull();
    expect(coordinator.associate('one', 11, 'https://chatgpt.com/c/relinked', true)?.targetTabId).toBe(11);
    const unlinked = coordinator.unlink('one', 1);
    expect(unlinked?.targetTabId).toBeUndefined();
    expect(unlinked?.localThread.targetConversationUrl).toBeUndefined();
  });

  it('rejects wrong thread IDs and duplicate completed attachments without replace confirmation', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(timestamp));
    coordinator.create(pending(), 1);
    coordinator.markTargetOpened(pending().id, 2, 'https://chatgpt.com/c/target');
    expect(coordinator.attachAnswer('wrong', 2, '回答', 'https://chatgpt.com/c/target', false)).toBeNull();
    expect(coordinator.attachAnswer(pending().id, 2, '回答一', 'https://chatgpt.com/c/target', false)).not.toBeNull();
    expect(coordinator.attachAnswer(pending().id, 2, '回答二', 'https://chatgpt.com/c/target', false)).toBeNull();
  });

  it('preserves the complete multi-turn structure for source refresh restoration', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(timestamp));
    coordinator.create(pending(), 7, attachedThread());
    const restored = coordinator.forSourceTab(7)[0];
    expect(restored?.localThread).toEqual(attachedThread());
    expect(restored?.pendingThread.targetConversationUrl).toBe('https://chatgpt.com/c/target');
  });
});
