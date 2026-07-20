import type { PendingThread } from '../bridge/pending-thread-manager';
import type { LocalMessage, LocalThread, LocalThreadRound } from './local-thread';

export function threadRounds(thread: LocalThread, pending?: PendingThread): LocalThreadRound[] {
  if (thread.rounds?.length) {
    if (!pending) return thread.rounds;
    const currentId = pending.roundId ?? thread.rounds.at(-1)?.id;
    return thread.rounds.map((round) => round.id !== currentId ? round : {
      ...round, pendingId: pending.id, promptHash: pending.promptHash || round.promptHash,
      assistantFingerprintsBefore: pending.assistantFingerprintsBefore ?? round.assistantFingerprintsBefore,
      candidateAnswerFingerprint: pending.candidateAnswerFingerprint ?? round.candidateAnswerFingerprint,
      status: round.status === 'attached' ? 'attached' : pendingStatus(pending.status), updatedAt: pending.updatedAt,
    });
  }
  const answers = new Map<string, LocalMessage>();
  let latestUserId: string | undefined;
  for (const message of thread.messages) {
    if (message.role === 'user') latestUserId = message.id;
    else if (message.roundId || latestUserId) answers.set(message.roundId ?? latestUserId!, message);
  }
  return thread.messages.filter((message) => message.role === 'user').map((message) => {
    const answer = answers.get(message.id);
    const isCurrent = Boolean(pending && (pending.roundId === message.id || (!pending.roundId &&
      message.id === thread.messages.filter((item) => item.role === 'user').at(-1)?.id)));
    return {
      id: message.id,
      pendingId: isCurrent ? pending?.id ?? `pointask-legacy-${message.id}` : `pointask-legacy-${message.id}`,
      promptHash: isCurrent ? pending?.promptHash || `pointask-legacy-${message.id}` : `pointask-legacy-${message.id}`,
      assistantFingerprintsBefore: isCurrent ? pending?.assistantFingerprintsBefore ?? [] : [],
      candidateAnswerFingerprint: answer?.answerSource?.messageFingerprint ?? (isCurrent ? pending?.candidateAnswerFingerprint : undefined),
      status: answer ? 'attached' : isCurrent ? pendingStatus(pending?.status) : 'failed',
      persistenceStatus: answer ? 'attached' : 'not_captured',
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

export function syncPendingRound(thread: LocalThread, pending: PendingThread, status = pendingStatus(pending.status)): LocalThread {
  const rounds = threadRounds(thread, pending);
  const id = pending.roundId ?? thread.messages.filter((message) => message.role === 'user').at(-1)?.id;
  if (!id) return thread;
  const now = pending.updatedAt;
  const value: LocalThreadRound = {
    id, pendingId: pending.id, promptHash: pending.promptHash || `pointask-prompt-${pending.id}`,
    assistantFingerprintsBefore: pending.assistantFingerprintsBefore ?? [],
    candidateAnswerFingerprint: pending.candidateAnswerFingerprint,
    status, createdAt: rounds.find((round) => round.id === id)?.createdAt ?? pending.createdAt, updatedAt: now,
    persistenceStatus: rounds.find((round) => round.id === id)?.persistenceStatus ?? (status === 'attached' ? 'attached' : 'not_captured'),
    stagedAnswer: rounds.find((round) => round.id === id)?.stagedAnswer,
    capturedAt: rounds.find((round) => round.id === id)?.capturedAt,
    attachedAt: rounds.find((round) => round.id === id)?.attachedAt,
    answerSource: rounds.find((round) => round.id === id)?.answerSource,
  };
  return { ...thread, rounds: [...rounds.filter((round) => round.id !== id), value] };
}

export function answerForRound(thread: LocalThread, roundId: string): LocalMessage | undefined {
  let latestUserId: string | undefined;
  for (const message of thread.messages) {
    if (message.role === 'user') latestUserId = message.id;
    else if ((message.roundId ?? latestUserId) === roundId) return message;
  }
  return undefined;
}

export function insertRoundAnswer(thread: LocalThread, roundId: string, answer: LocalMessage): LocalThread {
  if (answerForRound(thread, roundId)) return thread;
  const userIndex = thread.messages.findIndex((message) => message.role === 'user' && message.id === roundId);
  if (userIndex < 0) return thread;
  const messages = [...thread.messages];
  let insertAt = userIndex + 1;
  while (insertAt < messages.length && messages[insertAt]?.role === 'assistant') insertAt++;
  messages.splice(insertAt, 0, { ...answer, roundId });
  return { ...thread, messages };
}
