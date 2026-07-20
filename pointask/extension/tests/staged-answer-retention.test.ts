import { describe, expect, it } from 'vitest';
import { PendingAssociationCoordinator } from '../src/background/pending-association-coordinator';
import type { PendingAssociation, AttachedRoundPayload } from '../src/bridge/runtime-messages';
import type { LocalThread, LocalThreadRound, TextAnchor } from '../src/shared/local-thread';
import { cleanupExpiredStagedAnswers, SKIPPED_STAGED_ANSWER_RETENTION_MS } from '../src/shared/staged-answer-retention';
import { defaultSelectedRoundIds, validSelectedRoundIds } from '../src/components/round-selection-state';
import { isActiveWorkspaceThread } from '../src/components/workspace-control-visibility';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { ThreadStore } from '../src/storage/thread-store';
import { PendingStore } from '../src/storage/pending-store';
import { clearAllPointAskData } from '../src/storage/settings-store';
import { STORAGE_KEYS } from '../src/storage/storage-schema';

const now = 2_000_000_000_000;
const iso = new Date(now).toISOString();
const sourceUrl = 'https://chatgpt.com/c/source-retention';
const targetUrl = 'https://chatgpt.com/c/workspace-retention';
const anchor: TextAnchor = { pageUrl: sourceUrl, sourcePageUrl: sourceUrl, conversationKey: sourceUrl,
  messageFingerprint: 'source-fingerprint', assistantMessageHash: 'source-fingerprint', selectedText: '原文', prefixText: '', suffixText: '',
  paragraphText: '原文段落', paragraphHash: 'paragraph', startOffset: 0, endOffset: 2, schemaVersion: 1, createdAt: iso };

function round(id: string): LocalThreadRound {
  return { id, questionMessageId: `message-${id}`, pendingId: `pending-${id}`, promptHash: `prompt-${id}`,
    assistantFingerprintsBefore: [], candidateAnswerFingerprint: `answer-${id}`, status: 'answer_ready', persistenceStatus: 'staged',
    attachmentStatus: 'available', stagedAnswer: [{ type: 'text', content: `回答-${id}` }], answerSource: {
      conversationUrl: targetUrl, conversationKey: targetUrl, messageFingerprint: `answer-${id}`,
    }, capturedAt: iso, createdAt: iso, updatedAt: iso };
}

function thread(): LocalThread {
  const rounds = ['q1', 'q2', 'q3'].map(round);
  return { id: 'thread-retention', displayId: 'PA-030', answerMode: 'workspace', workspaceId: 'workspace-retention', anchor,
    sourcePageUrl: sourceUrl, sourceConversationKey: sourceUrl, sourceMessageFingerprint: anchor.messageFingerprint,
    targetConversationUrl: targetUrl, messages: rounds.map((item) => ({ id: item.questionMessageId!, roundId: item.id,
      role: 'user' as const, content: [{ type: 'text' as const, content: `问题-${item.id}` }], attachedManually: false, createdAt: iso })),
    rounds, status: 'answer_ready', createdAt: iso, updatedAt: iso };
}

function association(localThread = thread()): PendingAssociation {
  return { pendingThread: { id: 'pending-q3', threadId: localThread.id, roundId: 'q3', sourcePageUrl: sourceUrl,
    sourceConversationKey: sourceUrl, sourceMessageFingerprint: anchor.messageFingerprint, anchor, question: '问题-q3', generatedPrompt: 'prompt',
    promptMode: 'compact', status: 'answer_ready', createdAt: iso, updatedAt: iso, displayId: localThread.displayId,
    answerMode: 'workspace', workspaceId: 'workspace-retention', promptHash: 'prompt-q3', targetConversationUrl: targetUrl },
  localThread, sourceTabId: 1, targetTabId: 2, targetConversationUrl: targetUrl, associationStatus: 'associated', createdAt: iso, updatedAt: iso };
}

function payload(id: string): AttachedRoundPayload {
  return { roundId: id, richContent: [{ type: 'text', content: `回答-${id}` }], answerSource: {
    conversationUrl: targetUrl, conversationKey: targetUrl, messageFingerprint: `answer-${id}`,
  } };
}

