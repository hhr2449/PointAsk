import type { PendingAssociation } from '../bridge/runtime-messages';
import type { CandidateAnswer } from '../adapters/site-adapter';

export type WorkspaceControlStatus = 'pending' | 'sending' | 'waiting' | 'streaming' | 'attachable' | 'selection' |
  'ambiguous' | 'failed' | 'attached' | 'return_failed';

export interface WorkspaceControlDerivedState {
  status: WorkspaceControlStatus;
  label: string;
  primary?: 'send' | 'retry' | 'attach_latest_return' | 'attach_selection_return' | 'return' | 'retry_return';
  secondary?: 'continue';
}

export function deriveWorkspaceControlState(options: {
  record: PendingAssociation;
  candidate?: CandidateAnswer;
  reliable: boolean;
  sending: boolean;
  selectionLength: number;
  returnFailed: boolean;
}): WorkspaceControlDerivedState {
  const { record, candidate, reliable, sending, selectionLength, returnFailed } = options;
  if (returnFailed) return { status: 'return_failed', label: '回答已附加', primary: 'retry_return' };
  if (record.localThread.status === 'answer_attached') return { status: 'attached', label: '已附加', primary: 'return', secondary: 'continue' };
  if (sending) return { status: 'sending', label: '正在发送' };
  if (record.localThread.status === 'failed' || record.pendingThread.status === 'failed') return { status: 'failed', label: '发送失败', primary: 'retry' };
  if (candidate?.streaming || record.localThread.status === 'generating') return { status: 'streaming', label: '流式生成中' };
  if (candidate && selectionLength > 0) return { status: 'selection', label: `已选择 ${selectionLength} 个字符`, primary: 'attach_selection_return' };
  if (candidate && !reliable) return { status: 'ambiguous', label: '回答匹配不明确' };
  if (candidate && reliable) return { status: 'attachable', label: '回答可附加', primary: 'attach_latest_return', secondary: 'continue' };
  if (record.pendingThread.submittedPromptHash === record.pendingThread.promptHash ||
    ['waiting_for_answer', 'generating'].includes(record.localThread.status)) return { status: 'waiting', label: '等待回答' };
  return { status: 'pending', label: '待发送', primary: 'send' };
}

