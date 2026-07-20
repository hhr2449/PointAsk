import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildPrompt } from '../src/bridge/prompt-builder';
import { AnswerModeMount } from '../src/content/answer-mode-mount';
import type { LocalMessage, LocalThread, PointAskWorkspace, TextAnchor } from '../src/shared/local-thread';
import { migrateStorage } from '../src/storage/migration';
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from '../src/storage/storage-schema';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { ThreadStore } from '../src/storage/thread-store';
import { WorkspaceStore } from '../src/storage/workspace-store';
import { PendingThreadManager } from '../src/bridge/pending-thread-manager';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import { WebConversationBridge } from '../src/bridge/web-conversation-bridge';
import { InlineThreadManager } from '../src/content/inline-thread-manager';
import type { SelectionData } from '../src/content/selection-manager';
import type { Root } from 'react-dom/client';
import type { SiteAdapter } from '../src/adapters/site-adapter';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const now = '2026-07-12T00:00:00.000Z';
const anchor: TextAnchor = {
  pageUrl: 'https://chatgpt.com/c/source', sourcePageUrl: 'https://chatgpt.com/c/source', conversationKey: 'https://chatgpt.com/c/source',
  messageFingerprint: 'message', assistantMessageHash: 'message', selectedText: '自由度', prefixText: '', suffixText: '',
  paragraphText: '这里讨论自由度。', paragraphHash: 'paragraph', startOffset: 4, endOffset: 7, schemaVersion: 1, createdAt: now,
};
const localThread = (id: string, displayId: string, source = anchor.conversationKey): LocalThread => ({
  id, displayId, answerMode: 'dedicated_branch', anchor: { ...anchor, conversationKey: source, sourcePageUrl: source, pageUrl: source },
  sourcePageUrl: source, sourceConversationKey: source, sourceMessageFingerprint: 'message',
  messages: [{ id: `q-${id}`, role: 'user', content: [{ type: 'text', content: '问题' }], attachedManually: false, createdAt: now }],
  status: 'prompt_ready', createdAt: now, updatedAt: now,
});
const selectionData = (): SelectionData => ({
  selectedText: anchor.selectedText, paragraphText: anchor.paragraphText, messageFingerprint: anchor.messageFingerprint,
  conversationKey: anchor.conversationKey, sourcePageUrl: anchor.sourcePageUrl, rangeRect: new DOMRect(),
  anchorElement: document.getElementById('pointask-test-anchor') as HTMLElement,
  sourceMessageElement: document.getElementById('pointask-test-anchor') as HTMLElement, textAnchor: anchor,
});

