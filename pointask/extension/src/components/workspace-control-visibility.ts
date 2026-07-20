import type { PendingAssociation } from '../bridge/runtime-messages';
import { threadRounds } from '../shared/thread-rounds';
import { roundAttachmentStatus } from '../shared/staged-answer-retention';

export type WorkspaceControlVisibility = 'hidden' | 'collapsed_idle' | 'collapsed_active' | 'expanded';

export function isActiveWorkspaceThread(record: PendingAssociation, transient = false): boolean {
  if (record.localThread.answerMode !== 'workspace' ||
    record.associationStatus === 'cancelled' || record.associationStatus === 'completed' || record.localThread.status === 'orphaned') return false;
  if (transient) return true;
  const rounds = threadRounds(record.localThread, record.pendingThread);
  if (rounds.length > 0 && rounds.every((round) => ['attached', 'skipped_retained', 'skipped_expired'].includes(roundAttachmentStatus(round)))) return false;
  if (rounds.some((round) => roundAttachmentStatus(round) === 'available' &&
    (round.persistenceStatus === 'staged' || round.persistenceStatus === 'attaching' ||
    round.persistenceStatus === 'capture_failed'))) return true;
  if (rounds.some((round) => roundAttachmentStatus(round) === 'available' &&
    ['waiting_for_submission', 'submitting', 'submission_unknown', 'waiting_for_answer', 'generating', 'answer_ready', 'failed'].includes(round.status))) return true;
  if (rounds.length > 0 && rounds.every((round) => round.status === 'attached' || round.persistenceStatus === 'attached')) return false;
  return ['draft', 'prompt_ready', 'waiting_for_submission', 'submitting', 'submission_unknown', 'waiting_for_answer', 'generating', 'answer_ready', 'failed']
    .includes(record.localThread.status) ||
    ['prompt_ready', 'waiting_for_submission', 'submitting', 'submission_unknown', 'waiting_for_answer', 'generating', 'answer_ready', 'failed']
      .includes(record.pendingThread.status);
}

export function deriveWorkspaceControlVisibility(workspacePage: boolean, activeCount: number, expanded: boolean): WorkspaceControlVisibility {
  if (!workspacePage) return 'hidden';
  if (activeCount === 0) return expanded ? 'expanded' : 'collapsed_idle';
  return expanded ? 'expanded' : 'collapsed_active';
}
