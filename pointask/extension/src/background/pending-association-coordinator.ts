import type { PendingThread } from '../bridge/pending-thread-manager';
import { isCompatibleChatGptTargetUrl, isSameChatGptConversationUrl, type AttachedRoundPayload, type PendingAssociation } from '../bridge/runtime-messages';
import type { AnswerSourceLocator, LocalMessage, LocalThread, RichContentBlock } from '../shared/local-thread';
import { richPlainText, textBlocks } from '../shared/rich-content';
import { answerForRound, insertRoundAnswer, pendingStatus, questionForRound, roundIdForPending, syncPendingRound, threadRounds } from '../shared/thread-rounds';
import { roundAttachmentStatus, SKIPPED_STAGED_ANSWER_RETENTION_MS } from '../shared/staged-answer-retention';
import { logPointAskLifecycle } from '../shared/lifecycle-log';

export const PENDING_EXPIRY_MS = 24 * 60 * 60 * 1_000;

export class PendingAssociationCoordinator {
  private readonly records = new Map<string, PendingAssociation>();
  private expiryMs = PENDING_EXPIRY_MS;

  constructor(private readonly now: () => Date = () => new Date()) {}
  setExpiryHours(hours: number): void {
    if (Number.isFinite(hours) && hours >= 1 && hours <= 168) this.expiryMs = hours * 60 * 60 * 1_000;
  }

