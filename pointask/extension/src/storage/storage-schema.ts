import type { PendingThread } from '../bridge/pending-thread-manager';
import type { LocalThread, PointAskWorkspace } from '../shared/local-thread';

export const STORAGE_SCHEMA_VERSION = 12;
export const STORAGE_KEYS = {
  threads: 'pointask:threads',
  pendingThreads: 'pointask:pending-threads',
  workspaces: 'pointask:workspaces',
  settings: 'pointask:settings',
  schemaVersion: 'pointask:schema-version',
  metrics: 'pointask:metrics',
  pendingNavigation: 'pointask:pending-navigation',
  pendingThreadReturn: 'pointask:pending-thread-return',
} as const;

export interface PointAskSettings {
  defaultPromptMode: 'compact' | 'contextual';
  expandNewThreads: boolean;
  pendingExpiryHours: number;
  displayIdCounters?: Record<string, number>;
  currentConversationScrollBehavior: 'stay_at_source' | 'follow_response';
  closeDedicatedTabAfterAttach: boolean;
  autoActionAuthorized: boolean;
}

export interface PointAskStorageSchema {
  version: number;
  threads: LocalThread[];
  pendingThreads: PendingThread[];
  workspaces: PointAskWorkspace[];
  settings: PointAskSettings;
}

export const DEFAULT_SETTINGS: PointAskSettings = {
  defaultPromptMode: 'compact',
  expandNewThreads: false,
  pendingExpiryHours: 24,
  displayIdCounters: {},
  currentConversationScrollBehavior: 'stay_at_source',
  closeDedicatedTabAfterAttach: false,
  autoActionAuthorized: false,
};
