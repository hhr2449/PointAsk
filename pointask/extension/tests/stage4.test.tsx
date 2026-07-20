import { act } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import type { PendingThread } from '../src/bridge/pending-thread-manager';
import { isCompatibleChatGptTargetUrl, isPointAskRuntimeMessage } from '../src/bridge/runtime-messages';
import { WebConversationBridge } from '../src/bridge/web-conversation-bridge';
import { PENDING_EXPIRY_MS, PendingAssociationCoordinator } from '../src/background/pending-association-coordinator';
import { PendingBannerManager } from '../src/content/pending-banner-manager';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { ThreadStore } from '../src/storage/thread-store';
import { PendingStore } from '../src/storage/pending-store';
import { ThreadReturnStore } from '../src/storage/navigation-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pending = (id = 'pointask-pending-one'): PendingThread => ({
  displayId: 'PA-001', answerMode: 'dedicated_branch',
  id,
  sourcePageUrl: 'https://chatgpt.com/c/source',
  sourceConversationKey: 'https://chatgpt.com/c/source',
  sourceMessageFingerprint: `fingerprint-${id}`,
  anchor: {
    pageUrl: 'https://chatgpt.com/c/source', prefixText: '', suffixText: '', paragraphHash: `paragraph-${id}`,
    assistantMessageHash: `assistant-${id}`, startOffset: 0, endOffset: 4, schemaVersion: 1, createdAt: '2026-07-12T00:00:00.000Z',
    selectedText: `选中文字-${id}`,
    paragraphText: '脱敏段落',
    messageFingerprint: `fingerprint-${id}`,
    conversationKey: 'https://chatgpt.com/c/source',
    sourcePageUrl: 'https://chatgpt.com/c/source',
  },
  question: `局部问题-${id}`,
  generatedPrompt: `生成提示词-${id}`,
  promptMode: 'compact',
  status: 'prompt_ready',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
});

describe('runtime validation', () => {
  it('accepts valid fields and rejects unknown, missing, or unsafe URL fields', () => {
    expect(isPointAskRuntimeMessage({ type: 'pointask:create-pending-thread', pendingThread: pending() })).toBe(true);
    expect(isPointAskRuntimeMessage({ type: 'pointask:open-target-chat', pendingThreadId: '' })).toBe(false);
    expect(isPointAskRuntimeMessage({ type: 'pointask:cancel-pending-thread', pendingThreadId: 'id', extra: true })).toBe(false);
    expect(isPointAskRuntimeMessage({
      type: 'pointask:open-or-auto-send-workspace', pendingThreadId: 'id', promptHash: 'hash', attemptId: 'attempt',
    })).toBe(true);
    const attachment = { roundId: 'round-1', richContent: [{ type: 'text', content: '回答' }], answerSource: {
      conversationUrl: 'https://chatgpt.com/c/workspace', conversationKey: 'https://chatgpt.com/c/workspace', messageFingerprint: 'answer-1',
    } };
    expect(isPointAskRuntimeMessage({ type: 'pointask:attach-rounds', pendingThreadId: 'id', rounds: [attachment],
      targetUrl: 'https://chatgpt.com/c/workspace' })).toBe(true);
    expect(isPointAskRuntimeMessage({ type: 'pointask:stage-round-answer', pendingThreadId: 'id', roundId: 'round-1', promptHash: 'hash',
      targetUrl: 'https://chatgpt.com/c/workspace', captureFailed: false, richContent: attachment.richContent,
      answerSource: attachment.answerSource })).toBe(true);
    expect(isPointAskRuntimeMessage({ type: 'pointask:attach-rounds', pendingThreadId: 'id', rounds: [{ ...attachment, roundId: '' }],
      targetUrl: 'https://chatgpt.com/c/workspace' })).toBe(false);
    expect(isPointAskRuntimeMessage({
      type: 'pointask:associate-target-page', pendingThreadId: 'id', targetUrl: 'https://example.com/',
    })).toBe(false);
  });

  it('allows only the safe new-chat SPA URL transition', () => {
    expect(isCompatibleChatGptTargetUrl('https://chatgpt.com/', 'https://chatgpt.com/c/new-id')).toBe(true);
    expect(isCompatibleChatGptTargetUrl('https://chatgpt.com/c/same?x=1', 'https://chatgpt.com/c/same')).toBe(true);
    expect(isCompatibleChatGptTargetUrl('https://chatgpt.com/c/one', 'https://chatgpt.com/c/two')).toBe(false);
    expect(isCompatibleChatGptTargetUrl('https://example.com/', 'https://chatgpt.com/c/new-id')).toBe(false);
  });
});

