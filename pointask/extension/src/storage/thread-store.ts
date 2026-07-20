import type { LocalThread } from '../shared/local-thread';
import type { PendingThread } from '../bridge/pending-thread-manager';
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage-schema';
import { migrateStorage } from './migration';
import { withStorageLock, type StorageDriver } from './storage-driver';
import { cleanupExpiredStagedAnswers as cleanupThreads } from '../shared/staged-answer-retention';

export class ThreadStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly driver: StorageDriver) {}

  async list(): Promise<LocalThread[]> {
    const raw = await this.driver.get([STORAGE_KEYS.threads, STORAGE_KEYS.schemaVersion]);
    const schema = migrateStorage(raw);
    const cleaned = cleanupThreads(schema.threads, Date.now());
    if (raw[STORAGE_KEYS.schemaVersion] !== STORAGE_SCHEMA_VERSION || cleaned.changed) await this.write(cleaned.threads);
    return cleaned.threads;
  }
  async get(id: string): Promise<LocalThread | null> { return (await this.list()).find((thread) => thread.id === id) ?? null; }
  async listByConversation(conversationKey: string): Promise<LocalThread[]> {
    return (await this.list()).filter((thread) => thread.sourceConversationKey === conversationKey);
  }
  async upsert(thread: LocalThread): Promise<void> {
    await this.mutate((threads) => {
      const existing = threads.find((item) => item.id === thread.id);
      if ((existing?.revision ?? 0) > (thread.revision ?? 0)) return threads;
      return cleanupThreads([...threads.filter((item) => item.id !== thread.id), thread], Date.now()).threads;
    });
  }
  async upsertAssociation(thread: LocalThread, pending: PendingThread): Promise<boolean> {
    return withStorageLock('pointask-data', async () => {
      const raw = await this.driver.get([STORAGE_KEYS.threads, STORAGE_KEYS.pendingThreads, STORAGE_KEYS.schemaVersion]);
      const schema = migrateStorage(raw); const threadId = pending.threadId || pending.id;
      const currentThread = schema.threads.find((item) => item.id === thread.id);
      const currentPendingRevision = schema.pendingThreads.filter((item) => (item.threadId || item.id) === threadId)
        .reduce((highest, item) => Math.max(highest, item.revision ?? 0), 0);
      const currentRevision = Math.max(currentThread?.revision ?? 0, currentPendingRevision);
      const incomingRevision = Math.max(thread.revision ?? 0, pending.revision ?? 0);
      if (incomingRevision < currentRevision) return false;
      const cleaned = cleanupThreads([...schema.threads.filter((item) => item.id !== thread.id), thread], Date.now()).threads;
      await this.driver.set({
        [STORAGE_KEYS.threads]: cleaned,
        [STORAGE_KEYS.pendingThreads]: [...schema.pendingThreads.filter((item) => (item.threadId || item.id) !== threadId), pending],
        [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION,
      });
      return true;
    });
  }
  async delete(id: string): Promise<boolean> {
    let deleted = false;
    await this.mutate((threads) => {
      deleted = threads.some((thread) => thread.id === id);
      return threads.filter((thread) => thread.id !== id);
    });
    return deleted;
  }
  async cleanupExpiredStagedAnswers(now = Date.now()): Promise<number> {
    return withStorageLock('pointask-data', async () => {
      const raw = await this.driver.get([STORAGE_KEYS.threads, STORAGE_KEYS.schemaVersion]);
      const threads = migrateStorage(raw).threads;
      const before = threads.flatMap((thread) => thread.rounds ?? []).filter((round) => round.stagedAnswer).length;
      const result = cleanupThreads(threads, now);
      const after = result.threads.flatMap((thread) => thread.rounds ?? []).filter((round) => round.stagedAnswer).length;
      if (result.changed || raw[STORAGE_KEYS.schemaVersion] !== STORAGE_SCHEMA_VERSION) await this.write(result.threads);
      return before - after;
    });
  }
  async allocateDisplayId(sourceConversationKey: string): Promise<string> {
    return withStorageLock('display-id', async () => {
      const raw = await this.driver.get(STORAGE_KEYS.settings);
      const settings = raw[STORAGE_KEYS.settings] && typeof raw[STORAGE_KEYS.settings] === 'object'
        ? raw[STORAGE_KEYS.settings] as Record<string, unknown> : {};
      const counters = settings.displayIdCounters && typeof settings.displayIdCounters === 'object'
        ? { ...settings.displayIdCounters as Record<string, number> } : {};
      const existingMax = (await this.list()).filter((thread) => thread.sourceConversationKey === sourceConversationKey)
        .reduce((max, thread) => Math.max(max, Number(/^PA-(\d+)$/.exec(thread.displayId)?.[1] ?? 0)), 0);
      const next = Math.max(counters[sourceConversationKey] ?? 0, existingMax) + 1;
      counters[sourceConversationKey] = next;
      await this.driver.set({ [STORAGE_KEYS.settings]: { ...settings, displayIdCounters: counters } });
      return `PA-${String(next).padStart(3, '0')}`;
    });
  }
  async replaceWorkspace(sourceConversationKey: string, workspaceId: string): Promise<void> {
    await this.mutate((threads) => threads.map((thread) =>
      thread.sourceConversationKey === sourceConversationKey && thread.answerMode === 'workspace'
        ? { ...thread, workspaceId, targetConversationUrl: undefined, updatedAt: new Date().toISOString() }
        : thread,
    ));
  }
  async setExpanded(id: string, expanded: boolean, updatedAt: string): Promise<void> {
    await this.mutate((threads) => threads.map((thread) =>
      thread.id === id && thread.expanded !== expanded ? { ...thread, expanded, updatedAt } : thread,
    ));
  }
  subscribe(callback: () => void): () => void {
    return this.driver.subscribe?.(STORAGE_KEYS.threads, callback) ?? (() => undefined);
  }
  private async mutate(change: (threads: LocalThread[]) => LocalThread[]): Promise<void> {
    this.queue = this.queue.then(async () => withStorageLock('pointask-data', async () => this.write(change(await this.list()))));
    await this.queue;
  }
  private write(threads: LocalThread[]): Promise<void> {
    return this.driver.set({ [STORAGE_KEYS.threads]: threads, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
  }
}
