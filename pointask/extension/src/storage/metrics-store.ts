import { STORAGE_KEYS } from './storage-schema';
import type { StorageDriver } from './storage-driver';

export const METRIC_NAMES = [
  'questionsCreated', 'promptsCopied', 'targetPagesOpened', 'targetsAssociated', 'answersAttached',
  'followUpsContinued', 'threadsExpanded', 'threadsDeleted', 'anchorsResolved', 'anchorsFailed', 'pendingExpired',
] as const;
export type MetricName = typeof METRIC_NAMES[number];
export type LocalMetrics = Record<MetricName, number>;

const emptyMetrics = (): LocalMetrics => Object.fromEntries(METRIC_NAMES.map((name) => [name, 0])) as LocalMetrics;

export class MetricsStore {
  constructor(private readonly driver: StorageDriver) {}
  async get(): Promise<LocalMetrics> {
    const raw = (await this.driver.get(STORAGE_KEYS.metrics))[STORAGE_KEYS.metrics];
    const record = raw && typeof raw === 'object' ? raw as Partial<LocalMetrics> : {};
    const metrics = emptyMetrics();
    for (const name of METRIC_NAMES) if (typeof record[name] === 'number' && record[name]! >= 0) metrics[name] = record[name]!;
    return metrics;
  }
  async increment(name: MetricName): Promise<void> {
    await this.add(name, 1);
  }
  async add(name: MetricName, amount: number): Promise<void> {
    const metrics = await this.get();
    metrics[name] += Math.max(0, Math.floor(amount));
    await this.driver.set({ [STORAGE_KEYS.metrics]: metrics });
  }
  async exportFeedback(): Promise<string> {
    return JSON.stringify({ version: '0.1.0', exportedAt: new Date().toISOString(), metrics: await this.get() }, null, 2);
  }
}
