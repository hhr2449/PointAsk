export type PointAskLifecycleEvent = 'create_round' | 'submit_start' | 'submit_timeout' | 'submit_reconciled' |
  'answer_streaming' | 'answer_ready' | 'stage_start' | 'stage_retry' | 'stage_success' | 'stage_failure' |
  'stale_result_discarded';

export interface PointAskLifecycleLog {
  threadId: string;
  roundId?: string;
  pendingId?: string;
  operationId?: string;
  revision?: number;
  event: PointAskLifecycleEvent;
  beforeStatus?: string;
  afterStatus?: string;
  activeRoundId?: string;
  promptMatched?: boolean;
  assistantMatched?: boolean;
  streaming?: boolean;
  errorCode?: string;
}

/** Development-only lifecycle diagnostics. Never logs prompt or answer content. */
export function logPointAskLifecycle(value: PointAskLifecycleLog): void {
  if (!import.meta.env.DEV) return;
  console.debug('[PointAsk lifecycle]\n' + Object.entries(value)
    .map(([key, item]) => `${key}=${item ?? ''}`).join('\n'));
}
