import type { PendingAssociation } from '../bridge/runtime-messages';
import { roundAttachmentStatus } from '../shared/staged-answer-retention';
import { threadRounds } from '../shared/thread-rounds';
import { isActiveWorkspaceThread } from './workspace-control-visibility';
import { richPlainText } from '../shared/rich-content';

export type WorkspaceThreadGroup = 'needs_action' | 'in_progress' | 'other';

export interface WorkspaceThreadListItem {
  threadId: string;
  pendingId: string;
  displayId: string;
  questionSummary: string;
  statusLabel: string;
  updatedAt: string;
  group: WorkspaceThreadGroup;
  record: PendingAssociation;
}

export interface WorkspaceThreadTransientState {
  sending?: boolean;
  attaching?: boolean;
  returnFailed?: boolean;
  error?: string;
}

const GROUP_ORDER: WorkspaceThreadGroup[] = ['needs_action', 'in_progress', 'other'];

export const workspaceThreadGroupLabels: Record<WorkspaceThreadGroup, string> = {
  needs_action: '需要处理',
  in_progress: '进行中',
  other: '其他线程',
};

function summarize(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 52 ? `${normalized.slice(0, 52)}…` : normalized || '未命名追问';
}

export function deriveWorkspaceThreadListItem(record: PendingAssociation,
  transient: WorkspaceThreadTransientState = {}): WorkspaceThreadListItem {
  const rounds = threadRounds(record.localThread, record.pendingThread);
  const latest = rounds.at(-1);
  const latestQuestion = latest ? record.localThread.messages.find((message) => message.id === latest.questionMessageId) : undefined;
  const attachmentStatuses = rounds.map(roundAttachmentStatus);
  const persistenceStatuses = rounds.map((round) => round.persistenceStatus);
  let group: WorkspaceThreadGroup = 'other';
  let statusLabel = '已完成';

  if (transient.returnFailed) { group = 'needs_action'; statusLabel = '返回失败'; }
  else if (transient.error || record.localThread.status === 'failed' || record.pendingThread.status === 'failed') {
    group = 'needs_action'; statusLabel = persistenceStatuses.includes('capture_failed') ? '暂存失败' : '操作失败';
  } else if (transient.attaching) { group = 'needs_action'; statusLabel = '正在附加'; }
  else if (persistenceStatuses.includes('capture_failed')) { group = 'needs_action'; statusLabel = '暂存失败'; }
  else if (attachmentStatuses.includes('available') && rounds.some((round) =>
    round.status === 'answer_ready' || round.persistenceStatus === 'staged')) {
    group = 'needs_action'; statusLabel = '回答可附加';
  } else if (transient.sending || record.pendingThread.status === 'submitting' || record.localThread.status === 'submitting') {
    group = 'in_progress'; statusLabel = '正在发送';
  }
  else if (record.pendingThread.status === 'submission_unknown' || record.localThread.status === 'submission_unknown') {
    group = 'in_progress'; statusLabel = '正在确认发送';
  }
  else if (latest?.status === 'generating' || record.localThread.status === 'generating') {
    group = 'in_progress'; statusLabel = '回答生成中';
  } else if (latest?.status === 'waiting_for_answer' || record.localThread.status === 'waiting_for_answer') {
    group = 'in_progress'; statusLabel = '等待回答';
  } else if (['draft', 'prompt_ready', 'waiting_for_submission'].includes(record.localThread.status) ||
    ['prompt_ready', 'waiting_for_submission'].includes(record.pendingThread.status)) {
    group = 'in_progress'; statusLabel = '待发送';
  } else if (attachmentStatuses.includes('skipped_retained')) statusLabel = '有跳过内容';
  else if (attachmentStatuses.includes('skipped_expired')) statusLabel = '暂存已过期';
  else if (persistenceStatuses.includes('attached') || record.localThread.status === 'answer_attached') statusLabel = '已完成';

  return {
    threadId: record.localThread.id,
    pendingId: record.pendingThread.id,
    displayId: record.localThread.displayId,
    questionSummary: summarize(latestQuestion ? richPlainText(latestQuestion.content) : record.pendingThread.question),
    statusLabel,
    updatedAt: record.localThread.updatedAt,
    group,
    record,
  };
}

export function buildWorkspaceThreadList(records: PendingAssociation[], transientFor?:
  (record: PendingAssociation) => WorkspaceThreadTransientState): WorkspaceThreadListItem[] {
  return records.map((record) => deriveWorkspaceThreadListItem(record, transientFor?.(record)))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** A valid explicit selection always wins. Fallback happens only when it disappeared. */
export function selectWorkspaceThread(records: PendingAssociation[], selectedThreadId?: string | null,
  activeRecords?: PendingAssociation[]): PendingAssociation | undefined {
  const ordered = [...records].sort((a, b) => Date.parse(b.localThread.updatedAt) - Date.parse(a.localThread.updatedAt));
  const selected = ordered.find((record) => record.localThread.id === selectedThreadId);
  if (selected) return selected;
  const activeIds = new Set((activeRecords ?? ordered.filter((record) => isActiveWorkspaceThread(record))).map((record) => record.localThread.id));
  return ordered.find((record) => activeIds.has(record.localThread.id)) ?? ordered[0];
}
