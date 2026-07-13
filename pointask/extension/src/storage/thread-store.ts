import type { LocalThread } from '../shared/local-thread';
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage-schema';
import { migrateStorage } from './migration';
import { withStorageLock, type StorageDriver } from './storage-driver';

export class ThreadStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly driver: StorageDriver) {}

  async list(): Promise<LocalThread[]> {
    const raw = await this.driver.get([STORAGE_KEYS.threads, STORAGE_KEYS.schemaVersion]);
    const schema = migrateStorage(raw);
    if (raw[STORAGE_KEYS.schemaVersion] !== STORAGE_SCHEMA_VERSION) await this.write(schema.threads);
    return schema.threads;
  }
  async get(id: string): Promise<LocalThread | null> { return (await this.list()).find((thread) => thread.id === id) ?? null; }
  async listByConversation(conversationKey: string): Promise<LocalThread[]> {
    return (await this.list()).filter((thread) => thread.sourceConversationKey === conversationKey);
  }
  async upsert(thread: LocalThread): Promise<void> {
    await this.mutate((threads) => [...threads.filter((item) => item.id !== thread.id), thread]);
  }
  async delete(id: string): Promise<boolean> {
    let deleted = false;
    await this.mutate((threads) => {
      deleted = threads.some((thread) => thread.id === id);
      return threads.filter((thread) => thread.id !== id);
    });
    return deleted;
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
  subscribe(callback: () => void): () => void {
    return this.driver.subscribe?.(STORAGE_KEYS.threads, callback) ?? (() => undefined);
  }
  private async mutate(change: (threads: LocalThread[]) => LocalThread[]): Promise<void> {
    this.queue = this.queue.then(async () => withStorageLock('threads', async () => this.write(change(await this.list()))));
    await this.queue;
  }
  private write(threads: LocalThread[]): Promise<void> {
    return this.driver.set({ [STORAGE_KEYS.threads]: threads, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
  }
}
