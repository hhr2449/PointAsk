import type { PendingAssociation } from '../bridge/runtime-messages';
import type { CandidateAnswer } from '../adapters/site-adapter';

export type WorkspaceControlStatus = 'pending' | 'sending' | 'waiting' | 'streaming' | 'attachable' | 'selection' |
  'ambiguous' | 'failed' | 'attached' | 'return_failed';

export interface WorkspaceControlDerivedState {
  status: WorkspaceControlStatus;
  label: string;
  primary?: 'send' | 'retry' | 'attach_default_return' | 'attach_selection_return' | 'return' | 'retry_return';
  primaryLabel?: string;
  secondary?: 'continue';
}

export function deriveWorkspaceControlState(options: {
  record: PendingAssociation;
  candidate?: CandidateAnswer;
  reliable: boolean;
  sending: boolean;
  selectionLength: number;
  returnFailed: boolean;
  attachableRoundCount?: number;
  stagedRoundCount?: number;
  totalRoundCount?: number;
  attachedRoundCount?: number;
  canContinue?: boolean;
}): WorkspaceControlDerivedState {
  const { record, candidate, reliable, sending, selectionLength, returnFailed } = options;
  const attachable = options.attachableRoundCount ?? (candidate && reliable ? 1 : 0);
  if (returnFailed) return { status: 'return_failed', label: '内容已附加，但未能返回原页面', primary: 'retry_return' };
  if (sending) return { status: 'sending', label: '正在发送' };
  if (record.localThread.status === 'failed' || record.pendingThread.status === 'failed') return { status: 'failed', label: '发送失败', primary: 'retry' };
  if (candidate?.streaming || record.localThread.status === 'generating') return { status: 'streaming', label: '流式生成中' };
  if (candidate && selectionLength > 0) return { status: 'selection', label: `已选择 ${selectionLength} 个字符`, primary: 'attach_selection_return' };
  if (attachable > 0) {
    const primaryLabel = (options.totalRoundCount ?? 1) === 1 ? '附加本轮并返回'
      : (options.attachedRoundCount ?? 0) > 0 ? `附加新增 ${attachable} 轮并返回` : `附加全部 ${attachable} 轮并返回`;
    const label = (options.stagedRoundCount ?? attachable) === attachable ? `${attachable} 轮已暂存，可附加` : `${attachable} 轮回答可附加`;
    return { status: 'attachable', label, primary: 'attach_default_return', primaryLabel,
      secondary: options.canContinue || candidate && reliable || record.localThread.status === 'answer_attached' ? 'continue' : undefined };
  }
  if (candidate && !reliable) return { status: 'ambiguous', label: '回答匹配不明确' };
  if (options.canContinue) return { status: 'waiting', label: '回答已完成，继续追问时将暂存', secondary: 'continue' };
  if (record.localThread.status === 'answer_attached') return { status: 'attached', label: '已附加', primary: 'return', secondary: 'continue' };
  if (record.pendingThread.submittedPromptHash === record.pendingThread.promptHash ||
    ['waiting_for_answer', 'generating'].includes(record.localThread.status)) return { status: 'waiting', label: '等待回答' };
  return { status: 'pending', label: '待发送', primary: 'send' };
}
