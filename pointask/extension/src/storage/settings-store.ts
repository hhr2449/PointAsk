import { DEFAULT_SETTINGS, STORAGE_KEYS, STORAGE_SCHEMA_VERSION, type PointAskSettings } from './storage-schema';
import { migrateStorage } from './migration';
import type { StorageDriver } from './storage-driver';

export class SettingsStore {
  constructor(private readonly driver: StorageDriver) {}
  async get(): Promise<PointAskSettings> {
    const raw = await this.driver.get([STORAGE_KEYS.settings, STORAGE_KEYS.schemaVersion]);
    const schema = migrateStorage(raw);
    if (!raw[STORAGE_KEYS.settings]) await this.set(schema.settings);
    return schema.settings;
  }
  async set(settings: PointAskSettings): Promise<void> {
    const current = await this.get();
    const validated = migrateStorage({ [STORAGE_KEYS.settings]: { ...settings, displayIdCounters: settings.displayIdCounters ?? current.displayIdCounters } }).settings;
    await this.driver.set({ [STORAGE_KEYS.settings]: validated, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
  }
  async reset(): Promise<void> { await this.set(DEFAULT_SETTINGS); }
}

export async function clearAllPointAskData(driver: StorageDriver): Promise<void> {
  await driver.remove(Object.values(STORAGE_KEYS));
}
