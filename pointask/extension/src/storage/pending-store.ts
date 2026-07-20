import type { PendingThread } from '../bridge/pending-thread-manager';
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage-schema';
import { migrateStorage } from './migration';
import { withStorageLock, type StorageDriver } from './storage-driver';
import { roundAttachmentStatus } from '../shared/staged-answer-retention';
import { threadRounds } from '../shared/thread-rounds';

export class PendingStore {
  constructor(private readonly driver: StorageDriver) {}
  async list(): Promise<PendingThread[]> {
    const raw = await this.driver.get([STORAGE_KEYS.pendingThreads, STORAGE_KEYS.threads, STORAGE_KEYS.schemaVersion]);
    return migrateStorage(raw).pendingThreads;
  }
  async get(id: string): Promise<PendingThread | null> { return (await this.list()).find((thread) => thread.id === id) ?? null; }
  async upsert(thread: PendingThread): Promise<void> {
    await withStorageLock('pending-threads', async () => {
      const threads = [...(await this.list()).filter((item) => item.id !== thread.id), thread];
      await this.driver.set({ [STORAGE_KEYS.pendingThreads]: threads, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
    });
  }
  async delete(id: string): Promise<boolean> {
    return withStorageLock('pending-threads', async () => {
      const current = await this.list(); const threads = current.filter((thread) => thread.id !== id);
      await this.driver.set({ [STORAGE_KEYS.pendingThreads]: threads, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
      return threads.length !== current.length;
    });
  }
  async deleteForThread(threadId: string): Promise<number> {
    return withStorageLock('pending-threads', async () => {
      const current = await this.list(); const threads = current.filter((thread) => (thread.threadId || thread.id) !== threadId);
      await this.driver.set({ [STORAGE_KEYS.pendingThreads]: threads, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
      return current.length - threads.length;
    });
  }
  async replaceForThread(thread: PendingThread): Promise<void> {
    await withStorageLock('pending-threads', async () => {
      const threadId = thread.threadId || thread.id;
      const threads = [...(await this.list()).filter((item) => (item.threadId || item.id) !== threadId), thread];
      await this.driver.set({ [STORAGE_KEYS.pendingThreads]: threads, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
    });
  }
  async deleteExpired(expiryHours: number, now = new Date()): Promise<number> {
    return withStorageLock('pending-threads', async () => {
      const raw = await this.driver.get([STORAGE_KEYS.pendingThreads, STORAGE_KEYS.threads, STORAGE_KEYS.schemaVersion]);
      const schema = migrateStorage(raw); const current = schema.pendingThreads; const cutoff = now.getTime() - expiryHours * 60 * 60 * 1_000;
      const retainedThreadIds = new Set(schema.threads.filter((thread) => threadRounds(thread).some((round) =>
        roundAttachmentStatus(round) === 'skipped_retained' && round.expiresAt !== undefined && round.expiresAt > now.getTime()))
        .map((thread) => thread.id));
      const threads = current.filter((thread) => Date.parse(thread.updatedAt) >= cutoff || retainedThreadIds.has(thread.threadId || thread.id));
      await this.driver.set({ [STORAGE_KEYS.pendingThreads]: threads }); return current.length - threads.length;
    });
  }
}
