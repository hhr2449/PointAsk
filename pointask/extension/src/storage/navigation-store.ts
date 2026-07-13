import type { AnswerSourceLocator } from '../shared/local-thread';
import type { StorageDriver } from './storage-driver';
import { STORAGE_KEYS } from './storage-schema';

export interface PendingNavigation {
  id: string;
  threadId: string;
  locator: AnswerSourceLocator;
  createdAt: string;
}

export class NavigationStore {
  constructor(private readonly driver: StorageDriver) {}
  async get(): Promise<PendingNavigation | null> {
    const value = (await this.driver.get(STORAGE_KEYS.pendingNavigation))[STORAGE_KEYS.pendingNavigation];
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<PendingNavigation>;
    const valid = typeof item.id === 'string' && typeof item.threadId === 'string' && item.locator && typeof item.createdAt === 'string'
      ? item as PendingNavigation : null;
    if (valid && Date.now() - Date.parse(valid.createdAt) <= 10 * 60 * 1_000) return valid;
    if (valid) await this.driver.remove(STORAGE_KEYS.pendingNavigation);
    return null;
  }
  set(value: PendingNavigation): Promise<void> { return this.driver.set({ [STORAGE_KEYS.pendingNavigation]: value }); }
  clear(id: string): Promise<void> { return this.get().then((value) => value?.id === id ? this.driver.remove(STORAGE_KEYS.pendingNavigation) : undefined); }
}
