export interface StorageDriver {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  subscribe?(key: string, callback: () => void): () => void;
}

const fallbackLocks = new Map<string, Promise<unknown>>();

export function isExtensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated|context invalidated/i.test(error.message);
}

/** Serializes storage read-modify-write operations across tabs when Web Locks is available. */
export async function withStorageLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`pointask:${name}`, task);
  }
  const previous = fallbackLocks.get(name) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  fallbackLocks.set(name, current);
  try {
    return await current;
  } finally {
    if (fallbackLocks.get(name) === current) fallbackLocks.delete(name);
  }
}

export class ChromeStorageDriver implements StorageDriver {
  constructor(private readonly area: chrome.storage.StorageArea = chrome.storage.local) {}
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    try { return await this.area.get(keys); }
    catch (error) { if (isExtensionContextInvalidated(error)) return {}; throw error; }
  }
  async set(items: Record<string, unknown>): Promise<void> {
    try { await this.area.set(items); }
    catch (error) { if (!isExtensionContextInvalidated(error)) throw error; }
  }
  async remove(keys: string | string[]): Promise<void> {
    try { await this.area.remove(keys); }
    catch (error) { if (!isExtensionContextInvalidated(error)) throw error; }
  }
  subscribe(key: string, callback: () => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && key in changes) callback();
    };
    try { chrome.storage.onChanged.addListener(listener); }
    catch (error) { if (!isExtensionContextInvalidated(error)) throw error; return () => undefined; }
    return () => {
      try { chrome.storage.onChanged.removeListener(listener); }
      catch (error) { if (!isExtensionContextInvalidated(error)) throw error; }
    };
  }
}

export class MemoryStorageDriver implements StorageDriver {
  readonly data: Record<string, unknown> = {};
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of typeof keys === 'string' ? [keys] : keys) if (key in this.data) result[key] = structuredClone(this.data[key]);
    return result;
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.data, structuredClone(items)); }
  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete this.data[key];
  }
}