describe('answer mode selection', () => {
  it('selects workspace by default and supports keyboard cancellation', async () => {
    const cancel = vi.fn(); const mount = new AnswerModeMount();
    await act(() => mount.open(vi.fn(), vi.fn(), cancel));
    const host = document.querySelector('pointask-answer-mode-selector');
    const selected = host?.shadowRoot?.querySelector<HTMLInputElement>('input:checked');
    expect(selected?.value).toBe('workspace');
    await act(() => selected?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('builds distinct prompts for all three AnswerMode values', () => {
    const base = { selectedText: '自由度', paragraphText: '这里讨论自由度。', userQuestion: '为什么？', mode: 'compact' as const, displayId: 'PA-002' };
    expect(buildPrompt({ ...base, answerMode: 'workspace' })).toContain('[PointAsk 局部线程：PA-002]');
    expect(buildPrompt({ ...base, answerMode: 'current_conversation' })).toContain('请简洁回答这个局部问题');
    expect(buildPrompt({ ...base, answerMode: 'dedicated_branch' })).toContain('请只回答这个局部问题');
  });
});

describe('workspace and display IDs', () => {
  it('keeps one workspace per source conversation and increments its thread count', async () => {
    const store = new WorkspaceStore(new MemoryStorageDriver());
    const candidate: PointAskWorkspace = {
      id: 'workspace-one', sourceConversationKey: anchor.conversationKey, sourceConversationUrl: anchor.pageUrl,
      workspaceType: 'new_conversation', threadCount: 0, approximateContentLength: 0, createdAt: now, updatedAt: now,
      contextState: { contextVersion: 1, unsyncedMessageCount: 0, unsyncedTurnCount: 0, status: 'unknown' },
    };
    const [first, second] = await Promise.all([store.createOrIncrement(candidate, 10), store.createOrIncrement({ ...candidate, id: 'workspace-other' }, 20)]);
    expect(first.id).toBe('workspace-one');
    expect(second.id).toBe('workspace-one');
    expect((await store.list())).toHaveLength(1);
    expect((await store.getBySource(anchor.conversationKey))?.threadCount).toBe(2);
  });

  it('allocates concurrent PA IDs without reuse after deletion and resets per source conversation', async () => {
    const driver = new MemoryStorageDriver(); const store = new ThreadStore(driver);
    const ids = await Promise.all([store.allocateDisplayId('source-a'), store.allocateDisplayId('source-a'), store.allocateDisplayId('source-a')]);
    expect(ids).toEqual(['PA-001', 'PA-002', 'PA-003']);
    await store.upsert(localThread('t3', 'PA-003', 'source-a')); await store.delete('t3');
    expect(await store.allocateDisplayId('source-a')).toBe('PA-004');
    expect(await store.allocateDisplayId('source-b')).toBe('PA-001');
  });

  it('deleting a thread does not delete its workspace', async () => {
    const driver = new MemoryStorageDriver(); const threads = new ThreadStore(driver); const workspaces = new WorkspaceStore(driver);
    const workspace: PointAskWorkspace = { id: 'w', sourceConversationKey: anchor.conversationKey, sourceConversationUrl: anchor.pageUrl,
      workspaceType: 'branch', threadCount: 1, approximateContentLength: 10, createdAt: now, updatedAt: now,
      contextState: { contextVersion: 1, unsyncedMessageCount: 0, unsyncedTurnCount: 0, status: 'unknown' } };
    await workspaces.createOrGet(workspace); await threads.upsert({ ...localThread('t', 'PA-001'), answerMode: 'workspace', workspaceId: 'w' });
    await threads.delete('t');
    expect(await workspaces.get('w')).toEqual(workspace);
  });
});

describe('mode navigation behavior', () => {
  it('uses the current-page send click as confirmation and blocks duplicate submission', async () => {
    document.body.innerHTML = '<p id="pointask-test-anchor">来源</p>';
    const pendingManager = new PendingThreadManager(() => new Date(now), () => 'current-send');
    let record: import('../src/bridge/runtime-messages').PendingAssociation | undefined;
    const runtime = { sendMessage: vi.fn().mockImplementation((message: { type: string; pendingThread?: import('../src/bridge/pending-thread-manager').PendingThread; localThread?: LocalThread; promptHash?: string }) => {
      if (message.type === 'pointask:create-pending-thread') record = { pendingThread: message.pendingThread!, localThread: message.localThread!, sourceTabId: 1,
        associationStatus: 'created', createdAt: now, updatedAt: now };
      if (message.type === 'pointask:associate-target-page' && record) record = { ...record, targetTabId: 1, targetConversationUrl: anchor.sourcePageUrl,
        associationStatus: 'associated', pendingThread: { ...record.pendingThread, targetConversationUrl: anchor.sourcePageUrl, targetTabId: 1 },
        localThread: { ...record.localThread, targetConversationUrl: anchor.sourcePageUrl, status: 'waiting_for_submission' } };
      if (message.type === 'pointask:reserve-prompt-submission' && record) record = { ...record,
        pendingThread: { ...record.pendingThread, submittedPromptHash: message.promptHash, status: 'waiting_for_answer' },
        localThread: { ...record.localThread, status: 'waiting_for_answer' } };
      return Promise.resolve({ ok: true, data: record });
    }) };
    const adapter = {
      getConversationKey: () => anchor.conversationKey, fillComposer: vi.fn().mockReturnValue(true), canSubmitComposer: vi.fn().mockReturnValue(true),
      submitComposer: vi.fn().mockReturnValue(true), getAssistantMessageFingerprints: () => [], getScrollContainer: () => window,
    } as unknown as SiteAdapter;
    const manager = new InlineThreadManager(pendingManager, new ClipboardManager(undefined, () => false), new WebConversationBridge(runtime),
      () => ({ render: vi.fn(), unmount: vi.fn() }) as unknown as Root, () => new Date(now), undefined, undefined, undefined, undefined, adapter);
    const id = await manager.create(selectionData(), '当前页面直接发送', 'current_conversation');
    const sent = await manager.confirmAnswerModeAndSend(id!);
    expect(sent).toBe(true);
    expect(adapter.fillComposer).toHaveBeenCalledOnce(); expect(adapter.submitComposer).toHaveBeenCalledOnce();
    expect(manager.getThread(id!)?.status).toBe('waiting_for_answer');
    expect(await manager.sendCurrentConversation(id!)).toBe(false);
    expect(adapter.submitComposer).toHaveBeenCalledOnce();
  });

  it('does not request a new tab for current_conversation and reuses a Workspace target', async () => {
    document.body.innerHTML = '<p id="pointask-test-anchor">来源</p>';
    const driver = new MemoryStorageDriver();
    const threadStore = new ThreadStore(driver); const workspaceStore = new WorkspaceStore(driver);
    const calls: Array<{ type: string }> = [];
    let currentLocal: LocalThread | undefined;
    let currentPending: import('../src/bridge/pending-thread-manager').PendingThread | undefined;
    const runtime = { sendMessage: vi.fn().mockImplementation((message: {
      type: string; localThread?: LocalThread; pendingThread?: import('../src/bridge/pending-thread-manager').PendingThread; targetUrl?: string;
    }) => {
      calls.push(message); if (message.localThread) currentLocal = message.localThread; if (message.pendingThread) currentPending = message.pendingThread;
      if (message.type === 'pointask:associate-target-page' && currentLocal) currentLocal = { ...currentLocal, targetConversationUrl: message.targetUrl };
      const record = { pendingThread: currentPending, localThread: currentLocal, sourceTabId: 1, targetTabId: 1,
        targetConversationUrl: currentLocal?.targetConversationUrl, associationStatus: 'associated', createdAt: now, updatedAt: now };
      return Promise.resolve({ ok: true, data: message.type === 'pointask:open-or-auto-send-workspace'
        ? { record, autoSent: false } : record });
    }) };
    const writeText = vi.fn().mockResolvedValue(undefined);
    const pendingManager = new PendingThreadManager();
    const rootFactory = () => ({ render: vi.fn(), unmount: vi.fn() }) as unknown as Root;
    const manager = new InlineThreadManager(pendingManager, new ClipboardManager({ writeText }, vi.fn()),
      new WebConversationBridge(runtime), rootFactory, () => new Date(now), threadStore, undefined, undefined, workspaceStore);
    const currentId = await manager.create(selectionData(), '当前对话问题', 'current_conversation');
    expect(currentId).not.toBeNull(); await manager.startAnswerFlow(currentId!);
    expect(writeText).not.toHaveBeenCalled();
    expect(calls.some((call) => call.type === 'pointask:open-target-chat' || call.type === 'pointask:open-answer-page')).toBe(false);

    await workspaceStore.createOrGet({ id: 'workspace', sourceConversationKey: anchor.conversationKey,
      sourceConversationUrl: anchor.pageUrl, targetConversationUrl: 'https://chatgpt.com/c/workspace', targetConversationKey: 'https://chatgpt.com/c/workspace',
      workspaceType: 'new_conversation', threadCount: 0, approximateContentLength: 0, createdAt: now, updatedAt: now,
      contextState: { contextVersion: 1, unsyncedMessageCount: 0, unsyncedTurnCount: 0, status: 'unknown' } });
    const workspaceId = await manager.create(selectionData(), 'Workspace 问题', 'workspace');
    await manager.confirmAnswerModeAndSend(workspaceId!);
    expect(calls.some((call) => call.type === 'pointask:open-or-auto-send-workspace')).toBe(true);
    expect(calls.some((call) => call.type === 'pointask:open-answer-page')).toBe(false);
    expect(calls.some((call) => call.type === 'pointask:reserve-prompt-submission')).toBe(false);
    expect(manager.getThread(workspaceId!)?.workspaceId).toBe('workspace');

    const dedicatedId = await manager.create(selectionData(), '独立分支问题', 'dedicated_branch');
    const dedicatedThread = manager.getThread(dedicatedId!)!;
    manager.handleAssociationUpdate({
      pendingThread: pendingManager.get(dedicatedId!)!,
      localThread: { ...dedicatedThread, targetConversationUrl: 'https://chatgpt.com/c/dedicated', dedicatedConversationUrl: 'https://chatgpt.com/c/dedicated' },
      sourceTabId: 1, targetTabId: 3, targetConversationUrl: 'https://chatgpt.com/c/dedicated',
      associationStatus: 'associated', createdAt: now, updatedAt: now,
    });
    const openCount = calls.filter((call) => call.type === 'pointask:open-answer-page').length;
    await manager.startAnswerFlow(dedicatedId!);
    expect(calls.filter((call) => call.type === 'pointask:open-answer-page')).toHaveLength(openCount);
  });
});

describe('thread-isolated prompts and migration', () => {
  it('includes only the supplied current-thread history and truncates old history deterministically', () => {
    const history: LocalMessage[] = [
      { id: 'q1', role: 'user', content: [{ type: 'text', content: `本线程旧问题-${'旧'.repeat(4000)}` }], attachedManually: false, createdAt: now },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', content: '本线程最近回答' }], attachedManually: true, createdAt: now },
    ];
    const prompt = buildPrompt({ selectedText: anchor.selectedText, paragraphText: anchor.paragraphText, userQuestion: '本线程新问题',
      previousLocalMessages: history, mode: 'compact', answerMode: 'workspace', displayId: 'PA-002' });
    expect(prompt).toContain('PA-002'); expect(prompt).toContain('本线程最近回答'); expect(prompt).not.toContain('其他线程秘密');
    expect(prompt).toBe(buildPrompt({ selectedText: anchor.selectedText, paragraphText: anchor.paragraphText, userQuestion: '本线程新问题',
      previousLocalMessages: history, mode: 'compact', answerMode: 'workspace', displayId: 'PA-002' }));
  });

  it('preserves selected source and the current question while rejecting nested generated prompts', () => {
    const selectedText = '选'.repeat(2_100);
    const nested = buildPrompt({ selectedText: '旧选区', paragraphText: '旧段落', userQuestion: '旧问题',
      mode: 'compact', answerMode: 'workspace', displayId: 'PA-001' });
    const prompt = buildPrompt({ selectedText, paragraphText: '当前段落', userQuestion: '当前问题', mode: 'compact',
      answerMode: 'workspace', displayId: 'PA-002', previousLocalMessages: [
        { id: 'nested', role: 'assistant', content: [{ type: 'text', content: nested }], attachedManually: true, createdAt: now },
      ] });
    expect(prompt).toContain(selectedText);
    expect(prompt).toContain('当前问题');
    expect(prompt).not.toContain('旧问题');
  });

  it('migrates legacy threads to dedicated branches idempotently and preserves target URLs', () => {
    const legacy = localThread('legacy', 'PA-001');
    const { displayId: _display, answerMode: _mode, dedicatedConversationUrl: _dedicated, ...old } = legacy;
    void _display; void _mode; void _dedicated;
    const raw = { [STORAGE_KEYS.schemaVersion]: 1, [STORAGE_KEYS.threads]: [{ ...old, targetConversationUrl: 'https://chatgpt.com/c/legacy-target' }] };
    const first = migrateStorage(raw);
    const second = migrateStorage({
      [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION,
      [STORAGE_KEYS.threads]: first.threads,
      [STORAGE_KEYS.pendingThreads]: first.pendingThreads,
      [STORAGE_KEYS.workspaces]: first.workspaces,
      [STORAGE_KEYS.settings]: first.settings,
    });
    expect(first.threads[0]).toMatchObject({ displayId: 'PA-001', answerMode: 'dedicated_branch', dedicatedConversationUrl: 'https://chatgpt.com/c/legacy-target' });
    expect(second).toEqual(first);
    expect(first.workspaces).toEqual([]);
  });
});
