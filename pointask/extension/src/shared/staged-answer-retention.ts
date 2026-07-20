import type { LocalThread, LocalThreadRound } from './local-thread';

export const SKIPPED_STAGED_ANSWER_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export function roundAttachmentStatus(round: LocalThreadRound): NonNullable<LocalThreadRound['attachmentStatus']> {
  if (round.attachmentStatus) return round.attachmentStatus;
  return round.persistenceStatus === 'attached' || round.status === 'attached' ? 'attached' : 'available';
}

export function cleanupExpiredStagedAnswers(threads: LocalThread[], now: number): { threads: LocalThread[]; changed: boolean } {
  let changed = false;
  const cleaned = threads.map((thread) => {
    let threadChanged = false;
    const rounds = thread.rounds?.map((round) => {
      if (roundAttachmentStatus(round) !== 'skipped_retained' || round.expiresAt === undefined || round.expiresAt > now) return round;
      changed = true; threadChanged = true;
      return { ...round, attachmentStatus: 'skipped_expired' as const, persistenceStatus: 'not_captured' as const,
        stagedAnswer: undefined, skippedAt: round.skippedAt, expiresAt: round.expiresAt,
        updatedAt: new Date(now).toISOString() };
    });
    return threadChanged ? { ...thread, rounds, updatedAt: new Date(now).toISOString() } : thread;
  });
  return { threads: cleaned, changed };
}