describe('skipped staged answer retention', () => {
  it('atomically attaches selected rounds and marks unselected staged rounds skipped_retained', () => {
    const coordinator = new PendingAssociationCoordinator(() => new Date(now));
    const value = association(); coordinator.restore(value.pendingThread, value.localThread, value.sourceTabId);
    coordinator.markTargetOpened(value.pendingThread.id, 2, targetUrl);
    const updated = coordinator.attachRounds(value.pendingThread.id, 2, [payload('q2')], targetUrl, ['q1', 'q3'])!;
    expect(updated.localThread.rounds?.find((item) => item.id === 'q2')).toMatchObject({ attachmentStatus: 'attached', stagedAnswer: undefined });
    for (const id of ['q1', 'q3']) expect(updated.localThread.rounds?.find((item) => item.id === id)).toMatchObject({
      attachmentStatus: 'skipped_retained', skippedAt: now, expiresAt: now + SKIPPED_STAGED_ANSWER_RETENTION_MS,
      stagedAnswer: [{ type: 'text', content: `回答-${id}` }],
    });
    expect(isActiveWorkspaceThread(updated)).toBe(false);
  });

  it('does not default skipped rounds, but permits explicitly selecting and attaching one before expiry', () => {
    const rounds = [
      { id: 'new', index: 1, question: '新增', attached: false, latest: true, reliable: true, persistenceStatus: 'staged' as const, attachmentStatus: 'available' as const },
      { id: 'old', index: 2, question: '跳过', attached: false, latest: false, reliable: true, persistenceStatus: 'staged' as const, attachmentStatus: 'skipped_retained' as const },
    ];
    expect([...defaultSelectedRoundIds(rounds)]).toEqual(['new']);
    expect([...validSelectedRoundIds(rounds, new Set(['old']))]).toEqual(['old']);

    const coordinator = new PendingAssociationCoordinator(() => new Date(now)); const value = association();
    coordinator.restore(value.pendingThread, value.localThread, value.sourceTabId); coordinator.markTargetOpened(value.pendingThread.id, 2, targetUrl);
    coordinator.attachRounds(value.pendingThread.id, 2, [payload('q2')], targetUrl, ['q1', 'q3']);
    const attachedLater = coordinator.attachRounds(value.pendingThread.id, 2, [payload('q1')], targetUrl)!;
    expect(attachedLater.localThread.rounds?.find((item) => item.id === 'q1')).toMatchObject({ attachmentStatus: 'attached', stagedAnswer: undefined });
    expect(attachedLater.localThread.rounds?.find((item) => item.id === 'q3')?.attachmentStatus).toBe('skipped_retained');
  });

  it('expires retained copies idempotently without touching attached content', () => {
    const retained = { ...round('q1'), attachmentStatus: 'skipped_retained' as const, skippedAt: now - 100,
      expiresAt: now, stagedAnswer: [{ type: 'text' as const, content: '应删除' }] };
    const attached = { ...round('q2'), status: 'attached' as const, persistenceStatus: 'attached' as const,
      attachmentStatus: 'attached' as const, stagedAnswer: [{ type: 'text' as const, content: '不应由过期清理处理' }] };
    const value = { ...thread(), rounds: [retained, attached] };
    const first = cleanupExpiredStagedAnswers([value], now);
    expect(first.changed).toBe(true);
    expect(first.threads[0]?.rounds?.[0]).toMatchObject({ attachmentStatus: 'skipped_expired', persistenceStatus: 'not_captured', stagedAnswer: undefined });
    expect(first.threads[0]?.rounds?.[1]?.stagedAnswer).toEqual(attached.stagedAnswer);
    const second = cleanupExpiredStagedAnswers(first.threads, now);
    expect(second.changed).toBe(false); expect(second.threads).toEqual(first.threads);
  });

  it('cleans expired copies after a store restart and on reads', async () => {
    const driver = new MemoryStorageDriver(); const retained = { ...round('q1'), attachmentStatus: 'skipped_retained' as const,
      skippedAt: now - SKIPPED_STAGED_ANSWER_RETENTION_MS, expiresAt: now };
    await new ThreadStore(driver).upsert({ ...thread(), rounds: [retained] });
    const restarted = new ThreadStore(driver);
    expect(await restarted.cleanupExpiredStagedAnswers(now)).toBe(1);
    expect((await restarted.get('thread-retention'))?.rounds?.[0]).toMatchObject({ attachmentStatus: 'skipped_expired', stagedAnswer: undefined });
    expect(await restarted.cleanupExpiredStagedAnswers(now)).toBe(0);
  });

  it('deleting a thread and clearing all data remove retained answers and pending records', async () => {
    const driver = new MemoryStorageDriver(); const threads = new ThreadStore(driver); const pending = new PendingStore(driver);
    const retained = { ...round('q1'), attachmentStatus: 'skipped_retained' as const, skippedAt: now, expiresAt: now + 1_000 };
    const value = { ...thread(), rounds: [retained] }; await threads.upsert(value); await pending.upsert(association(value).pendingThread);
    expect(await threads.delete(value.id)).toBe(true); expect(await pending.deleteForThread(value.id)).toBe(1);
    expect(await threads.get(value.id)).toBeNull(); expect(await pending.list()).toEqual([]);

    await threads.upsert(value); await pending.upsert(association(value).pendingThread); await clearAllPointAskData(driver);
    expect(driver.data[STORAGE_KEYS.threads]).toBeUndefined(); expect(driver.data[STORAGE_KEYS.pendingThreads]).toBeUndefined();
  });

  it('keeps routing pending data until a skipped copy expires, then allows normal pending cleanup', async () => {
    const driver = new MemoryStorageDriver(); const threads = new ThreadStore(driver); const pending = new PendingStore(driver);
    const retained = { ...round('q1'), attachmentStatus: 'skipped_retained' as const, skippedAt: now,
      expiresAt: now + SKIPPED_STAGED_ANSWER_RETENTION_MS };
    const value = { ...thread(), rounds: [retained] }; const pendingValue = association(value).pendingThread;
    await threads.upsert(value); await pending.upsert({ ...pendingValue, updatedAt: new Date(now - 48 * 60 * 60 * 1_000).toISOString() });
    expect(await pending.deleteExpired(24, new Date(now))).toBe(0);
    expect(await pending.get(pendingValue.id)).not.toBeNull();
    await threads.cleanupExpiredStagedAnswers(now + SKIPPED_STAGED_ANSWER_RETENTION_MS);
    expect(await pending.deleteExpired(24, new Date(now + SKIPPED_STAGED_ANSWER_RETENTION_MS))).toBe(1);
  });
});