  create(pendingThread: PendingThread, sourceTabId: number, localThread?: LocalThread): PendingAssociation {
    const existing = this.records.get(pendingThread.id);
    const previousForThread = [...this.records.values()].filter((item) => item.localThread.id === (pendingThread.threadId || pendingThread.id))
      .sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))[0];
    const revision = Math.max(pendingThread.revision ?? 0, localThread?.revision ?? 0,
      existing?.revision ?? 0, previousForThread && previousForThread.pendingThread.id !== pendingThread.id ? (previousForThread.revision ?? 0) + 1 : 0, 1);
    const timestamp = this.now().toISOString();
    const normalizedPending = { ...pendingThread, revision };
    const normalizedThread = localThread ? { ...localThread, revision } : undefined;
    const record: PendingAssociation = existing
      ? { ...existing, pendingThread: normalizedPending, localThread: normalizedThread ?? existing.localThread,
          sourceTabId, revision, updatedAt: timestamp }
      : {
          pendingThread: normalizedPending,
          localThread: normalizedThread ?? { ...this.createLocalThread(normalizedPending, timestamp), revision },
          sourceTabId,
          targetConversationUrl: localThread?.targetConversationUrl ?? pendingThread.targetConversationUrl,
          associationStatus: 'created',
          createdAt: timestamp,
          updatedAt: timestamp,
          revision,
        };
    this.records.set(pendingThread.id, record);
    logPointAskLifecycle({ threadId: record.localThread.id, roundId: record.pendingThread.roundId,
      pendingId: record.pendingThread.id, operationId: record.pendingThread.operationId, revision,
      event: 'create_round', afterStatus: record.localThread.status, activeRoundId: record.pendingThread.roundId });
    return record;
  }

  restore(pendingThread: PendingThread, localThread: LocalThread, sourceTabId: number): PendingAssociation {
    const timestamp = this.now().toISOString();
    const existing = this.records.get(pendingThread.id);
    const revision = Math.max(pendingThread.revision ?? 0, localThread.revision ?? 0, existing?.revision ?? 0);
    const record: PendingAssociation = {
      pendingThread: { ...pendingThread, revision },
      localThread: { ...localThread, revision },
      sourceTabId,
      // tabId is a process-local binding. Never revive a persisted tab ID
      // after a service-worker restart; the stable conversation URL is used
      // to locate or reopen the target instead.
      targetTabId: existing?.targetTabId,
      targetConversationUrl: localThread.targetConversationUrl,
      associationStatus: existing?.associationStatus ?? (localThread.status === 'answer_attached' ? 'completed' : localThread.targetConversationUrl ? 'associated' : 'created'),
      createdAt: existing?.createdAt ?? localThread.createdAt,
      updatedAt: timestamp,
      revision,
    };
    this.records.set(pendingThread.id, record);
    return record;
  }

  restoreSnapshot(record: PendingAssociation, expectedCurrentRevision?: number): void {
    const current = this.records.get(record.pendingThread.id);
    if (!current || expectedCurrentRevision === undefined && (record.revision ?? 0) >= (current.revision ?? 0) ||
      expectedCurrentRevision !== undefined && (current.revision ?? 0) === expectedCurrentRevision) {
      this.records.set(record.pendingThread.id, record);
    }
  }

  markTargetOpened(id: string, targetTabId: number, targetUrl: string): PendingAssociation | null {
    const record = this.get(id);
    if (!record || (record.localThread.answerMode === 'workspace' &&
      isSameChatGptConversationUrl(record.localThread.sourceConversationKey, targetUrl))) return null;
    const status = record.localThread.status === 'submitting' ? 'submission_unknown' :
      ['submission_unknown', 'waiting_for_answer', 'generating', 'answer_ready', 'answer_attached'].includes(record.localThread.status)
        ? record.localThread.status : 'waiting_for_submission';
    return this.update(id, {
      pendingThread: { ...record.pendingThread, targetConversationUrl: targetUrl, targetTabId, targetConversationKey: record.localThread.answerMode === 'current_conversation' ? record.localThread.sourceConversationKey : targetUrl, status: this.toPendingStatus(status) },
      localThread: syncPendingRound({
        ...record.localThread,
        targetConversationUrl: targetUrl,
        dedicatedConversationUrl: record.localThread.answerMode === 'dedicated_branch' ? targetUrl : record.localThread.dedicatedConversationUrl,
        status,
        updatedAt: this.now().toISOString(),
      }, { ...record.pendingThread, targetConversationUrl: targetUrl, targetTabId, status: this.toPendingStatus(status) }),
      targetTabId,
      targetConversationUrl: targetUrl,
      associationStatus: 'target_opened',
    });
  }

  markManualBranch(id: string, sourceTabId: number): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.sourceTabId !== sourceTabId) return null;
    return this.update(id, {
      associationStatus: 'awaiting_manual_association',
      localThread: syncPendingRound({
        ...record.localThread,
        status: record.localThread.status === 'answer_attached' ? 'answer_attached' : 'waiting_for_submission',
        updatedAt: this.now().toISOString(),
      }, { ...record.pendingThread, status: 'waiting_for_submission', updatedAt: this.now().toISOString() }),
    });
  }

  associate(id: string, targetTabId: number, targetUrl: string, confirmReassociation = false): PendingAssociation | null {
    const record = this.get(id);
    if (!record || (record.localThread.answerMode === 'workspace' &&
      isSameChatGptConversationUrl(record.localThread.sourceConversationKey, targetUrl))) return null;
    const conflict = [...this.records.values()].some((candidate) =>
      candidate.pendingThread.id !== id && candidate.targetTabId === targetTabId &&
      candidate.associationStatus !== 'cancelled' && candidate.localThread.status !== 'answer_attached' &&
      !(
        candidate.localThread.answerMode === 'workspace' && record.localThread.answerMode === 'workspace' &&
        candidate.localThread.workspaceId === record.localThread.workspaceId
      ) && !(
        candidate.localThread.answerMode === 'current_conversation' && record.localThread.answerMode === 'current_conversation' &&
        candidate.localThread.sourceConversationKey === record.localThread.sourceConversationKey
      ),
    );
    if (conflict) return null;
    if (record.targetTabId !== undefined && record.targetTabId !== targetTabId && !confirmReassociation) return null;
    const status = record.localThread.status === 'submitting' ? 'submission_unknown' :
      ['submission_unknown', 'waiting_for_answer', 'generating', 'answer_ready', 'answer_attached'].includes(record.localThread.status)
        ? record.localThread.status : 'waiting_for_submission';
    return this.update(id, {
      pendingThread: { ...record.pendingThread, targetConversationUrl: targetUrl, targetTabId, targetConversationKey: record.localThread.answerMode === 'current_conversation' ? record.localThread.sourceConversationKey : targetUrl, status: this.toPendingStatus(status) },
      localThread: syncPendingRound({
        ...record.localThread,
        targetConversationUrl: targetUrl,
        dedicatedConversationUrl: record.localThread.answerMode === 'dedicated_branch' ? targetUrl : record.localThread.dedicatedConversationUrl,
        status,
        updatedAt: this.now().toISOString(),
      }, { ...record.pendingThread, targetConversationUrl: targetUrl, targetTabId, status: this.toPendingStatus(status) }),
      targetTabId,
      targetConversationUrl: targetUrl,
      associationStatus: 'associated',
    });
  }

  cancel(id: string, senderTabId: number): PendingAssociation | null {
    const record = this.get(id);
    if (!record || (record.sourceTabId !== senderTabId && record.targetTabId !== senderTabId)) return null;
    const attached = record.localThread.status === 'answer_attached';
    return this.update(id, {
      associationStatus: 'cancelled',
      pendingThread: { ...record.pendingThread, status: attached ? 'answer_attached' : 'failed', updatedAt: this.now().toISOString() },
      localThread: { ...record.localThread, status: attached ? 'answer_attached' : 'failed', updatedAt: this.now().toISOString() },
    });
  }

  unlink(id: string, sourceTabId: number): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.sourceTabId !== sourceTabId) return null;
    const { targetConversationUrl: _localTarget, ...localThread } = record.localThread;
    const { targetConversationUrl: _pendingTarget, ...pendingThread } = record.pendingThread;
    void _localTarget;
    void _pendingTarget;
    const updated: PendingAssociation = {
      ...record,
      pendingThread,
      localThread,
      targetTabId: undefined,
      targetConversationUrl: undefined,
      associationStatus: 'created',
      updatedAt: this.now().toISOString(),
    };
    this.records.set(id, updated);
    return updated;
  }

  updateLocalThread(pendingThread: PendingThread, localThread: LocalThread, sourceTabId: number, allowSourceRebind = false): PendingAssociation | null {
    const record = this.get(pendingThread.id);
    if (!record || (!allowSourceRebind && record.sourceTabId !== sourceTabId) || localThread.id !== (pendingThread.threadId || pendingThread.id)) return null;
    return this.update(pendingThread.id, { pendingThread, localThread, sourceTabId });
  }

  attachAnswer(id: string, targetTabId: number, selected: string | RichContentBlock[], targetUrl: string, replace: boolean, answerSource?: AnswerSourceLocator): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== targetTabId || record.associationStatus === 'cancelled') return null;
    const lastMessage = record.localThread.messages.at(-1);
    const replacing = lastMessage?.role === 'assistant';
    if (replacing !== replace) return null;
    const existingAnswerIndex = replacing ? record.localThread.messages.length - 1 : -1;
    const timestamp = this.now().toISOString();
    const roundId = roundIdForPending(record.localThread, record.pendingThread);
    const answer: LocalMessage = {
      id: existingAnswerIndex >= 0
        ? record.localThread.messages[existingAnswerIndex]!.id
        : `pointask-answer-${id}`,
      role: 'assistant',
      content: typeof selected === 'string' ? textBlocks(selected.trim()) : selected,
      answerSource,
      roundId,
      attachedAt: timestamp,
      attachedManually: true,
      createdAt: timestamp,
    };
    const messages = [...record.localThread.messages];
    if (existingAnswerIndex >= 0) messages[existingAnswerIndex] = answer;
    else messages.push(answer);
    const rounds = threadRounds(record.localThread).map((round) => round.id === roundId ? {
      ...round, status: 'attached' as const, persistenceStatus: 'attached' as const, attachmentStatus: 'attached' as const,
      stagedAnswer: undefined, skippedAt: undefined, expiresAt: undefined,
      answerMessageId: answer.id,
      attachedAt: timestamp, answerSource,
      candidateAnswerFingerprint: answerSource?.messageFingerprint, updatedAt: timestamp,
    } : round);
    return this.update(id, {
      pendingThread: { ...record.pendingThread, targetConversationUrl: targetUrl, status: 'answer_attached', candidateAnswerFingerprint: answerSource?.messageFingerprint },
      localThread: {
        ...record.localThread,
        targetConversationUrl: targetUrl,
        dedicatedConversationUrl: record.localThread.answerMode === 'dedicated_branch' ? targetUrl : record.localThread.dedicatedConversationUrl,
        messages,
        rounds,
        status: 'answer_attached',
        updatedAt: timestamp,
      },
      targetConversationUrl: targetUrl,
      associationStatus: 'associated',
    });
  }

  attachRounds(id: string, targetTabId: number, payloads: AttachedRoundPayload[], targetUrl: string,
    skippedRoundIds: string[] = []): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== targetTabId || record.associationStatus === 'cancelled') return null;
    const timestamp = this.now().toISOString();
    const unique = new Map(payloads.map((payload) => [payload.roundId, payload]));
    let localThread: LocalThread = { ...record.localThread, rounds: threadRounds(record.localThread, record.pendingThread) };
    for (const payload of unique.values()) {
      const round = localThread.rounds?.find((item) => item.id === payload.roundId);
      if (!round) return null;
      if (round.persistenceStatus === 'attached' || answerForRound(localThread, payload.roundId)) continue;
      if (roundAttachmentStatus(round) === 'skipped_expired') return null;
      const question = questionForRound(localThread, payload.roundId);
      const stagedMatches = round.persistenceStatus === 'staged' && round.stagedAnswer &&
        JSON.stringify(round.stagedAnswer) === JSON.stringify(payload.richContent);
      const explicitSelection = Boolean(payload.answerSource.selectedText);
      if (round.status !== 'answer_ready' || !question || !richPlainText(question.content).trim() || !payload.richContent.length ||
        (!stagedMatches && !explicitSelection)) return null;
    }
    let attached = 0;
    for (const payload of unique.values()) {
      const round = localThread.rounds?.find((item) => item.id === payload.roundId);
      if (!round || round.persistenceStatus === 'attached') continue;
      const answer: LocalMessage = {
        id: `pointask-answer-${payload.roundId}`, roundId: payload.roundId, role: 'assistant', content: payload.richContent,
        answerSource: payload.answerSource, attachedManually: true, attachedAt: timestamp, createdAt: timestamp,
      };
      localThread = insertRoundAnswer(localThread, payload.roundId, answer);
      localThread.rounds = localThread.rounds?.map((item) => item.id === payload.roundId ? {
        ...item, status: 'attached' as const, persistenceStatus: 'attached' as const, attachmentStatus: 'attached' as const,
        stagedAnswer: undefined, skippedAt: undefined, expiresAt: undefined,
        answerMessageId: answer.id,
        attachedAt: timestamp, answerSource: payload.answerSource,
        candidateAnswerFingerprint: payload.answerSource.messageFingerprint, updatedAt: timestamp,
      } : item);
      attached++;
    }
    const selectedIds = new Set(unique.keys());
    const skippedIds = new Set(skippedRoundIds.filter((roundId) => !selectedIds.has(roundId)));
    const skippedAt = this.now().getTime();
    localThread.rounds = localThread.rounds?.map((round) => skippedIds.has(round.id) &&
      round.persistenceStatus === 'staged' && roundAttachmentStatus(round) === 'available' && round.stagedAnswer?.length ? {
        ...round, attachmentStatus: 'skipped_retained' as const, skippedAt,
        expiresAt: skippedAt + SKIPPED_STAGED_ANSWER_RETENTION_MS, updatedAt: timestamp,
      } : round);
    const currentRoundId = roundIdForPending(localThread, record.pendingThread);
    const currentAttached = Boolean(currentRoundId && localThread.rounds?.find((round) => round.id === currentRoundId)?.status === 'attached');
    const operationComplete = Boolean(localThread.rounds?.length && localThread.rounds.every((round) =>
      ['attached', 'skipped_retained', 'skipped_expired'].includes(roundAttachmentStatus(round))));
    if (!attached) return record;
    return this.update(id, {
      pendingThread: { ...record.pendingThread, targetConversationUrl: targetUrl,
        status: currentAttached || operationComplete ? 'answer_attached' : record.pendingThread.status, updatedAt: timestamp },
      localThread: { ...localThread, targetConversationUrl: targetUrl,
        status: currentAttached || operationComplete ? 'answer_attached' : record.localThread.status, updatedAt: timestamp },
      targetConversationUrl: targetUrl, associationStatus: 'associated',
    });
  }

  stageRoundAnswer(id: string, targetTabId: number, roundId: string, promptHash: string, targetUrl: string,
    captureFailed: boolean, richContent?: RichContentBlock[], answerSource?: AnswerSourceLocator): PendingAssociation | null {
    const record = this.get(id);
    const rounds = record ? threadRounds(record.localThread) : [];
    if (!record || record.targetTabId !== targetTabId || record.associationStatus === 'cancelled' ||
      record.associationStatus === 'completed' ||
      record.pendingThread.id !== id ||
      !record.targetConversationUrl || !isCompatibleChatGptTargetUrl(record.targetConversationUrl, targetUrl)) return null;
    const current = rounds.find((round) => round.id === roundId);
    if (!current || current.promptHash !== promptHash || current.persistenceStatus === 'attached') return null;
    // A delayed capture failure must never erase content already staged by a
    // newer successful extraction of the same threadId + roundId.
    if (current.persistenceStatus === 'staged') return record;
    const timestamp = this.now().toISOString();
    if (!captureFailed && (current.status !== 'answer_ready' || !richContent?.length || !answerSource)) return null;
    const updatedRound = captureFailed ? {
      ...current, persistenceStatus: 'capture_failed' as const, stagedAnswer: undefined, updatedAt: timestamp,
      ...(answerSource ? { answerSource, candidateAnswerFingerprint: answerSource.messageFingerprint } : {}),
    } : {
      ...current, persistenceStatus: 'staged' as const, stagedAnswer: richContent, answerSource,
      attachmentStatus: current.attachmentStatus ?? 'available',
      candidateAnswerFingerprint: answerSource!.messageFingerprint, capturedAt: timestamp, updatedAt: timestamp,
    };
    return this.update(id, { localThread: { ...record.localThread,
      rounds: rounds.map((round) => round.id === roundId ? updatedRound : round), updatedAt: timestamp } });
  }

  undoAttachment(id: string, senderTabId: number): PendingAssociation | null {
    const record = this.get(id);
    if (!record || (record.sourceTabId !== senderTabId && record.targetTabId !== senderTabId) || record.localThread.messages.at(-1)?.role !== 'assistant') return null;
    return this.update(id, {
      pendingThread: { ...record.pendingThread, status: 'answer_ready', updatedAt: this.now().toISOString() },
      localThread: { ...record.localThread, messages: record.localThread.messages.slice(0, -1), status: 'answer_ready', updatedAt: this.now().toISOString() },
      associationStatus: record.targetConversationUrl ? 'associated' : 'created',
    });
  }
  markCandidate(id: string, senderTabId: number, fingerprint: string, streaming: boolean): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== senderTabId || record.associationStatus === 'cancelled' || record.associationStatus === 'completed') return null;
    const addressedRound = record.pendingThread.roundId
      ? threadRounds(record.localThread).find((round) => round.id === record.pendingThread.roundId) : undefined;
    if (record.pendingThread.roundId && (!addressedRound || addressedRound.pendingId !== id ||
      addressedRound.promptHash !== record.pendingThread.promptHash)) return null;
    const status: PendingThread['status'] = streaming ? 'generating' : 'answer_ready';
    const timestamp = this.now().toISOString();
    const pending = { ...record.pendingThread, candidateAnswerFingerprint: fingerprint, status,
      submittedPromptHash: record.pendingThread.promptHash || record.pendingThread.submittedPromptHash,
      submittedAt: record.pendingThread.submittedAt ?? timestamp, updatedAt: timestamp };
    let localThread = syncPendingRound({ ...record.localThread, status, updatedAt: timestamp }, pending, pendingStatus(status));
    const roundId = pending.roundId;
    if (roundId && record.targetConversationUrl) {
      const answerSource: AnswerSourceLocator = {
        conversationUrl: record.targetConversationUrl,
        conversationKey: pending.targetConversationKey ?? record.targetConversationUrl,
        messageFingerprint: fingerprint,
      };
      localThread = { ...localThread, rounds: threadRounds(localThread).map((round) => round.id === roundId ? {
        ...round, answerSource, candidateAnswerFingerprint: fingerprint, status: pendingStatus(status), updatedAt: timestamp,
      } : round) };
    }
    const updated = this.update(id, {
      pendingThread: pending,
      localThread,
    });
    if (updated) logPointAskLifecycle({ threadId: updated.localThread.id, roundId, pendingId: id,
      operationId: updated.pendingThread.operationId, revision: updated.revision,
      event: streaming ? 'answer_streaming' : 'answer_ready', beforeStatus: record.localThread.status,
      afterStatus: updated.localThread.status, activeRoundId: updated.pendingThread.roundId,
      promptMatched: true, assistantMatched: true, streaming });
    return updated;
  }

  reserveSubmission(id: string, senderTabId: number, promptHash: string, targetUrl: string): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== senderTabId || record.associationStatus === 'cancelled' ||
      record.pendingThread.promptHash !== promptHash || record.pendingThread.submittedPromptHash === promptHash) return null;
    const validTarget = record.localThread.answerMode === 'current_conversation'
      ? isCompatibleChatGptTargetUrl(record.localThread.sourceConversationKey, targetUrl)
      : Boolean(record.targetConversationUrl && isCompatibleChatGptTargetUrl(record.targetConversationUrl, targetUrl));
    if (!validTarget) return null;
    const timestamp = this.now().toISOString();
    return this.update(id, {
      pendingThread: { ...record.pendingThread, submittedPromptHash: promptHash, submittedAt: timestamp, status: 'waiting_for_answer', updatedAt: timestamp },
      localThread: syncPendingRound({ ...record.localThread, status: 'waiting_for_answer', updatedAt: timestamp },
        { ...record.pendingThread, submittedPromptHash: promptHash, submittedAt: timestamp, status: 'waiting_for_answer', updatedAt: timestamp }),
      associationStatus: 'associated',
    });
  }

  markSubmissionStarted(id: string, senderTabId: number, promptHash: string, targetUrl: string): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== senderTabId || record.associationStatus === 'cancelled' ||
      record.associationStatus === 'completed' || record.pendingThread.promptHash !== promptHash ||
      record.pendingThread.submittedPromptHash === promptHash) return null;
    const validTarget = record.localThread.answerMode === 'current_conversation'
      ? isCompatibleChatGptTargetUrl(record.localThread.sourceConversationKey, targetUrl)
      : Boolean(record.targetConversationUrl && isCompatibleChatGptTargetUrl(record.targetConversationUrl, targetUrl));
    if (!validTarget) return null;
    const timestamp = this.now().toISOString();
    const pending = { ...record.pendingThread, status: 'submitting' as const, updatedAt: timestamp };
    return this.update(id, { pendingThread: pending,
      localThread: syncPendingRound({ ...record.localThread, status: 'submitting', updatedAt: timestamp }, pending),
      associationStatus: 'associated' });
  }

  markSubmissionUnknown(id: string, senderTabId: number, promptHash: string, targetUrl: string): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== senderTabId || record.associationStatus === 'cancelled' ||
      record.pendingThread.promptHash !== promptHash) return null;
    if (record.pendingThread.submittedPromptHash === promptHash) return record;
    const currentRound = threadRounds(record.localThread).find((round) => round.id === record.pendingThread.roundId);
    if (currentRound && (['waiting_for_answer', 'generating', 'answer_ready', 'attached'].includes(currentRound.status) ||
      ['staged', 'attached'].includes(currentRound.persistenceStatus))) return record;
    const validTarget = record.localThread.answerMode === 'current_conversation'
      ? isCompatibleChatGptTargetUrl(record.localThread.sourceConversationKey, targetUrl)
      : Boolean(record.targetConversationUrl && isCompatibleChatGptTargetUrl(record.targetConversationUrl, targetUrl));
    if (!validTarget) return null;
    const timestamp = this.now().toISOString();
    const pending = { ...record.pendingThread, status: 'submission_unknown' as const, updatedAt: timestamp };
    return this.update(id, {
      pendingThread: pending,
      localThread: syncPendingRound({ ...record.localThread, status: 'submission_unknown', updatedAt: timestamp }, pending),
      associationStatus: 'associated',
    });
  }

  releaseSubmission(id: string, senderTabId: number, promptHash: string): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== senderTabId || record.pendingThread.submittedPromptHash !== promptHash ||
      record.localThread.status !== 'waiting_for_answer') return null;
    const timestamp = this.now().toISOString();
    const { submittedPromptHash: _hash, submittedAt: _at, ...pendingThread } = record.pendingThread;
    void _hash; void _at;
    return this.update(id, {
      pendingThread: { ...pendingThread, status: 'waiting_for_submission', updatedAt: timestamp },
      localThread: { ...record.localThread, status: 'waiting_for_submission', updatedAt: timestamp },
    });
  }

  markSendFailed(id: string): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.pendingThread.submittedPromptHash === record.pendingThread.promptHash) return record;
    const currentRound = threadRounds(record.localThread).find((round) => round.id === record.pendingThread.roundId);
    if (record.associationStatus === 'completed' || currentRound &&
      (['waiting_for_answer', 'generating', 'answer_ready', 'attached'].includes(currentRound.status) ||
        ['staged', 'attached'].includes(currentRound.persistenceStatus))) {
      logPointAskLifecycle({ threadId: record.localThread.id, roundId: record.pendingThread.roundId,
        pendingId: id, operationId: record.pendingThread.operationId, revision: record.revision,
        event: 'stale_result_discarded', beforeStatus: record.localThread.status, afterStatus: 'failed',
        activeRoundId: record.pendingThread.roundId, errorCode: 'late_send_failure' });
      return record;
    }
    const timestamp = this.now().toISOString();
    return this.update(id, {
      pendingThread: { ...record.pendingThread, status: 'failed', updatedAt: timestamp },
      localThread: syncPendingRound({ ...record.localThread, status: 'failed', updatedAt: timestamp },
        { ...record.pendingThread, status: 'failed', updatedAt: timestamp }),
    });
  }

  completeReturn(id: string, targetTabId: number): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== targetTabId || !threadRounds(record.localThread, record.pendingThread).some((round) => round.status === 'attached')) return null;
    return this.update(id, { associationStatus: 'completed' });
  }

  get(id: string): PendingAssociation | null {
    this.removeExpired();
    return this.records.get(id) ?? null;
  }

  findByThreadId(threadId: string): PendingAssociation | null {
    this.removeExpired();
    return [...this.records.values()].filter((record) => record.localThread.id === threadId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
  }

  deleteThread(threadId: string): number {
    let deleted = 0;
    for (const [id, record] of this.records) if (record.localThread.id === threadId) {
      this.records.delete(id); deleted++;
    }
    return deleted;
  }

  retireForContinuation(id: string): PendingAssociation | null {
    const record = this.get(id);
    return record ? this.update(id, { associationStatus: 'completed' }) : null;
  }

  forPage(tabId: number): PendingAssociation[] {
    this.removeExpired();
    return [...this.records.values()].filter((record) =>
      record.associationStatus !== 'cancelled' && record.associationStatus !== 'completed' &&
      (record.targetTabId === tabId || record.associationStatus === 'awaiting_manual_association'),
    );
  }

  forSourceTab(tabId: number): PendingAssociation[] {
    this.removeExpired();
    return [...this.records.values()].filter((record) =>
      record.sourceTabId === tabId && record.associationStatus !== 'cancelled',
    );
  }

  clearTargetTab(tabId: number): PendingAssociation[] {
    const updated: PendingAssociation[] = [];
    for (const [id, record] of this.records) {
      if (record.targetTabId !== tabId) continue;
      const { targetTabId: _pendingTabId, ...pendingThread } = record.pendingThread;
      void _pendingTabId;
      const shouldRetry = pendingThread.status !== 'submission_unknown' && pendingThread.status !== 'submitting' &&
        pendingThread.submittedPromptHash !== pendingThread.promptHash &&
        (pendingThread.status === 'waiting_for_submission' || record.localThread.status === 'waiting_for_submission');
      const revision = (record.revision ?? 0) + 1;
      const next: PendingAssociation = {
        ...record,
        pendingThread: { ...pendingThread, status: pendingThread.status === 'submitting' ? 'submission_unknown' :
          shouldRetry ? 'failed' : pendingThread.status, revision },
        localThread: { ...record.localThread, status: record.localThread.status === 'submitting' ? 'submission_unknown' :
          shouldRetry ? 'failed' : record.localThread.status, revision },
        targetTabId: undefined,
        associationStatus: record.targetConversationUrl ? 'associated' : 'created',
        updatedAt: this.now().toISOString(),
        revision,
      };
      this.records.set(id, next); updated.push(next);
    }
    return updated;
  }

  private update(id: string, changes: Partial<PendingAssociation>): PendingAssociation | null {
    const record = this.records.get(id);
    if (!record) return null;
    const revision = Math.max(record.revision ?? 0, record.pendingThread.revision ?? 0, record.localThread.revision ?? 0) + 1;
    const changedPending = changes.pendingThread ?? record.pendingThread;
    const changedThread = changes.localThread ?? record.localThread;
    const updated = { ...record, ...changes, pendingThread: { ...changedPending, revision },
      localThread: { ...changedThread, revision }, revision, updatedAt: this.now().toISOString() };
    this.records.set(id, updated);
    return updated;
  }

  private toPendingStatus(status: LocalThread['status']): PendingThread['status'] {
    return status === 'draft' || status === 'orphaned' ? 'waiting_for_submission' : status;
  }

  private removeExpired(): void {
    const now = this.now().getTime();
    for (const [id, record] of this.records) {
      if (now - Date.parse(record.createdAt) > this.expiryMs) this.records.delete(id);
    }
  }

  private createLocalThread(pendingThread: PendingThread, timestamp: string): LocalThread {
    const questionMessageId = `pointask-message-${pendingThread.id}`;
    return {
      id: pendingThread.threadId || pendingThread.id,
      displayId: pendingThread.displayId,
      answerMode: pendingThread.answerMode,
      workspaceId: pendingThread.workspaceId,
      dedicatedConversationUrl: pendingThread.answerMode === 'dedicated_branch' ? pendingThread.targetConversationUrl : undefined,
      anchor: pendingThread.anchor,
      sourcePageUrl: pendingThread.sourcePageUrl,
      sourceConversationKey: pendingThread.sourceConversationKey,
      sourceMessageFingerprint: pendingThread.sourceMessageFingerprint,
      targetConversationUrl: pendingThread.targetConversationUrl,
      messages: [{
        id: questionMessageId,
        roundId: pendingThread.roundId,
        role: 'user',
        content: textBlocks(pendingThread.question),
        attachedManually: false,
        createdAt: timestamp,
      }],
      rounds: pendingThread.roundId ? [{
        id: pendingThread.roundId, questionMessageId, pendingId: pendingThread.id, promptHash: pendingThread.promptHash || `pointask-prompt-${pendingThread.id}`,
        assistantFingerprintsBefore: pendingThread.assistantFingerprintsBefore ?? [], status: pendingStatus(pendingThread.status),
        persistenceStatus: 'not_captured',
        attachmentStatus: 'available',
        createdAt: timestamp, updatedAt: timestamp,
      }] : undefined,
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
