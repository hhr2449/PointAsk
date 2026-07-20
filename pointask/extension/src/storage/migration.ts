import { isChatGptUrl, isLocalThread, isPendingThread } from '../bridge/runtime-messages';
import type { PendingThread } from '../bridge/pending-thread-manager';
import type { LocalThread, PointAskWorkspace } from '../shared/local-thread';
import { normalizeRichBlocks } from '../shared/rich-content';
import { DEFAULT_SETTINGS, STORAGE_KEYS, STORAGE_SCHEMA_VERSION, type PointAskSettings, type PointAskStorageSchema } from './storage-schema';
import { withStorageLock, type StorageDriver } from './storage-driver';
import { stableTextHash } from '../shared/text-utils';
import { syncPendingRound } from '../shared/thread-rounds';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function migrateStorage(raw: Record<string, unknown>): PointAskStorageSchema {
  const rawThreads: unknown[] = Array.isArray(raw[STORAGE_KEYS.threads]) ? raw[STORAGE_KEYS.threads] as unknown[] : [];
  const counters = new Map<string, number>();
  const used = new Map<string, Set<number>>();
  for (const value of rawThreads) {
    const item = record(value); const key = String(item?.sourceConversationKey ?? '');
    const match = typeof item?.displayId === 'string' ? /^PA-(\d+)$/.exec(item.displayId) : null;
    if (match) {
      const number = Number(match[1]);
      (used.get(key) ?? used.set(key, new Set()).get(key))?.add(number);
      counters.set(key, Math.max(counters.get(key) ?? 0, number));
    }
  }
  const threads = rawThreads.map((value) => {
    const item = record(value); if (!item) return null;
    const key = String(item.sourceConversationKey ?? '');
    let displayId = typeof item.displayId === 'string' ? item.displayId : '';
    if (!displayId) {
      let next = (counters.get(key) ?? 0) + 1;
      while (used.get(key)?.has(next)) next++;
      counters.set(key, next); displayId = `PA-${String(next).padStart(3, '0')}`;
    }
    const messages = Array.isArray(item.messages) ? item.messages.map((raw) => {
      const message = record(raw); if (!message) return null;
      const content = normalizeRichBlocks(message.content); if (!content) return null;
      const answerSource = record(message.answerSource);
      return {
        id: message.id,
        role: message.role,
        content,
        attachedManually: message.attachedManually,
        createdAt: message.createdAt,
        ...(typeof message.roundId === 'string' ? { roundId: message.roundId } : {}),
        ...(typeof message.attachedAt === 'string' ? { attachedAt: message.attachedAt } : {}),
        ...(answerSource ? { answerSource } : {}),
      };
    }).filter(Boolean) : [];
    const rawRounds = Array.isArray(item.rounds) ? item.rounds : [];
    const rounds = rawRounds.map(record).filter((round): round is Record<string, unknown> => Boolean(round)).map((round) => {
      const stagedAnswer = normalizeRichBlocks(round.stagedAnswer);
      const persistenceStatus = ['not_captured', 'staged', 'attaching', 'attached', 'capture_failed'].includes(String(round.persistenceStatus))
        ? round.persistenceStatus : round.status === 'attached' ? 'attached' : 'not_captured';
      const answerMessage = messages.find((message) => message && typeof message === 'object' && message.role === 'assistant' && message.roundId === round.id);
      const answerMessageId = typeof round.answerMessageId === 'string' ? round.answerMessageId
        : answerMessage && typeof answerMessage.id === 'string' ? answerMessage.id : undefined;
      return {
        ...round,
        questionMessageId: typeof round.questionMessageId === 'string' ? round.questionMessageId : String(round.id ?? ''),
        ...(answerMessageId ? { answerMessageId } : {}),
        persistenceStatus,
        ...(persistenceStatus === 'staged' && stagedAnswer ? { stagedAnswer } : { stagedAnswer: undefined }),
      };
    });
    const roundByQuestion = new Map(rounds.map((round) => [String(round.questionMessageId), String((round as Record<string, unknown>).id)]));
    const migratedMessages = messages.map((message) => message && typeof message === 'object' && message.role === 'user'
      ? { ...message, roundId: message.roundId ?? roundByQuestion.get(String(message.id)) }
      : message);
    return {
      ...item,
      messages: migratedMessages,
      ...(rounds.length ? { rounds } : {}),
      displayId,
      answerMode: item.answerMode === 'workspace' || item.answerMode === 'current_conversation'
        ? item.answerMode : 'dedicated_branch',
      dedicatedConversationUrl: item.dedicatedConversationUrl ?? item.targetConversationUrl,
    };
  }).filter(isLocalThread) as LocalThread[];
  const rawPending: unknown[] = Array.isArray(raw[STORAGE_KEYS.pendingThreads]) ? raw[STORAGE_KEYS.pendingThreads] as unknown[] : [];
  const pendingThreads = rawPending
    .map((value) => {
      const item = record(value); if (!item) return null;
      const thread = threads.find((candidate) => candidate.id === (item.threadId ?? item.id));
      if (!thread) return item;
      const roundId = typeof item.roundId === 'string' && item.roundId
        ? item.roundId
        : thread.rounds?.find((round) => round.pendingId === item.id)?.id
          ?? thread.rounds?.at(-1)?.id
          ?? (() => { const message = [...thread.messages].reverse().find((entry) => entry.role === 'user'); return message?.roundId ?? message?.id; })();
      return {
        ...item,
        displayId: item.displayId ?? thread.displayId,
        answerMode: item.answerMode ?? thread.answerMode,
        workspaceId: item.workspaceId ?? thread.workspaceId,
        threadId: item.threadId ?? thread.id,
        ...(roundId ? { roundId } : {}),
        promptHash: typeof item.promptHash === 'string' && item.promptHash ? item.promptHash : stableTextHash(String(item.generatedPrompt ?? '')),
        assistantFingerprintsBefore: Array.isArray(item.assistantFingerprintsBefore) ? item.assistantFingerprintsBefore : [],
      };
    }).filter(isPendingThread) as unknown as PendingThread[];
  // Persist the transport state into its explicitly addressed round once at
  // migration time. From this point onward LocalThreadRound is the UI source
  // of truth and PendingThread is not overlaid by readers.
  const synchronizedThreads = threads.map((thread) => {
    const pending = pendingThreads.filter((item) => (item.threadId || item.id) === thread.id)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    return pending ? syncPendingRound(thread, pending) : thread;
  });
  const rawWorkspaces: unknown[] = Array.isArray(raw[STORAGE_KEYS.workspaces]) ? raw[STORAGE_KEYS.workspaces] as unknown[] : [];
  const workspaces = rawWorkspaces.filter((value): value is PointAskWorkspace => {
    const item = record(value);
    return Boolean(item && typeof item.id === 'string' && typeof item.sourceConversationKey === 'string' &&
      typeof item.sourceConversationUrl === 'string' && isChatGptUrl(item.sourceConversationUrl) &&
      (item.workspaceType === 'branch' || item.workspaceType === 'new_conversation') &&
      typeof item.threadCount === 'number' && typeof item.approximateContentLength === 'number' &&
      typeof item.createdAt === 'string' && typeof item.updatedAt === 'string' &&
      (item.targetConversationUrl === undefined || typeof item.targetConversationUrl === 'string' && isChatGptUrl(item.targetConversationUrl)));
  }).map((workspace) => {
    const workspaceWithoutControlState = { ...workspace };
    delete workspaceWithoutControlState.controlCardState;
    const rawState = record((workspace as unknown as Record<string, unknown>).contextState);
    const rawControlState = record((workspace as unknown as Record<string, unknown>).controlCardState);
    const status = ['fresh', 'outdated', 'unknown', 'diverged'].includes(String(rawState?.status))
      ? rawState?.status as PointAskWorkspace['contextState']['status'] : 'unknown';
    return {
      ...workspaceWithoutControlState,
      contextState: {
        contextVersion: typeof rawState?.contextVersion === 'number' && rawState.contextVersion >= 1 ? rawState.contextVersion : 1,
        ...(typeof rawState?.lastSyncedMessageFingerprint === 'string' ? { lastSyncedMessageFingerprint: rawState.lastSyncedMessageFingerprint } : {}),
        ...(typeof rawState?.syncedAt === 'string' ? { syncedAt: rawState.syncedAt } : {}),
        unsyncedMessageCount: typeof rawState?.unsyncedMessageCount === 'number' ? rawState.unsyncedMessageCount : 0,
        unsyncedTurnCount: typeof rawState?.unsyncedTurnCount === 'number' ? rawState.unsyncedTurnCount : 0,
        status,
      },
      ...(rawControlState && typeof rawControlState.collapsed === 'boolean' &&
        typeof rawControlState.hasAutoExpanded === 'boolean' && typeof rawControlState.updatedAt === 'string'
        ? { controlCardState: {
            collapsed: rawControlState.collapsed,
            hasAutoExpanded: rawControlState.hasAutoExpanded,
            updatedAt: rawControlState.updatedAt,
            ...(typeof rawControlState.activeThreadId === 'string' ? { activeThreadId: rawControlState.activeThreadId } : {}),
          } }
        : {}),
      ...((workspace as unknown as Record<string, unknown>).pendingContextUpdate ? { pendingContextUpdate: (workspace as unknown as Record<string, unknown>).pendingContextUpdate as PointAskWorkspace['pendingContextUpdate'] } : {}),
    };
  });
  const rawSettings = record(raw[STORAGE_KEYS.settings]) as Partial<PointAskSettings> | null;
  const settings: PointAskSettings = {
    defaultPromptMode: rawSettings?.defaultPromptMode === 'contextual' ? 'contextual' : 'compact',
    expandNewThreads: rawSettings?.expandNewThreads === true,
    pendingExpiryHours: typeof rawSettings?.pendingExpiryHours === 'number' && rawSettings.pendingExpiryHours >= 1 && rawSettings.pendingExpiryHours <= 168
      ? rawSettings.pendingExpiryHours : DEFAULT_SETTINGS.pendingExpiryHours,
    displayIdCounters: {
      ...(record(rawSettings?.displayIdCounters) as Record<string, number> ?? {}),
      ...Object.fromEntries(counters),
    },
    currentConversationScrollBehavior: rawSettings?.currentConversationScrollBehavior === 'follow_response' ? 'follow_response' : 'stay_at_source',
    closeDedicatedTabAfterAttach: rawSettings?.closeDedicatedTabAfterAttach === true,
    autoActionAuthorized: rawSettings?.autoActionAuthorized === true,
  };
  return { version: STORAGE_SCHEMA_VERSION, threads: synchronizedThreads, pendingThreads, workspaces, settings };
}

export async function runStorageMigration(driver: StorageDriver): Promise<PointAskStorageSchema> {
  return withStorageLock('migration', async () => {
    const raw = await driver.get(Object.values(STORAGE_KEYS));
    const migrated = migrateStorage(raw);
    if (raw[STORAGE_KEYS.schemaVersion] === STORAGE_SCHEMA_VERSION) return migrated;
    await driver.set({
    [STORAGE_KEYS.threads]: migrated.threads,
    [STORAGE_KEYS.workspaces]: migrated.workspaces,
    [STORAGE_KEYS.pendingThreads]: migrated.pendingThreads,
    [STORAGE_KEYS.settings]: migrated.settings,
    [STORAGE_KEYS.schemaVersion]: migrated.version,
    });
    return migrated;
  });
}