describe('pending association state', () => {
  it('reserves each prompt hash only once after an explicit send action', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const record = coordinator.create({ ...pending(), promptHash: 'hash-one' }, 1);
    coordinator.markTargetOpened(record.pendingThread.id, 2, 'https://chatgpt.com/c/target');
    expect(coordinator.reserveSubmission(record.pendingThread.id, 2, 'hash-one', 'https://chatgpt.com/c/target')?.pendingThread.submittedPromptHash).toBe('hash-one');
    expect(coordinator.reserveSubmission(record.pendingThread.id, 2, 'hash-one', 'https://chatgpt.com/c/target')).toBeNull();
    expect(coordinator.reserveSubmission(record.pendingThread.id, 3, 'hash-one', 'https://chatgpt.com/c/target')).toBeNull();
  });

  it('releases a reservation only after a failed submit so the user can retry', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const record = coordinator.create({ ...pending(), promptHash: 'hash-retry' }, 1);
    coordinator.markTargetOpened(record.pendingThread.id, 2, 'https://chatgpt.com/c/target');
    coordinator.reserveSubmission(record.pendingThread.id, 2, 'hash-retry', 'https://chatgpt.com/c/target');
    const released = coordinator.releaseSubmission(record.pendingThread.id, 2, 'hash-retry');
    expect(released?.localThread.status).toBe('waiting_for_submission');
    expect(released?.pendingThread.submittedPromptHash).toBeUndefined();
    expect(coordinator.reserveSubmission(record.pendingThread.id, 2, 'hash-retry', 'https://chatgpt.com/c/target')).not.toBeNull();
  });

  it('keeps multiple pending threads isolated by ID and tab association', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending('one'), 1);
    coordinator.create(pending('two'), 2);
    coordinator.markTargetOpened('one', 11, 'https://chatgpt.com/');
    coordinator.markTargetOpened('two', 22, 'https://chatgpt.com/');
    expect(coordinator.forPage(11).map((record) => record.pendingThread.id)).toEqual(['one']);
    expect(coordinator.forPage(22).map((record) => record.pendingThread.id)).toEqual(['two']);
  });

  it('updates only the visible target URL and supports cancellation', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending(), 1);
    coordinator.markTargetOpened(pending().id, 9, 'https://chatgpt.com/');
    expect(coordinator.associate(pending().id, 9, 'https://chatgpt.com/c/new-conversation')?.targetConversationUrl)
      .toBe('https://chatgpt.com/c/new-conversation');
    expect(coordinator.get(pending().id)?.pendingThread.targetConversationUrl)
      .toBe('https://chatgpt.com/c/new-conversation');
    expect(coordinator.associate(pending().id, 10, 'https://chatgpt.com/c/wrong')).toBeNull();
    expect(coordinator.cancel(pending().id, 9)?.associationStatus).toBe('cancelled');
    expect(coordinator.forPage(9)).toHaveLength(0);
  });

  it('removes expired pending associations', () => {
    let now = new Date('2026-07-12T00:00:00.000Z');
    const coordinator = new PendingAssociationCoordinator(() => now);
    coordinator.create(pending(), 1);
    now = new Date(now.getTime() + PENDING_EXPIRY_MS + 1);
    expect(coordinator.get(pending().id)).toBeNull();
  });
});

