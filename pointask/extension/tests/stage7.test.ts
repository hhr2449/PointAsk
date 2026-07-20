import { describe, expect, it, vi } from 'vitest';
import { AnchorResolver, type AnchorMessageCandidate } from '../src/adapters/anchor-resolver';
import type { SiteAdapter } from '../src/adapters/site-adapter';
import { SpaLifecycleManager } from '../src/content/spa-lifecycle-manager';
import type { LocalThread, TextAnchor } from '../src/shared/local-thread';
import { clearAllPointAskData } from '../src/storage/settings-store';
import { PendingStore } from '../src/storage/pending-store';
import { DEFAULT_SETTINGS, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from '../src/storage/storage-schema';
import { migrateStorage, runStorageMigration } from '../src/storage/migration';
import { ChromeStorageDriver, MemoryStorageDriver, isExtensionContextInvalidated } from '../src/storage/storage-driver';
import { ThreadStore } from '../src/storage/thread-store';
import { stableTextHash } from '../src/shared/text-utils';

const createdAt = '2026-07-12T00:00:00.000Z';
const anchor = (changes: Partial<TextAnchor> = {}): TextAnchor => ({
  pageUrl: 'https://chatgpt.com/c/source', sourcePageUrl: 'https://chatgpt.com/c/source',
  conversationKey: 'https://chatgpt.com/c/source', messageFingerprint: 'message-one', assistantMessageHash: 'message-hash',
  selectedText: '唯一事实', prefixText: '前文 ', suffixText: ' 后文', paragraphText: '前文 唯一事实 后文',
  paragraphHash: 'fnv1a-c27e7c9b', startOffset: 3, endOffset: 7, blockIndex: 0, nodePath: [0],
  schemaVersion: 1, createdAt, ...changes,
});
const thread = (id = 'thread-one'): LocalThread => ({
  displayId: 'PA-001', answerMode: 'dedicated_branch',
  id, anchor: anchor(), sourcePageUrl: anchor().sourcePageUrl, sourceConversationKey: anchor().conversationKey,
  sourceMessageFingerprint: anchor().messageFingerprint,
  messages: [{ id: 'q1', role: 'user', content: [{ type: 'text', content: '问题' }], attachedManually: false, createdAt }],
  status: 'waiting_for_answer', createdAt, updatedAt: createdAt,
});

describe('versioned local stores', () => {
  it('silently retires storage work after the extension context is invalidated', async () => {
    const invalidated = new Error('Extension context invalidated.');
    const area = {
      get: vi.fn().mockRejectedValue(invalidated), set: vi.fn().mockRejectedValue(invalidated), remove: vi.fn().mockRejectedValue(invalidated),
    } as unknown as chrome.storage.StorageArea;
    const driver = new ChromeStorageDriver(area);
    await expect(driver.get(STORAGE_KEYS.threads)).resolves.toEqual({});
    await expect(driver.set({ [STORAGE_KEYS.threads]: [] })).resolves.toBeUndefined();
    await expect(driver.remove(STORAGE_KEYS.threads)).resolves.toBeUndefined();
    expect(isExtensionContextInvalidated(invalidated)).toBe(true);
  });

  it('does not swallow unrelated storage failures', async () => {
    const area = { get: vi.fn().mockRejectedValue(new Error('quota failure')) } as unknown as chrome.storage.StorageArea;
    await expect(new ChromeStorageDriver(area).get(STORAGE_KEYS.threads)).rejects.toThrow('quota failure');
  });

  it('does not overwrite current persisted data during initialization and serializes concurrent stores', async () => {
    const driver = new MemoryStorageDriver(); const first = new ThreadStore(driver); const second = new ThreadStore(driver);
    await Promise.all([first.upsert(thread('one')), second.upsert(thread('two'))]);
    expect(await first.list()).toHaveLength(2);
    const set = vi.spyOn(driver, 'set'); set.mockClear();
    await driver.set({ [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION }); set.mockClear();
    await runStorageMigration(driver);
    expect(set).not.toHaveBeenCalled();
    expect(await first.list()).toHaveLength(2);
  });

  it('supports thread CRUD and conversation queries', async () => {
    const store = new ThreadStore(new MemoryStorageDriver());
    await store.upsert(thread());
    await store.upsert({ ...thread(), status: 'answer_attached' });
    expect(await store.get('thread-one')).toMatchObject({ status: 'answer_attached' });
    expect(await store.listByConversation('https://chatgpt.com/c/source')).toHaveLength(1);
    expect(await store.delete('thread-one')).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it('supports pending CRUD', async () => {
    const store = new PendingStore(new MemoryStorageDriver());
    const pending = {
      displayId: 'PA-001', answerMode: 'dedicated_branch' as const,
      id: 'pending-one', sourcePageUrl: anchor().sourcePageUrl, sourceConversationKey: anchor().conversationKey,
      sourceMessageFingerprint: anchor().messageFingerprint, anchor: anchor(), question: '问题', generatedPrompt: '提示词',
      promptMode: 'compact' as const, status: 'prompt_ready' as const, createdAt, updatedAt: createdAt,
    };
    await store.upsert(pending);
    expect(await store.get(pending.id)).toEqual(pending);
    expect(await store.delete(pending.id)).toBe(true);
  });

  it('migrates old or damaged values to safe defaults', () => {
    const migrated = migrateStorage({
      [STORAGE_KEYS.schemaVersion]: 0,
      [STORAGE_KEYS.threads]: 'damaged',
      [STORAGE_KEYS.pendingThreads]: null,
      [STORAGE_KEYS.settings]: { defaultPromptMode: 'unsafe', pendingExpiryHours: -1 },
    });
    expect(migrated).toEqual({ version: STORAGE_SCHEMA_VERSION, threads: [], pendingThreads: [], workspaces: [], settings: DEFAULT_SETTINGS });
  });

  it('clears only PointAsk-owned keys', async () => {
    const driver = new MemoryStorageDriver();
    const staged = { ...thread(), rounds: [{ id: 'q1', pendingId: 'pending-q1', promptHash: 'hash-q1', assistantFingerprintsBefore: [],
      status: 'answer_ready' as const, persistenceStatus: 'staged' as const, stagedAnswer: [{ type: 'text' as const, content: '临时回答' }],
      answerSource: { conversationUrl: 'https://chatgpt.com/c/workspace', conversationKey: 'https://chatgpt.com/c/workspace', messageFingerprint: 'answer-q1' },
      capturedAt: createdAt, createdAt, updatedAt: createdAt }] };
    await driver.set({ [STORAGE_KEYS.threads]: [staged], 'another-extension:key': 'keep' });
    await clearAllPointAskData(driver);
    expect(driver.data['another-extension:key']).toBe('keep');
    expect(driver.data[STORAGE_KEYS.threads]).toBeUndefined();
  });
});

describe('anchor resolver confidence', () => {
  const resolver = new AnchorResolver();
  const element = () => document.createElement('p');
  const message = (blocks: string[]): AnchorMessageCandidate => ({
    messageFingerprint: 'message-one', assistantMessageHash: 'message-hash',
    blocks: blocks.map((text, blockIndex) => ({ element: element(), text, blockIndex })),
  });

  it('resolves identical content through wrapper and whitespace changes', () => {
    const candidate = message(['  前文   唯一事实\n后文  ']);
    const result = resolver.resolve(anchor({ paragraphHash: '' }), [candidate]);
    expect(result.status).toBe('resolved');
    expect(result.element).toBe(candidate.blocks[0]?.element);
  });

  it('uses prefix and suffix to disambiguate repeated selected text', () => {
    const first = message(['错误前文 唯一事实 错误后文', '前文 唯一事实 后文']);
    expect(resolver.resolve(anchor({ paragraphHash: '', blockIndex: undefined }), [first]).element).toBe(first.blocks[1]?.element);
  });

  it('fails safely for equal candidates, pending pages, and missing anchors', () => {
    const duplicate = message(['前文 唯一事实 后文', '前文 唯一事实 后文']);
    expect(resolver.resolve(anchor({ paragraphHash: '', prefixText: '', suffixText: '', blockIndex: undefined }), [duplicate]).status)
      .toBe('ambiguous');
    expect(resolver.resolve(anchor(), [], false).status).toBe('pending');
    expect(resolver.resolve(anchor(), [message(['其他内容'])], true).status).toBe('orphaned');
  });

  it('recovers from a changed turn fingerprint using an exact paragraph hash', () => {
    const changed = message(['前文 唯一事实 后文']);
    changed.messageFingerprint = 'changed-turn-id';
    changed.assistantMessageHash = 'changed-message-hash';
    expect(resolver.resolve(anchor({ paragraphHash: stableTextHash('前文 唯一事实 后文') }), [changed]).status).toBe('resolved');
  });
});

describe('SPA lifecycle', () => {
  it('debounces DOM bursts, detects navigation, and cleans up', async () => {
    vi.useFakeTimers();
    let observerCallback: () => void = () => undefined;
    const cleanup = vi.fn();
    const adapter = {
      observePageChanges: (callback: () => void) => { observerCallback = callback; return cleanup; },
    } as unknown as SiteAdapter;
    const callback = vi.fn();
    const lifecycle = new SpaLifecycleManager(adapter, callback);
    lifecycle.start();
    observerCallback(); observerCallback(); observerCallback();
    await vi.advanceTimersByTimeAsync(250);
    expect(callback).toHaveBeenCalledTimes(1);
    history.pushState({}, '', '/c/spa-next');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledTimes(2);
    lifecycle.stop();
    expect(cleanup).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
