import type { PendingThread } from '../bridge/pending-thread-manager';
import type { LocalMessage, LocalThread, LocalThreadRound } from './local-thread';

export function threadRounds(thread: LocalThread, pending?: PendingThread): LocalThreadRound[] {
  if (thread.rounds?.length) {
    // LocalThreadRound is the canonical persisted lifecycle snapshot. Pending
    // records describe submission transport and are folded into the round only
    // by syncPendingRound; readers must not overlay a potentially newer pending
    // on an older UI snapshot and accidentally change a different round.
    return thread.rounds;
  }
  const answers = new Map<string, LocalMessage>();
  let latestRoundId: string | undefined;
  for (const message of thread.messages) {
    if (message.role === 'user') latestRoundId = message.roundId ?? message.id;
    else if (message.roundId || latestRoundId) answers.set(message.roundId ?? latestRoundId!, message);
  }
  return thread.messages.filter((message) => message.role === 'user').map((message) => {
    const roundId = message.roundId ?? message.id;
    const answer = answers.get(roundId);
    const isCurrent = Boolean(pending && (pending.roundId === roundId || (!pending.roundId &&
      message.id === thread.messages.filter((item) => item.role === 'user').at(-1)?.id)));
    return {
      id: roundId,
      questionMessageId: message.id,
      answerMessageId: answer?.id,
      pendingId: isCurrent ? pending?.id ?? `pointask-legacy-${message.id}` : `pointask-legacy-${message.id}`,
      promptHash: isCurrent ? pending?.promptHash || `pointask-legacy-${message.id}` : `pointask-legacy-${message.id}`,
      assistantFingerprintsBefore: isCurrent ? pending?.assistantFingerprintsBefore ?? [] : [],
      candidateAnswerFingerprint: answer?.answerSource?.messageFingerprint ?? (isCurrent ? pending?.candidateAnswerFingerprint : undefined),
      status: answer ? 'attached' : isCurrent ? pendingStatus(pending?.status) : 'failed',
      persistenceStatus: answer ? 'attached' : 'not_captured',
      attachmentStatus: answer ? 'attached' : 'available',
      attachedAt: answer?.attachedAt ?? (answer ? answer.createdAt : undefined),
      answerSource: answer?.answerSource,
      createdAt: message.createdAt,
      updatedAt: answer?.attachedAt ?? answer?.createdAt ?? message.createdAt,
    } satisfies LocalThreadRound;
  });
}

export function pendingStatus(status?: PendingThread['status']): LocalThreadRound['status'] {
  if (status === 'generating') return 'generating';
  if (status === 'answer_ready') return 'answer_ready';
  if (status === 'failed') return 'failed';
  if (status === 'answer_attached') return 'attached';
  if (status === 'waiting_for_answer') return 'waiting_for_answer';
  return 'waiting_for_submission';
}

export function roundIdForPending(thread: LocalThread, pending: PendingThread): string | undefined {
  return pending.roundId ?? threadRounds(thread).find((round) => round.pendingId === pending.id)?.id;
}

export function syncPendingRound(thread: LocalThread, pending: PendingThread, status = pendingStatus(pending.status)): LocalThread {
  const rounds = threadRounds(thread);
  const latestQuestion = thread.messages.filter((message) => message.role === 'user').at(-1);
  const id = pending.roundId ?? latestQuestion?.roundId ?? latestQuestion?.id;
  if (!id) return thread;
  const now = pending.updatedAt;
  const value: LocalThreadRound = {
    id, pendingId: pending.id, promptHash: pending.promptHash || `pointask-prompt-${pending.id}`,
    questionMessageId: rounds.find((round) => round.id === id)?.questionMessageId ?? latestQuestion?.id ?? id,
    answerMessageId: rounds.find((round) => round.id === id)?.answerMessageId,
    assistantFingerprintsBefore: pending.assistantFingerprintsBefore ?? [],
    candidateAnswerFingerprint: pending.candidateAnswerFingerprint,
    status, createdAt: rounds.find((round) => round.id === id)?.createdAt ?? pending.createdAt, updatedAt: now,
    persistenceStatus: rounds.find((round) => round.id === id)?.persistenceStatus ?? (status === 'attached' ? 'attached' : 'not_captured'),
    attachmentStatus: rounds.find((round) => round.id === id)?.attachmentStatus ?? (status === 'attached' ? 'attached' : 'available'),
    stagedAnswer: rounds.find((round) => round.id === id)?.stagedAnswer,
    skippedAt: rounds.find((round) => round.id === id)?.skippedAt,
    expiresAt: rounds.find((round) => round.id === id)?.expiresAt,
    capturedAt: rounds.find((round) => round.id === id)?.capturedAt,
    attachedAt: rounds.find((round) => round.id === id)?.attachedAt,
    answerSource: rounds.find((round) => round.id === id)?.answerSource,
  };
  return { ...thread, rounds: [...rounds.filter((round) => round.id !== id), value] };
}

export function answerForRound(thread: LocalThread, roundId: string): LocalMessage | undefined {
  let latestRoundId: string | undefined;
  for (const message of thread.messages) {
    if (message.role === 'user') latestRoundId = message.roundId ?? message.id;
    else if ((message.roundId ?? latestRoundId) === roundId) return message;
  }
  return undefined;
}

/** Complete rounds that have actually been persisted into the source card. */
export function attachedRounds(thread: LocalThread): LocalThreadRound[] {
  return threadRounds(thread).filter((round) => round.status === 'attached' && round.persistenceStatus === 'attached' &&
    Boolean(questionForRound(thread, round.id)) && Boolean(answerForRound(thread, round.id)));
}

export function questionForRound(thread: LocalThread, roundId: string): LocalMessage | undefined {
  const questionMessageId = thread.rounds?.find((round) => round.id === roundId)?.questionMessageId;
  return thread.messages.find((message) => message.role === 'user' &&
    (message.id === questionMessageId || message.roundId === roundId || !questionMessageId && message.id === roundId));
}

export function insertRoundAnswer(thread: LocalThread, roundId: string, answer: LocalMessage): LocalThread {
  if (answerForRound(thread, roundId)) return thread;
  const question = questionForRound(thread, roundId);
  const userIndex = question ? thread.messages.indexOf(question) : -1;
  if (userIndex < 0) return thread;
  const messages = [...thread.messages];
  let insertAt = userIndex + 1;
  while (insertAt < messages.length && messages[insertAt]?.role === 'assistant') insertAt++;
  messages.splice(insertAt, 0, { ...answer, roundId });
  return { ...thread, messages };
}