describe('service worker routing', () => {
  let handleRuntimeMessage: typeof import('../src/background/index')['handleRuntimeMessage'];

  beforeAll(async () => {
    vi.stubGlobal('chrome', {
      tabs: {},
      storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() } },
    });
    ({ handleRuntimeMessage } = await import('../src/background/index'));
  });

  it('creates pending state, requests a visible ChatGPT tab, and associates source with target', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const tabs = {
      create: vi.fn().mockResolvedValue({ id: 20, url: 'https://chatgpt.com/' }),
      update: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockResolvedValue({}),
    };
    const deps = { coordinator, tabs };
    const created = await handleRuntimeMessage(
      { type: 'pointask:create-pending-thread', pendingThread: pending() }, { tab: { id: 10 } }, deps,
    );
    expect(created.ok).toBe(true);
    const opened = await handleRuntimeMessage(
      { type: 'pointask:open-target-chat', pendingThreadId: pending().id }, { tab: { id: 10 } }, deps,
    );
    expect(opened.ok).toBe(true);
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://chatgpt.com/', active: true });
    expect(coordinator.get(pending().id)).toMatchObject({ sourceTabId: 10, targetTabId: 20 });

    const associated = await handleRuntimeMessage(
      { type: 'pointask:associate-target-page', pendingThreadId: pending().id, targetUrl: 'https://chatgpt.com/c/visible' },
      { tab: { id: 20 } }, deps,
    );
    expect(associated.ok).toBe(true);
    expect(coordinator.get(pending().id)?.targetConversationUrl).toBe('https://chatgpt.com/c/visible');
  });

  it('rebinds the same source conversation after refresh instead of enforcing the old tab ID', async () => {
    const driver = new MemoryStorageDriver(); const threadStore = new ThreadStore(driver); const pendingStore = new PendingStore(driver);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const original = coordinator.create(pending(), 10);
    await threadStore.upsert(original.localThread); await pendingStore.upsert(original.pendingThread);
    const tabs = { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}) };
    const result = await handleRuntimeMessage({ type: 'pointask:update-local-thread', pendingThread: original.pendingThread,
      localThread: { ...original.localThread, status: 'waiting_for_submission' } },
    { tab: { id: 99, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs, threadStore, pendingStore });
    expect(result).toMatchObject({ ok: true });
    expect(coordinator.get(pending().id)?.sourceTabId).toBe(99);
  });

  it('marks an attached banner completed on return and optionally closes only an inactive dedicated tab', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending(), 10); coordinator.markTargetOpened(pending().id, 30, 'https://chatgpt.com/c/target');
    coordinator.attachAnswer(pending().id, 30, '回答', 'https://chatgpt.com/c/target', false);
    const tabs = { create: vi.fn(), update: vi.fn().mockResolvedValue({}), sendMessage: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockImplementation((tabId: number) => Promise.resolve(tabId === 10
        ? { id: 10, url: 'https://chatgpt.com/c/source', active: false }
        : { id: 30, url: 'https://chatgpt.com/c/target', active: false })), remove: vi.fn().mockResolvedValue(undefined) };
    const settingsStore = { get: vi.fn().mockResolvedValue({ pendingExpiryHours: 24, closeDedicatedTabAfterAttach: true }) };
    const result = await handleRuntimeMessage({ type: 'pointask:pending-thread-updated', pendingThreadId: pending().id, action: 'return-source' },
      { tab: { id: 30, url: 'https://chatgpt.com/c/target' } }, { coordinator, tabs, settingsStore } as never);
    expect(result.ok).toBe(true); expect(coordinator.get(pending().id)?.associationStatus).toBe('completed');
    expect(coordinator.forPage(30)).toHaveLength(0); expect(tabs.remove).toHaveBeenCalledWith(30);
  });

  it('returns an attached current-conversation thread without reloading its shared source tab', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const current = { ...pending('current-return'), answerMode: 'current_conversation' as const };
    coordinator.create(current, 10); coordinator.markTargetOpened(current.id, 10, 'https://chatgpt.com/c/source');
    coordinator.attachAnswer(current.id, 10, '回答', 'https://chatgpt.com/c/source', false);
    const tabs = { create: vi.fn(), update: vi.fn().mockResolvedValue({}), sendMessage: vi.fn().mockResolvedValue({}) };
    const result = await handleRuntimeMessage({ type: 'pointask:pending-thread-updated', pendingThreadId: current.id, action: 'return-source' },
      { tab: { id: 10, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs });
    expect(result.ok).toBe(true);
    expect(coordinator.get(current.id)?.associationStatus).toBe('completed');
    expect(tabs.update).toHaveBeenCalledWith(10, { active: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('reopens the stable target URL when the remembered target tab was closed', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending(), 10); coordinator.markTargetOpened(pending().id, 20, 'https://chatgpt.com/c/target');
    const tabs = { update: vi.fn().mockRejectedValue(new Error('closed')), create: vi.fn().mockResolvedValue({ id: 40, url: 'https://chatgpt.com/c/target' }), sendMessage: vi.fn().mockResolvedValue({}) };
    const result = await handleRuntimeMessage({ type: 'pointask:open-answer-page', pendingThreadId: pending().id },
      { tab: { id: 10, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs });
    expect(result.ok).toBe(true); expect(tabs.create).toHaveBeenCalledWith({ url: 'https://chatgpt.com/c/target', active: true });
    expect(coordinator.get(pending().id)?.targetTabId).toBe(40);
  });

  it('reuses an already open matching ChatGPT target tab instead of creating another one', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending(), 10); coordinator.markTargetOpened(pending().id, 20, 'https://chatgpt.com/c/target');
    const tabs = {
      get: vi.fn().mockRejectedValue(new Error('remembered tab closed')),
      query: vi.fn().mockResolvedValue([{ id: 44, url: 'https://chatgpt.com/c/target' }]),
      update: vi.fn().mockResolvedValue({}), create: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}),
    };
    const result = await handleRuntimeMessage({ type: 'pointask:open-answer-page', pendingThreadId: pending().id },
      { tab: { id: 10, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs });
    expect(result.ok).toBe(true);
    expect(tabs.update).toHaveBeenCalledWith(44, { active: true });
    expect(tabs.create).not.toHaveBeenCalled();
    expect(coordinator.get(pending().id)?.targetTabId).toBe(44);
  });

  it('automatically sends once only when the matching Workspace tab already exists', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const workspace = { ...pending('workspace-existing'), answerMode: 'workspace' as const, workspaceId: 'workspace', promptHash: 'hash-existing' };
    coordinator.create(workspace, 10); coordinator.markTargetOpened(workspace.id, 20, 'https://chatgpt.com/c/workspace');
    let executions = 0;
    const tabs = {
      get: vi.fn().mockResolvedValue({ id: 20, url: 'https://chatgpt.com/c/workspace' }), query: vi.fn(),
      create: vi.fn(), update: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockImplementation((tabId: number, message: { type?: string; record?: { pendingThread: PendingThread }; attemptId?: string }) => {
        if (message.type === 'pointask:ping') return Promise.resolve({
          ready: true, composerReady: true, conversationUrl: 'https://chatgpt.com/c/workspace',
        });
        if (message.type === 'pointask:execute-pending-send') {
          executions += 1;
          coordinator.reserveSubmission(workspace.id, tabId, 'hash-existing', 'https://chatgpt.com/c/workspace');
          return Promise.resolve({ ok: true, attemptId: message.attemptId });
        }
        return Promise.resolve({});
      }),
    };
    const result = await handleRuntimeMessage({
      type: 'pointask:open-or-auto-send-workspace', pendingThreadId: workspace.id,
      promptHash: 'hash-existing', attemptId: 'attempt-existing',
    }, { tab: { id: 10, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs });
    expect(result).toMatchObject({ ok: true, data: { autoSent: true } });
    expect(tabs.create).not.toHaveBeenCalled();
    expect(executions).toBe(1);
    expect(coordinator.get(workspace.id)?.pendingThread.submittedPromptHash).toBe('hash-existing');
  });

  it('opens a missing Workspace tab but never fills or sends after creating it', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const workspace = { ...pending('workspace-missing'), answerMode: 'workspace' as const, workspaceId: 'workspace', promptHash: 'hash-missing' };
    coordinator.create(workspace, 10); coordinator.markTargetOpened(workspace.id, 20, 'https://chatgpt.com/c/workspace');
    const tabs = {
      get: vi.fn().mockRejectedValue(new Error('closed')), query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 55, url: 'about:blank', pendingUrl: 'https://chatgpt.com/c/workspace' }),
      update: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}),
    };
    const result = await handleRuntimeMessage({
      type: 'pointask:open-or-auto-send-workspace', pendingThreadId: workspace.id,
      promptHash: 'hash-missing', attemptId: 'attempt-missing',
    }, { tab: { id: 10, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs });
    expect(result).toMatchObject({ ok: true, data: { autoSent: false } });
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://chatgpt.com/c/workspace', active: true });
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(55, expect.objectContaining({ type: 'pointask:ping' }));
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(55, expect.objectContaining({ type: 'pointask:execute-pending-send' }));
    expect(coordinator.get(workspace.id)?.pendingThread.submittedPromptHash).toBeUndefined();
  });

  it('falls back from a stale sourceTabId to an existing source URL and stores exact card return navigation', async () => {
    const driver = new MemoryStorageDriver(); const threadReturnStore = new ThreadReturnStore(driver);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending('return-existing-source'), 10);
    coordinator.markTargetOpened('return-existing-source', 30, 'https://chatgpt.com/c/target');
    const tabs = {
      get: vi.fn().mockRejectedValue(new Error('source closed')),
      query: vi.fn().mockResolvedValue([{ id: 44, url: 'https://chatgpt.com/c/source' }]),
      create: vi.fn(), update: vi.fn().mockResolvedValue({}), sendMessage: vi.fn().mockResolvedValue({}),
    };
    const result = await handleRuntimeMessage({
      type: 'pointask:pending-thread-updated', pendingThreadId: 'return-existing-source', action: 'return-source',
    }, { tab: { id: 30, url: 'https://chatgpt.com/c/target' } }, { coordinator, tabs, threadReturnStore });
    expect(result.ok).toBe(true);
    expect(tabs.update).toHaveBeenCalledWith(44, { active: true });
    expect(tabs.create).not.toHaveBeenCalled();
    expect(await threadReturnStore.get()).toMatchObject({ threadId: 'return-existing-source', sourceConversationUrl: 'https://chatgpt.com/c/source' });
    expect(tabs.sendMessage).toHaveBeenCalledWith(44, { type: 'pointask:thread-return-ready', threadId: 'return-existing-source' });
  });

  it('does not activate a remembered tab after it navigated away from the associated conversation', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending(), 10); coordinator.markTargetOpened(pending().id, 20, 'https://chatgpt.com/c/target');
    const tabs = {
      get: vi.fn().mockResolvedValue({ id: 20, url: 'https://chatgpt.com/c/unrelated' }),
      query: vi.fn().mockResolvedValue([{ id: 45, url: 'https://chatgpt.com/c/target' }]),
      update: vi.fn().mockResolvedValue({}), create: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}),
    };
    const result = await handleRuntimeMessage({ type: 'pointask:open-answer-page', pendingThreadId: pending().id },
      { tab: { id: 10, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs });
    expect(result.ok).toBe(true);
    expect(tabs.update).toHaveBeenCalledWith(45, { active: true });
    expect(tabs.update).not.toHaveBeenCalledWith(20, { active: true });
  });

  it('does not restore a completed attachment banner after target-page refresh', async () => {
    const driver = new MemoryStorageDriver(); const threadStore = new ThreadStore(driver); const pendingStore = new PendingStore(driver);
    const seed = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    seed.create(pending(), 1); seed.markTargetOpened(pending().id, 2, 'https://chatgpt.com/c/target');
    const attached = seed.attachAnswer(pending().id, 2, '已附加回答', 'https://chatgpt.com/c/target', false)!;
    await threadStore.upsert(attached.localThread); await pendingStore.upsert(attached.pendingThread);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T02:00:00.000Z'));
    const tabs = { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn() };
    const result = await handleRuntimeMessage({ type: 'pointask:get-page-pending-threads', currentUrl: 'https://chatgpt.com/c/target' },
      { tab: { id: 22, url: 'https://chatgpt.com/c/target' } }, { coordinator, tabs, threadStore, pendingStore });
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('restores a continued Workspace round by pendingId after a service-worker restart', async () => {
    const driver = new MemoryStorageDriver(); const threadStore = new ThreadStore(driver); const pendingStore = new PendingStore(driver);
    const stableThreadId = 'workspace-stable-thread'; const nextPendingId = 'workspace-round-two';
    const seed = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const first = seed.create({ ...pending(stableThreadId), answerMode: 'workspace' }, 1);
    const nextPending = { ...pending(nextPendingId), threadId: stableThreadId, roundId: 'round-2', answerMode: 'workspace' as const,
      promptHash: 'round-two-hash', status: 'answer_ready' as const, targetConversationUrl: 'https://chatgpt.com/c/workspace' };
    const localThread = { ...first.localThread, id: stableThreadId, answerMode: 'workspace' as const,
      targetConversationUrl: 'https://chatgpt.com/c/workspace', status: 'answer_ready' as const,
      messages: [{ id: 'round-2', role: 'user' as const, content: [{ type: 'text' as const, content: '第二轮问题' }],
        attachedManually: false, createdAt: nextPending.createdAt }],
      rounds: [{ id: 'round-2', pendingId: nextPendingId, promptHash: 'round-two-hash', assistantFingerprintsBefore: [],
        status: 'answer_ready' as const, persistenceStatus: 'not_captured' as const,
        createdAt: nextPending.createdAt, updatedAt: nextPending.updatedAt }] };
    await threadStore.upsert(localThread); await pendingStore.replaceForThread(nextPending);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T02:00:00.000Z'));
    const result = await handleRuntimeMessage({ type: 'pointask:get-page-pending-threads', currentUrl: 'https://chatgpt.com/c/workspace' },
      { tab: { id: 22, url: 'https://chatgpt.com/c/workspace' } },
      { coordinator, tabs: { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn() }, threadStore, pendingStore });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject([{ pendingThread: { id: nextPendingId, threadId: stableThreadId }, targetTabId: 22 }]);
  });

  it('persists a staged answer and restores it after a service-worker restart', async () => {
    const driver = new MemoryStorageDriver(); const threadStore = new ThreadStore(driver); const pendingStore = new PendingStore(driver);
    const value = { ...pending('workspace-staged-restart'), threadId: 'workspace-staged-restart', roundId: 'q1', answerMode: 'workspace' as const,
      promptHash: 'stage-restart-hash', status: 'answer_ready' as const, targetConversationUrl: 'https://chatgpt.com/c/workspace' };
    const seed = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const initial = seed.create(value, 1);
    seed.create(value, 1, { ...initial.localThread, status: 'answer_ready', messages: [{ id: 'q1', role: 'user',
      content: [{ type: 'text', content: '问题' }], attachedManually: false, createdAt: value.createdAt }], rounds: [{ id: 'q1',
      pendingId: value.id, promptHash: 'stage-restart-hash', assistantFingerprintsBefore: [], status: 'answer_ready',
      persistenceStatus: 'not_captured', createdAt: value.createdAt, updatedAt: value.updatedAt }] });
    seed.markTargetOpened(value.id, 22, 'https://chatgpt.com/c/workspace');
    const staged = await handleRuntimeMessage({ type: 'pointask:stage-round-answer', pendingThreadId: value.id, roundId: 'q1',
      promptHash: 'stage-restart-hash', targetUrl: 'https://chatgpt.com/c/workspace', captureFailed: false,
      richContent: [{ type: 'text', content: '重启后仍存在的暂存回答' }], answerSource: {
        conversationUrl: 'https://chatgpt.com/c/workspace', conversationKey: 'https://chatgpt.com/c/workspace', messageFingerprint: 'answer-q1',
      } }, { tab: { id: 22, url: 'https://chatgpt.com/c/workspace' } },
    { coordinator: seed, tabs: { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}) }, threadStore, pendingStore });
    expect(staged.ok).toBe(true);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T02:00:00.000Z'));
    const restored = await handleRuntimeMessage({ type: 'pointask:get-page-pending-threads', currentUrl: 'https://chatgpt.com/c/workspace' },
      { tab: { id: 33, url: 'https://chatgpt.com/c/workspace' } },
      { coordinator, tabs: { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn() }, threadStore, pendingStore });
    expect(restored.data).toMatchObject([{ localThread: { rounds: [{ persistenceStatus: 'staged',
      stagedAnswer: [{ type: 'text', content: '重启后仍存在的暂存回答' }] }] } }]);
  });

  it('keeps staged content when the atomic attachment write fails', async () => {
    const driver = new MemoryStorageDriver(); const threadStore = new ThreadStore(driver); const pendingStore = new PendingStore(driver);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const value = { ...pending('workspace-attach-storage-failure'), threadId: 'workspace-attach-storage-failure', roundId: 'q1',
      answerMode: 'workspace' as const, promptHash: 'staged-hash', status: 'answer_ready' as const,
      targetConversationUrl: 'https://chatgpt.com/c/workspace' };
    const initial = coordinator.create(value, 1); const locator = { conversationUrl: 'https://chatgpt.com/c/workspace',
      conversationKey: 'https://chatgpt.com/c/workspace', messageFingerprint: 'answer-q1' };
    const localThread = { ...initial.localThread, status: 'answer_ready' as const, targetConversationUrl: 'https://chatgpt.com/c/workspace',
      messages: [{ id: 'q1', role: 'user' as const, content: [{ type: 'text' as const, content: '问题' }], attachedManually: false, createdAt: value.createdAt }],
      rounds: [{ id: 'q1', pendingId: value.id, promptHash: 'staged-hash', assistantFingerprintsBefore: [], status: 'answer_ready' as const,
        persistenceStatus: 'staged' as const, stagedAnswer: [{ type: 'text' as const, content: '必须保留的暂存回答' }], answerSource: locator,
        createdAt: value.createdAt, updatedAt: value.updatedAt }] };
    coordinator.create(value, 1, localThread); coordinator.markTargetOpened(value.id, 22, 'https://chatgpt.com/c/workspace');
    await threadStore.upsertAssociation(localThread, value);
    vi.spyOn(driver, 'set').mockRejectedValueOnce(new Error('quota failure'));
    const result = await handleRuntimeMessage({ type: 'pointask:attach-rounds', pendingThreadId: value.id, targetUrl: 'https://chatgpt.com/c/workspace',
      rounds: [{ roundId: 'q1', richContent: [{ type: 'text', content: '必须保留的暂存回答' }], answerSource: locator }] },
    { tab: { id: 22, url: 'https://chatgpt.com/c/workspace' } },
    { coordinator, tabs: { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn() }, threadStore, pendingStore });
    expect(result.ok).toBe(false);
    expect(coordinator.get(value.id)?.localThread.rounds?.[0]).toMatchObject({ persistenceStatus: 'staged',
      stagedAnswer: [{ type: 'text', content: '必须保留的暂存回答' }] });
    expect((await threadStore.get(value.threadId))?.rounds?.[0]?.persistenceStatus).toBe('staged');
  });

  it('routes manual association, return-to-source, cancellation, and rejects invalid messages', async () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending(), 10);
    const tabs = {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockResolvedValue({}),
    };
    const deps = { coordinator, tabs };
    await handleRuntimeMessage(
      { type: 'pointask:pending-thread-updated', pendingThreadId: pending().id, action: 'manual-branch' },
      { tab: { id: 10 } }, deps,
    );
    expect(coordinator.forPage(30)).toHaveLength(1);
    await handleRuntimeMessage(
      { type: 'pointask:associate-target-page', pendingThreadId: pending().id, targetUrl: 'https://chatgpt.com/c/branch' },
      { tab: { id: 30 } }, deps,
    );
    await handleRuntimeMessage(
      { type: 'pointask:pending-thread-updated', pendingThreadId: pending().id, action: 'return-source' },
      { tab: { id: 30 } }, deps,
    );
    expect(tabs.update).toHaveBeenCalledWith(10, { active: true });
    const cancelled = await handleRuntimeMessage(
      { type: 'pointask:cancel-pending-thread', pendingThreadId: pending().id }, { tab: { id: 30 } }, deps,
    );
    expect(cancelled.ok).toBe(true);
    await expect(handleRuntimeMessage({ type: 'bad' }, { tab: { id: 30 } }, deps))
      .resolves.toMatchObject({ ok: false });
  });

  it('recovers an exact persisted target association before manual attachment', async () => {
    const driver = new MemoryStorageDriver();
    const threadStore = new ThreadStore(driver);
    const pendingStore = new PendingStore(driver);
    const storedPending = { ...pending(), targetConversationUrl: 'https://chatgpt.com/c/recovered' };
    const seed = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    seed.create(storedPending, 1);
    const stored = seed.markTargetOpened(storedPending.id, 2, storedPending.targetConversationUrl)!;
    await threadStore.upsert(stored.localThread);
    await pendingStore.upsert(storedPending);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T02:00:00.000Z'));
    const tabs = { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}) };
    const result = await handleRuntimeMessage({
      type: 'pointask:attach-answer', pendingThreadId: storedPending.id,
      selectedText: '用户确认选择的回答', targetUrl: storedPending.targetConversationUrl, replace: false,
    }, { tab: { id: 42 } }, { coordinator, tabs, threadStore, pendingStore });
    expect(result.ok).toBe(true);
    expect(coordinator.get(storedPending.id)?.targetTabId).toBe(42);
    expect((await threadStore.get(storedPending.id))?.status).toBe('answer_attached');
  });

  it('recovers after a new-chat SPA URL changes and the service worker restarts', async () => {
    const driver = new MemoryStorageDriver();
    const threadStore = new ThreadStore(driver); const pendingStore = new PendingStore(driver);
    const storedPending = { ...pending('spa-recovery'), targetConversationUrl: 'https://chatgpt.com/' };
    const seed = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    seed.create(storedPending, 1);
    const stored = seed.markTargetOpened(storedPending.id, 2, storedPending.targetConversationUrl)!;
    await threadStore.upsert(stored.localThread); await pendingStore.upsert(storedPending);
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T02:00:00.000Z'));
    const tabs = { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}) };
    const result = await handleRuntimeMessage({
      type: 'pointask:attach-answer', pendingThreadId: storedPending.id,
      selectedText: '用户主动选中的回答', targetUrl: 'https://chatgpt.com/c/generated-id', replace: false,
    }, { tab: { id: 42 } }, { coordinator, tabs, threadStore, pendingStore });
    expect(result.ok).toBe(true);
    expect((await threadStore.get(storedPending.id))?.targetConversationUrl).toBe('https://chatgpt.com/c/generated-id');
  });

  it('reattaches a current-conversation pending after service-worker restart without transient target routing', async () => {
    const driver = new MemoryStorageDriver(); const threadStore = new ThreadStore(driver); const pendingStore = new PendingStore(driver);
    const currentPending = { ...pending('current-recovery'), answerMode: 'current_conversation' as const,
      sourcePageUrl: 'https://chatgpt.com/c/source', sourceConversationKey: 'https://chatgpt.com/c/source' };
    const seed = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    const stored = seed.create(currentPending, 1);
    await threadStore.upsert({ ...stored.localThread, answerMode: 'current_conversation', status: 'waiting_for_answer', targetConversationUrl: undefined });
    await pendingStore.upsert({ ...stored.pendingThread, answerMode: 'current_conversation', targetConversationUrl: undefined });
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T02:00:00.000Z'));
    const tabs = { create: vi.fn(), update: vi.fn(), sendMessage: vi.fn().mockResolvedValue({}) };
    const restored = await handleRuntimeMessage({ type: 'pointask:get-page-pending-threads', currentUrl: 'https://chatgpt.com/c/source' },
      { tab: { id: 99, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs, threadStore, pendingStore });
    expect(restored.ok).toBe(true);
    expect(restored.data).toHaveLength(1);
    const result = await handleRuntimeMessage({ type: 'pointask:attach-answer', pendingThreadId: currentPending.id,
      selectedText: '同页手动选择的回答', targetUrl: 'https://chatgpt.com/c/source', replace: false },
    { tab: { id: 99, url: 'https://chatgpt.com/c/source' } }, { coordinator, tabs, threadStore, pendingStore });
    expect(result.ok).toBe(true);
    expect(coordinator.get(currentPending.id)?.sourceTabId).toBe(-1);
    expect(coordinator.get(currentPending.id)?.targetTabId).toBe(99);
    expect((await threadStore.get(currentPending.id))?.messages.at(-1)?.content).toEqual([{ type: 'text', content: '同页手动选择的回答' }]);
  });
});

