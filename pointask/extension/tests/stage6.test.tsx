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

  it('adds a second question, builds from local history, copies, and requests the associated URL', async () => {
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
    const update = sent.find((message) => message.type === 'pointask:update-local-thread');
    expect(update && 'pendingThread' in update ? update.pendingThread.generatedPrompt : '').toContain('用户：第一问');
    expect(update && 'pendingThread' in update ? update.pendingThread.generatedPrompt : '').toContain('局部回答：第一答');
    expect(update && 'pendingThread' in update ? update.pendingThread.generatedPrompt : '').toContain('我的问题：\n第二问');
    expect(writeText).not.toHaveBeenCalled();
    expect(sent.some((message) => message.type === 'pointask:open-answer-page')).toBe(true);
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
