import type { PendingThread } from '../bridge/pending-thread-manager';
import { isCompatibleChatGptTargetUrl, type PendingAssociation } from '../bridge/runtime-messages';
import type { AnswerSourceLocator, LocalMessage, LocalThread, RichContentBlock } from '../shared/local-thread';
import { textBlocks } from '../shared/rich-content';

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
    const timestamp = this.now().toISOString();
    const record: PendingAssociation = existing
      ? { ...existing, pendingThread, localThread: localThread ?? existing.localThread, sourceTabId, updatedAt: timestamp }
      : {
          pendingThread,
          localThread: localThread ?? this.createLocalThread(pendingThread, timestamp),
          sourceTabId,
          targetConversationUrl: localThread?.targetConversationUrl ?? pendingThread.targetConversationUrl,
          associationStatus: 'created',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
    this.records.set(pendingThread.id, record);
    return record;
  }

  restore(pendingThread: PendingThread, localThread: LocalThread, sourceTabId: number): PendingAssociation {
    const timestamp = this.now().toISOString();
    const existing = this.records.get(pendingThread.id);
    const record: PendingAssociation = {
      pendingThread,
      localThread,
      sourceTabId,
      targetTabId: existing?.targetTabId ?? pendingThread.targetTabId,
      targetConversationUrl: localThread.targetConversationUrl,
      associationStatus: existing?.associationStatus ?? (localThread.status === 'answer_attached' ? 'completed' : localThread.targetConversationUrl ? 'associated' : 'created'),
      createdAt: existing?.createdAt ?? localThread.createdAt,
      updatedAt: timestamp,
    };
    this.records.set(pendingThread.id, record);
    return record;
  }

  markTargetOpened(id: string, targetTabId: number, targetUrl: string): PendingAssociation | null {
    const record = this.get(id);
    if (!record) return null;
    const status = ['waiting_for_answer', 'generating', 'answer_ready', 'answer_attached'].includes(record.localThread.status)
      ? record.localThread.status : 'waiting_for_submission';
    return this.update(id, {
      pendingThread: { ...record.pendingThread, targetConversationUrl: targetUrl, targetTabId, targetConversationKey: record.localThread.answerMode === 'current_conversation' ? record.localThread.sourceConversationKey : targetUrl, status: this.toPendingStatus(status) },
      localThread: {
        ...record.localThread,
        targetConversationUrl: targetUrl,
        dedicatedConversationUrl: record.localThread.answerMode === 'dedicated_branch' ? targetUrl : record.localThread.dedicatedConversationUrl,
        status,
        updatedAt: this.now().toISOString(),
      },
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
      localThread: {
        ...record.localThread,
        status: record.localThread.status === 'answer_attached' ? 'answer_attached' : 'waiting_for_submission',
        updatedAt: this.now().toISOString(),
      },
    });
  }

  associate(id: string, targetTabId: number, targetUrl: string, confirmReassociation = false): PendingAssociation | null {
    const record = this.get(id);
    if (!record) return null;
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
    const status = ['waiting_for_answer', 'generating', 'answer_ready', 'answer_attached'].includes(record.localThread.status)
      ? record.localThread.status : 'waiting_for_submission';
    return this.update(id, {
      pendingThread: { ...record.pendingThread, targetConversationUrl: targetUrl, targetTabId, targetConversationKey: record.localThread.answerMode === 'current_conversation' ? record.localThread.sourceConversationKey : targetUrl, status: this.toPendingStatus(status) },
      localThread: {
        ...record.localThread,
        targetConversationUrl: targetUrl,
        dedicatedConversationUrl: record.localThread.answerMode === 'dedicated_branch' ? targetUrl : record.localThread.dedicatedConversationUrl,
        status,
        updatedAt: this.now().toISOString(),
      },
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
    if (!record || (!allowSourceRebind && record.sourceTabId !== sourceTabId) || localThread.id !== pendingThread.id) return null;
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
    const answer: LocalMessage = {
      id: existingAnswerIndex >= 0
        ? record.localThread.messages[existingAnswerIndex]!.id
        : `pointask-answer-${id}`,
      role: 'assistant',
      content: typeof selected === 'string' ? textBlocks(selected.trim()) : selected,
      answerSource,
      attachedManually: true,
      createdAt: timestamp,
    };
    const messages = [...record.localThread.messages];
    if (existingAnswerIndex >= 0) messages[existingAnswerIndex] = answer;
    else messages.push(answer);
    return this.update(id, {
      pendingThread: { ...record.pendingThread, targetConversationUrl: targetUrl, status: 'answer_attached', candidateAnswerFingerprint: answerSource?.messageFingerprint },
      localThread: {
        ...record.localThread,
        targetConversationUrl: targetUrl,
        dedicatedConversationUrl: record.localThread.answerMode === 'dedicated_branch' ? targetUrl : record.localThread.dedicatedConversationUrl,
        messages,
        status: 'answer_attached',
        updatedAt: timestamp,
      },
      targetConversationUrl: targetUrl,
      associationStatus: 'associated',
    });
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
    if (!record || record.targetTabId !== senderTabId || record.associationStatus === 'cancelled') return null;
    const status = streaming ? 'generating' : 'answer_ready';
    return this.update(id, {
      pendingThread: { ...record.pendingThread, candidateAnswerFingerprint: fingerprint, status, updatedAt: this.now().toISOString() },
      localThread: { ...record.localThread, status, updatedAt: this.now().toISOString() },
    });
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
      localThread: { ...record.localThread, status: 'waiting_for_answer', updatedAt: timestamp },
      associationStatus: 'associated',
    });
  }

  completeReturn(id: string, targetTabId: number): PendingAssociation | null {
    const record = this.get(id);
    if (!record || record.targetTabId !== targetTabId || record.localThread.status !== 'answer_attached') return null;
    return this.update(id, { associationStatus: 'completed' });
  }

  get(id: string): PendingAssociation | null {
    this.removeExpired();
    return this.records.get(id) ?? null;
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

  private update(id: string, changes: Partial<PendingAssociation>): PendingAssociation | null {
    const record = this.records.get(id);
    if (!record) return null;
    const updated = { ...record, ...changes, updatedAt: this.now().toISOString() };
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
    return {
      id: pendingThread.id,
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
        id: `pointask-question-${pendingThread.id}`,
        role: 'user',
        content: textBlocks(pendingThread.question),
        attachedManually: false,
        createdAt: timestamp,
      }],
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