describe('web bridge and pending banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<textarea id="chatgpt-composer">用户自己的内容</textarea>';
  });

  it('restores a banner after a content-page refresh without touching the ChatGPT composer', async () => {
    const record = {
      pendingThread: pending(), sourceTabId: 1, targetTabId: 2,
      localThread: {
        id: pending().id,
        anchor: pending().anchor,
        sourcePageUrl: pending().sourcePageUrl,
        sourceConversationKey: pending().sourceConversationKey,
        sourceMessageFingerprint: pending().sourceMessageFingerprint,
        targetConversationUrl: 'https://chatgpt.com/',
        messages: [{
          id: 'q1', role: 'user' as const, content: pending().question,
          attachedManually: false, createdAt: '2026-07-12T00:00:00.000Z',
        }],
        status: 'waiting_for_answer' as const,
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
      targetConversationUrl: 'https://chatgpt.com/', associationStatus: 'target_opened' as const,
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const listeners = new Set<(message: unknown) => void>();
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) => {
      if (message.type === 'pointask:get-page-pending-threads') return Promise.resolve({ ok: true, data: [record] });
      return Promise.resolve({ ok: true, data: record });
    });
    const runtime = {
      sendMessage,
      onMessage: {
        addListener: (listener: (message: unknown) => void) => listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) => listeners.delete(listener),
      },
    };
    const bridge = new WebConversationBridge(runtime);
    const clipboard = new ClipboardManager({ writeText: vi.fn().mockResolvedValue(undefined) }, vi.fn());
    const first = new PendingBannerManager(bridge, clipboard);
    await act(async () => { await first.start(); });
    expect(document.querySelector('pointask-pending-thread-banner')?.shadowRoot?.textContent)
      .toContain('正在等待回答……');
    await act(() => first.stop());

    const refreshed = new PendingBannerManager(bridge, clipboard);
    await act(async () => { await refreshed.start(); });
    expect(document.querySelector('pointask-pending-thread-banner')?.shadowRoot?.textContent).toContain(pending().question);
    expect((document.getElementById('chatgpt-composer') as HTMLTextAreaElement).value).toBe('用户自己的内容');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'pointask:get-page-pending-threads')).toBe(true);
    await act(() => refreshed.stop());
  });
});
