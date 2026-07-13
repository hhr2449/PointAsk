import type { PointAskWorkspace } from '../shared/local-thread';
import { migrateStorage } from './migration';
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage-schema';
import { withStorageLock, type StorageDriver } from './storage-driver';

export class WorkspaceStore {
  constructor(private readonly driver: StorageDriver) {}
  async list(): Promise<PointAskWorkspace[]> {
    return migrateStorage(await this.driver.get([STORAGE_KEYS.workspaces, STORAGE_KEYS.schemaVersion])).workspaces;
  }
  async get(id: string): Promise<PointAskWorkspace | null> { return (await this.list()).find((item) => item.id === id) ?? null; }
  async getBySource(sourceConversationKey: string): Promise<PointAskWorkspace | null> {
    return (await this.list()).find((item) => item.sourceConversationKey === sourceConversationKey) ?? null;
  }
  async createOrGet(workspace: PointAskWorkspace): Promise<PointAskWorkspace> {
    return withStorageLock('workspace', async () => {
      const items = await this.list();
      const result = items.find((item) => item.sourceConversationKey === workspace.sourceConversationKey) ?? workspace;
      if (!items.some((item) => item.id === result.id)) await this.write([...items, result]);
      return result;
    });
  }
  async createOrIncrement(workspace: PointAskWorkspace, contentLength: number): Promise<PointAskWorkspace> {
    return withStorageLock('workspace', async () => {
      const items = await this.list();
      const existing = items.find((item) => item.sourceConversationKey === workspace.sourceConversationKey);
      const result = existing
        ? { ...existing, threadCount: existing.threadCount + 1, approximateContentLength: existing.approximateContentLength + contentLength, updatedAt: workspace.updatedAt }
        : { ...workspace, threadCount: 1, approximateContentLength: contentLength };
      await this.write([...items.filter((item) => item.id !== result.id), result]);
      return result;
    });
  }
  async upsert(workspace: PointAskWorkspace): Promise<void> {
    await withStorageLock('workspace', async () => {
      const items = await this.list(); await this.write([...items.filter((item) => item.id !== workspace.id), workspace]);
    });
  }
  async updateContextProgress(id: string, messages: Array<{ fingerprint: string; role: 'user' | 'assistant' }>): Promise<PointAskWorkspace | null> {
    return withStorageLock('workspace', async () => {
      const items = await this.list(); const workspace = items.find((item) => item.id === id);
      if (!workspace) return null;
      const marker = workspace.contextState.lastSyncedMessageFingerprint;
      if (!marker) return workspace;
      const index = messages.findIndex((message) => message.fingerprint === marker);
      const contextState = index < 0
        ? { ...workspace.contextState, status: 'unknown' as const, unsyncedMessageCount: 0, unsyncedTurnCount: 0 }
        : (() => { const added = messages.slice(index + 1); return { ...workspace.contextState,
          status: added.length ? 'outdated' as const : 'fresh' as const,
          unsyncedMessageCount: added.length,
          unsyncedTurnCount: added.filter((message) => message.role === 'user').length,
        }; })();
      if (JSON.stringify(contextState) === JSON.stringify(workspace.contextState)) return workspace;
      const updated = { ...workspace, contextState, updatedAt: new Date().toISOString() };
      await this.write([...items.filter((item) => item.id !== id), updated]); return updated;
    });
  }

  async confirmContextUpdate(id: string, updateId: string): Promise<PointAskWorkspace | null> {
    return withStorageLock('workspace', async () => {
      const items = await this.list(); const workspace = items.find((item) => item.id === id);
      if (!workspace?.pendingContextUpdate || workspace.pendingContextUpdate.id !== updateId) return workspace ?? null;
      const now = new Date().toISOString();
      const updated: PointAskWorkspace = { ...workspace, pendingContextUpdate: undefined, updatedAt: now, contextState: {
        contextVersion: workspace.contextState.contextVersion + 1,
        lastSyncedMessageFingerprint: workspace.pendingContextUpdate.lastMessageFingerprint,
        syncedAt: now, unsyncedMessageCount: 0, unsyncedTurnCount: 0, status: 'fresh',
      } };
      await this.write([...items.filter((item) => item.id !== id), updated]); return updated;
    });
  }
  async delete(id: string): Promise<boolean> {
    return withStorageLock('workspace', async () => {
      const items = await this.list(); await this.write(items.filter((item) => item.id !== id)); return items.some((item) => item.id === id);
    });
  }
  async replaceForSource(workspace: PointAskWorkspace): Promise<PointAskWorkspace> {
    return withStorageLock('workspace', async () => {
      const items = await this.list();
      await this.write([...items.filter((item) => item.sourceConversationKey !== workspace.sourceConversationKey), workspace]);
      return workspace;
    });
  }
  subscribe(callback: () => void): () => void {
    return this.driver.subscribe?.(STORAGE_KEYS.workspaces, callback) ?? (() => undefined);
  }
  private write(items: PointAskWorkspace[]): Promise<void> {
    return this.driver.set({ [STORAGE_KEYS.workspaces]: items, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
  }
}
