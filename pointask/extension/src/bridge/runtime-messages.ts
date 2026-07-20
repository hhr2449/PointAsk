import type { PendingThread } from './pending-thread-manager';
import type { AnswerSourceLocator, LocalThread, RichContentBlock } from '../shared/local-thread';

export interface AttachedRoundPayload {
  roundId: string;
  richContent: RichContentBlock[];
  answerSource: AnswerSourceLocator;
}

export type AssociationStatus =
  | 'created'
  | 'target_opened'
  | 'awaiting_manual_association'
  | 'associated'
  | 'completed'
  | 'cancelled';

export interface PendingAssociation {
  pendingThread: PendingThread;
  localThread: LocalThread;
  sourceTabId: number;
  targetTabId?: number;
  targetConversationUrl?: string;
  associationStatus: AssociationStatus;
  createdAt: string;
  updatedAt: string;
}

export type PointAskRuntimeMessage =
  | { type: 'pointask:create-pending-thread'; pendingThread: PendingThread; localThread?: LocalThread }
  | { type: 'pointask:open-target-chat'; pendingThreadId: string }
  | { type: 'pointask:open-or-auto-send-workspace'; pendingThreadId: string; promptHash: string; attemptId: string }
  | { type: 'pointask:associate-target-page'; pendingThreadId: string; targetUrl: string; confirmReassociation?: boolean }
  | { type: 'pointask:pending-thread-updated'; pendingThreadId: string; action: 'manual-branch' | 'return-source' }
  | { type: 'pointask:cancel-pending-thread'; pendingThreadId: string }
  | { type: 'pointask:attach-answer'; pendingThreadId: string; selectedText?: string; richContent?: RichContentBlock[]; answerSource?: AnswerSourceLocator; targetUrl: string; replace: boolean }
  | { type: 'pointask:attach-rounds'; pendingThreadId: string; rounds: AttachedRoundPayload[]; skippedRoundIds?: string[]; targetUrl: string }
  | { type: 'pointask:stage-round-answer'; pendingThreadId: string; roundId: string; promptHash: string; targetUrl: string;
      captureFailed: boolean; richContent?: RichContentBlock[]; answerSource?: AnswerSourceLocator }
  | { type: 'pointask:open-answer-page'; pendingThreadId: string }
  | { type: 'pointask:update-local-thread'; pendingThread: PendingThread; localThread: LocalThread }
  | { type: 'pointask:unlink-target-page'; pendingThreadId: string }
  | { type: 'pointask:delete-thread-data'; threadId: string }
  | { type: 'pointask:get-page-pending-threads'; currentUrl: string }
  | { type: 'pointask:get-source-threads'; conversationKey: string }
  | { type: 'pointask:navigate-to-answer'; threadId: string; locator: AnswerSourceLocator }
  | { type: 'pointask:get-pending-navigation'; currentUrl: string }
  | { type: 'pointask:get-pending-thread-return'; currentUrl: string }
  | { type: 'pointask:complete-navigation'; navigationId: string }
  | { type: 'pointask:undo-attachment'; pendingThreadId: string }
  | { type: 'pointask:candidate-answer-state'; pendingThreadId: string; fingerprint: string; streaming: boolean }
  | { type: 'pointask:open-workspace-context-update'; workspaceId: string }
  | { type: 'pointask:reserve-prompt-submission'; pendingThreadId: string; promptHash: string; targetUrl: string }
  | { type: 'pointask:release-prompt-submission'; pendingThreadId: string; promptHash: string };

const messageTypes = new Set([
  'pointask:create-pending-thread',
  'pointask:open-target-chat',
  'pointask:open-or-auto-send-workspace',
  'pointask:associate-target-page',
  'pointask:pending-thread-updated',
  'pointask:cancel-pending-thread',
  'pointask:attach-answer',
  'pointask:attach-rounds',
  'pointask:stage-round-answer',
  'pointask:open-answer-page',
  'pointask:update-local-thread',
  'pointask:unlink-target-page',
  'pointask:delete-thread-data',
  'pointask:get-page-pending-threads',
  'pointask:get-source-threads',
  'pointask:navigate-to-answer',
  'pointask:get-pending-navigation',
  'pointask:get-pending-thread-return',
  'pointask:complete-navigation',
  'pointask:undo-attachment',
  'pointask:candidate-answer-state',
  'pointask:open-workspace-context-update',
  'pointask:reserve-prompt-submission',
  'pointask:release-prompt-submission',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isPendingThread(value: unknown): value is PendingThread {
  if (!isRecord(value) || !isRecord(value.anchor)) return false;
  const anchor = value.anchor;
  return hasOnlyKeys(value, [
    'id', 'sourcePageUrl', 'sourceConversationKey', 'sourceMessageFingerprint', 'anchor', 'question',
    'generatedPrompt', 'promptMode', 'status', 'createdAt', 'updatedAt', 'targetConversationUrl',
    'displayId', 'answerMode', 'workspaceId',
    'threadId', 'roundId', 'targetTabId', 'targetConversationKey', 'promptHash', 'assistantFingerprintsBefore',
    'candidateAnswerFingerprint', 'richSelection', 'viewAnchor', 'submittedPromptHash', 'submittedAt',
  ]) && hasOnlyKeys(anchor, [
    'pageUrl', 'sourcePageUrl', 'conversationKey', 'messageFingerprint', 'assistantMessageHash', 'selectedText',
    'prefixText', 'suffixText', 'paragraphText', 'paragraphHash', 'startOffset', 'endOffset', 'blockIndex',
    'nodePath', 'schemaVersion', 'createdAt',
  ]) &&
    ['id', 'sourcePageUrl', 'sourceConversationKey', 'sourceMessageFingerprint', 'question', 'generatedPrompt', 'createdAt', 'updatedAt', 'displayId', 'answerMode']
      .every((key) => isNonEmptyString(value[key])) &&
    ['pageUrl', 'selectedText', 'paragraphText', 'paragraphHash', 'messageFingerprint', 'assistantMessageHash', 'conversationKey', 'sourcePageUrl', 'createdAt']
      .every((key) => isNonEmptyString(anchor[key])) &&
    typeof anchor.startOffset === 'number' && typeof anchor.endOffset === 'number' &&
    typeof anchor.schemaVersion === 'number' &&
    (value.promptMode === 'compact' || value.promptMode === 'contextual') &&
    ['prompt_ready', 'waiting_for_submission', 'generating', 'answer_ready', 'waiting_for_answer', 'answer_attached', 'failed'].includes(String(value.status)) &&
    ['workspace', 'current_conversation', 'dedicated_branch'].includes(String(value.answerMode)) &&
    /^PA-\d{3,}$/.test(String(value.displayId)) &&
    (value.workspaceId === undefined || isNonEmptyString(value.workspaceId)) &&
    (value.threadId === undefined || isNonEmptyString(value.threadId)) &&
    (value.roundId === undefined || isNonEmptyString(value.roundId)) &&
    (value.targetTabId === undefined || typeof value.targetTabId === 'number') &&
    (value.targetConversationKey === undefined || isNonEmptyString(value.targetConversationKey) && isChatGptUrl(value.targetConversationKey)) &&
    (value.promptHash === undefined || typeof value.promptHash === 'string') &&
    (value.assistantFingerprintsBefore === undefined || Array.isArray(value.assistantFingerprintsBefore) && value.assistantFingerprintsBefore.every(isNonEmptyString)) &&
    (value.candidateAnswerFingerprint === undefined || isNonEmptyString(value.candidateAnswerFingerprint)) &&
    (value.submittedPromptHash === undefined || isNonEmptyString(value.submittedPromptHash)) &&
    (value.submittedAt === undefined || isNonEmptyString(value.submittedAt) && Number.isFinite(Date.parse(value.submittedAt))) &&
    (value.richSelection === undefined || isRichSelection(value.richSelection)) &&
    (value.viewAnchor === undefined || isViewAnchor(value.viewAnchor)) &&
    isChatGptUrl(value.sourcePageUrl as string) && isChatGptUrl(value.sourceConversationKey as string) &&
    isChatGptUrl(anchor.sourcePageUrl as string) && isChatGptUrl(anchor.conversationKey as string) &&
    value.sourcePageUrl === anchor.sourcePageUrl && value.sourceConversationKey === anchor.conversationKey &&
    value.sourceMessageFingerprint === anchor.messageFingerprint &&
    Number.isFinite(Date.parse(value.createdAt as string)) && Number.isFinite(Date.parse(value.updatedAt as string)) &&
    (value.targetConversationUrl === undefined ||
      (isNonEmptyString(value.targetConversationUrl) && isChatGptUrl(value.targetConversationUrl)));
}

export function isPointAskRuntimeMessage(value: unknown): value is PointAskRuntimeMessage {
  if (!isRecord(value) || !messageTypes.has(String(value.type))) return false;
  switch (value.type) {
    case 'pointask:create-pending-thread':
      return hasOnlyKeys(value, ['type', 'pendingThread', 'localThread']) && isPendingThread(value.pendingThread) &&
        (value.localThread === undefined || isLocalThread(value.localThread));
    case 'pointask:update-local-thread':
      return hasOnlyKeys(value, ['type', 'pendingThread', 'localThread']) &&
        isPendingThread(value.pendingThread) && isLocalThread(value.localThread) &&
        (value.pendingThread.threadId || value.pendingThread.id) === value.localThread.id;
    case 'pointask:open-target-chat':
    case 'pointask:cancel-pending-thread':
    case 'pointask:open-answer-page':
    case 'pointask:unlink-target-page':
      return hasOnlyKeys(value, ['type', 'pendingThreadId']) && isNonEmptyString(value.pendingThreadId);
    case 'pointask:open-or-auto-send-workspace':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'promptHash', 'attemptId']) &&
        isNonEmptyString(value.pendingThreadId) && isNonEmptyString(value.promptHash) && isNonEmptyString(value.attemptId);
    case 'pointask:open-workspace-context-update':
      return hasOnlyKeys(value, ['type', 'workspaceId']) && isNonEmptyString(value.workspaceId);
    case 'pointask:delete-thread-data':
      return hasOnlyKeys(value, ['type', 'threadId']) && isNonEmptyString(value.threadId);
    case 'pointask:reserve-prompt-submission':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'promptHash', 'targetUrl']) && isNonEmptyString(value.pendingThreadId) &&
        isNonEmptyString(value.promptHash) && isNonEmptyString(value.targetUrl) && isChatGptUrl(value.targetUrl);
    case 'pointask:release-prompt-submission':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'promptHash']) && isNonEmptyString(value.pendingThreadId) && isNonEmptyString(value.promptHash);
    case 'pointask:associate-target-page':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'targetUrl', 'confirmReassociation']) &&
        isNonEmptyString(value.pendingThreadId) && isNonEmptyString(value.targetUrl) && isChatGptUrl(value.targetUrl) &&
        (value.confirmReassociation === undefined || typeof value.confirmReassociation === 'boolean');
    case 'pointask:attach-answer':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'selectedText', 'richContent', 'answerSource', 'targetUrl', 'replace']) &&
        isNonEmptyString(value.pendingThreadId) &&
        ((isNonEmptyString(value.selectedText) && value.selectedText.length <= 8_000) || isRichContent(value.richContent)) &&
        (value.answerSource === undefined || isAnswerSource(value.answerSource)) &&
        isNonEmptyString(value.targetUrl) && isChatGptUrl(value.targetUrl) && typeof value.replace === 'boolean';
    case 'pointask:attach-rounds':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'rounds', 'skippedRoundIds', 'targetUrl']) && isNonEmptyString(value.pendingThreadId) &&
        isNonEmptyString(value.targetUrl) && isChatGptUrl(value.targetUrl) && Array.isArray(value.rounds) && value.rounds.length > 0 &&
        value.rounds.length <= 50 && value.rounds.every((raw) => isRecord(raw) && hasOnlyKeys(raw, ['roundId', 'richContent', 'answerSource']) &&
          isNonEmptyString(raw.roundId) && isRichContent(raw.richContent) && isAnswerSource(raw.answerSource)) &&
        (value.skippedRoundIds === undefined || Array.isArray(value.skippedRoundIds) && value.skippedRoundIds.length <= 50 &&
          value.skippedRoundIds.every(isNonEmptyString));
    case 'pointask:stage-round-answer':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'roundId', 'promptHash', 'targetUrl', 'captureFailed', 'richContent', 'answerSource']) &&
        [value.pendingThreadId, value.roundId, value.promptHash, value.targetUrl].every(isNonEmptyString) && isChatGptUrl(value.targetUrl as string) &&
        typeof value.captureFailed === 'boolean' && (value.captureFailed
          ? value.richContent === undefined && (value.answerSource === undefined || isAnswerSource(value.answerSource))
          : isRichContent(value.richContent) && isAnswerSource(value.answerSource));
    case 'pointask:pending-thread-updated':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'action']) && isNonEmptyString(value.pendingThreadId) &&
        (value.action === 'manual-branch' || value.action === 'return-source');
    case 'pointask:get-page-pending-threads':
      return hasOnlyKeys(value, ['type', 'currentUrl']) && isNonEmptyString(value.currentUrl) && isChatGptUrl(value.currentUrl);
    case 'pointask:get-source-threads':
      return hasOnlyKeys(value, ['type', 'conversationKey']) && isNonEmptyString(value.conversationKey) && isChatGptUrl(value.conversationKey);
    case 'pointask:navigate-to-answer':
      return hasOnlyKeys(value, ['type', 'threadId', 'locator']) && isNonEmptyString(value.threadId) && isAnswerSource(value.locator);
    case 'pointask:get-pending-navigation':
    case 'pointask:get-pending-thread-return':
      return hasOnlyKeys(value, ['type', 'currentUrl']) && isNonEmptyString(value.currentUrl) && isChatGptUrl(value.currentUrl);
    case 'pointask:complete-navigation':
      return hasOnlyKeys(value, ['type', 'navigationId']) && isNonEmptyString(value.navigationId);
    case 'pointask:undo-attachment':
      return hasOnlyKeys(value, ['type', 'pendingThreadId']) && isNonEmptyString(value.pendingThreadId);
    case 'pointask:candidate-answer-state':
      return hasOnlyKeys(value, ['type', 'pendingThreadId', 'fingerprint', 'streaming']) && isNonEmptyString(value.pendingThreadId) &&
        isNonEmptyString(value.fingerprint) && typeof value.streaming === 'boolean';
    default:
      return false;
  }
}

export function isRichContent(value: unknown): value is RichContentBlock[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return false;
  let contentLength = 0;
  const validate = (raw: unknown, depth = 0): boolean => {
    if (depth > 12) return false;
    if (!isRecord(raw)) return false;
    if (raw.type === 'line_break') { contentLength++; return contentLength <= 8_000 && hasOnlyKeys(raw, ['type']); }
    if (['text', 'inline_code', 'code', 'code_block'].includes(String(raw.type)) && typeof raw.content === 'string') {
      contentLength += raw.content.length;
      return contentLength <= 8_000 && hasOnlyKeys(raw, raw.type === 'code' || raw.type === 'code_block' ? ['type', 'content', 'language'] : ['type', 'content']) &&
        (raw.language === undefined || typeof raw.language === 'string');
    }
    if ((raw.type === 'inline_math' || raw.type === 'block_math') && typeof raw.latex === 'string') {
      contentLength += raw.latex.length; return contentLength <= 8_000 && hasOnlyKeys(raw, ['type', 'latex']);
    }
    if (['strong', 'emphasis', 'strikethrough', 'paragraph', 'blockquote', 'list_item', 'heading', 'table_cell'].includes(String(raw.type)) && Array.isArray(raw.children)) {
      const keys = raw.type === 'heading' ? ['type', 'level', 'children'] : raw.type === 'table_cell' ? ['type', 'children', 'header'] : ['type', 'children'];
      return hasOnlyKeys(raw, keys) && (raw.type !== 'heading' || typeof raw.level === 'number' && raw.level >= 1 && raw.level <= 6) &&
        (raw.type !== 'table_cell' || raw.header === undefined || typeof raw.header === 'boolean') &&
        raw.children.length <= 500 && raw.children.every((child) => validate(child, depth + 1));
    }
    if (raw.type === 'table' && Array.isArray(raw.rows)) return hasOnlyKeys(raw, ['type', 'rows']) && raw.rows.length <= 500 &&
      raw.rows.every((row) => isRecord(row) && row.type === 'table_row' && validate(row, depth + 1));
    if (raw.type === 'table_row' && Array.isArray(raw.cells)) return hasOnlyKeys(raw, ['type', 'cells']) && raw.cells.length <= 100 &&
      raw.cells.every((cell) => isRecord(cell) && cell.type === 'table_cell' && validate(cell, depth + 1));
    if ((raw.type === 'ordered_list' || raw.type === 'unordered_list') && Array.isArray(raw.items)) {
      return hasOnlyKeys(raw, raw.type === 'ordered_list' ? ['type', 'items', 'start'] : ['type', 'items']) &&
        (raw.start === undefined || typeof raw.start === 'number') && raw.items.length <= 500 &&
        raw.items.every((item) => isRecord(item) && item.type === 'list_item' && validate(item, depth + 1));
    }
    return false;
  };
  return value.every((raw) => validate(raw));
}

function isAnswerSource(value: unknown): value is AnswerSourceLocator {
  return isRecord(value) && hasOnlyKeys(value, ['conversationUrl', 'conversationKey', 'messageFingerprint', 'selectedText', 'prefixText', 'suffixText']) &&
    isNonEmptyString(value.conversationUrl) && isChatGptUrl(value.conversationUrl) && isNonEmptyString(value.conversationKey) &&
    isChatGptUrl(value.conversationKey) && isNonEmptyString(value.messageFingerprint) &&
    ['selectedText', 'prefixText', 'suffixText'].every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function isRichSelection(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ['plainText', 'blocks']) && typeof value.plainText === 'string' &&
    value.plainText.length <= 8_000 && isRichContent(value.blocks);
}

function isViewAnchor(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ['sourceMessageFingerprint', 'blockFingerprint', 'viewportOffsetTop', 'scrollY', 'capturedAt']) &&
    isNonEmptyString(value.sourceMessageFingerprint) && isNonEmptyString(value.blockFingerprint) &&
    typeof value.viewportOffsetTop === 'number' && Number.isFinite(value.viewportOffsetTop) &&
    typeof value.scrollY === 'number' && Number.isFinite(value.scrollY) && isNonEmptyString(value.capturedAt) &&
    Number.isFinite(Date.parse(value.capturedAt));
}

export function isChatGptUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  } catch {
    return false;
  }
}

/**
 * Matches the same visible ChatGPT target while allowing the normal SPA
 * transition from a newly opened `/` page to its first `/c/...` URL.
 */
export function isCompatibleChatGptTargetUrl(storedValue: string, currentValue: string): boolean {
  if (!isChatGptUrl(storedValue) || !isChatGptUrl(currentValue)) return false;
  const stored = new URL(storedValue);
  const current = new URL(currentValue);
  const normalizePath = (pathname: string) => pathname.replace(/\/+$/, '') || '/';
  const storedPath = normalizePath(stored.pathname);
  const currentPath = normalizePath(current.pathname);
  return storedPath === currentPath || (storedPath === '/' && /^\/c\/[^/]+$/.test(currentPath));
}

export function isPendingAssociationUpdate(value: unknown): value is {
  type: 'pointask:pending-thread-updated';
  record: PendingAssociation;
} {
  if (!isRecord(value) || value.type !== 'pointask:pending-thread-updated' || !hasOnlyKeys(value, ['type', 'record'])) return false;
  const record = value.record;
  if (!isRecord(record) || !isPendingThread(record.pendingThread) || !isLocalThread(record.localThread) ||
    (record.pendingThread.threadId || record.pendingThread.id) !== record.localThread.id) return false;
  return hasOnlyKeys(record, [
    'pendingThread', 'localThread', 'sourceTabId', 'targetTabId', 'targetConversationUrl', 'associationStatus', 'createdAt', 'updatedAt',
  ]) && typeof record.sourceTabId === 'number' &&
    (record.targetTabId === undefined || typeof record.targetTabId === 'number') &&
    (record.targetConversationUrl === undefined || (isNonEmptyString(record.targetConversationUrl) && isChatGptUrl(record.targetConversationUrl))) &&
    ['created', 'target_opened', 'awaiting_manual_association', 'associated', 'completed', 'cancelled'].includes(String(record.associationStatus)) &&
    isNonEmptyString(record.createdAt) && isNonEmptyString(record.updatedAt);
}

export function isLocalThread(value: unknown): value is LocalThread {
  if (!isRecord(value) || !isRecord(value.anchor) || !Array.isArray(value.messages)) return false;
  const anchor = value.anchor;
  if (!hasOnlyKeys(value, [
    'id', 'anchor', 'sourcePageUrl', 'sourceConversationKey', 'sourceMessageFingerprint', 'targetConversationUrl',
    'messages', 'status', 'createdAt', 'updatedAt', 'expanded', 'collapsedRoundIds', 'displayId', 'answerMode', 'workspaceId',
    'dedicatedConversationUrl', 'richSelection', 'rounds',
  ])) return false;
  if (!['id', 'sourcePageUrl', 'sourceConversationKey', 'sourceMessageFingerprint', 'createdAt', 'updatedAt', 'displayId', 'answerMode']
    .every((key) => isNonEmptyString(value[key]))) return false;
  if (!hasOnlyKeys(anchor, [
    'pageUrl', 'sourcePageUrl', 'conversationKey', 'messageFingerprint', 'assistantMessageHash', 'selectedText',
    'prefixText', 'suffixText', 'paragraphText', 'paragraphHash', 'startOffset', 'endOffset', 'blockIndex',
    'nodePath', 'schemaVersion', 'createdAt',
  ]) ||
    !['pageUrl', 'selectedText', 'paragraphText', 'paragraphHash', 'messageFingerprint', 'assistantMessageHash', 'conversationKey', 'sourcePageUrl', 'createdAt']
      .every((key) => isNonEmptyString(anchor[key]))) return false;
  if (typeof anchor.startOffset !== 'number' || typeof anchor.endOffset !== 'number' || typeof anchor.schemaVersion !== 'number') return false;
  if (!['draft', 'prompt_ready', 'waiting_for_submission', 'waiting_for_answer', 'generating', 'answer_ready', 'answer_attached', 'failed', 'orphaned'].includes(String(value.status))) return false;
  if (!['workspace', 'current_conversation', 'dedicated_branch'].includes(String(value.answerMode))) return false;
  if (!/^PA-\d{3,}$/.test(String(value.displayId)) || (value.workspaceId !== undefined && !isNonEmptyString(value.workspaceId))) return false;
  if (value.expanded !== undefined && typeof value.expanded !== 'boolean') return false;
  if (value.collapsedRoundIds !== undefined && (!Array.isArray(value.collapsedRoundIds) || !value.collapsedRoundIds.every(isNonEmptyString))) return false;
  if (value.rounds !== undefined && (!Array.isArray(value.rounds) || !value.rounds.every((raw) => {
    if (!isRecord(raw) || !hasOnlyKeys(raw, ['id', 'questionMessageId', 'answerMessageId', 'pendingId', 'promptHash', 'assistantFingerprintsBefore', 'candidateAnswerFingerprint',
      'status', 'persistenceStatus', 'attachmentStatus', 'stagedAnswer', 'skippedAt', 'expiresAt', 'capturedAt', 'attachedAt', 'answerSource', 'createdAt', 'updatedAt'])) return false;
    return ['id', 'pendingId', 'promptHash', 'createdAt', 'updatedAt'].every((key) => isNonEmptyString(raw[key])) &&
      (raw.questionMessageId === undefined || isNonEmptyString(raw.questionMessageId)) &&
      (raw.answerMessageId === undefined || isNonEmptyString(raw.answerMessageId)) &&
      Array.isArray(raw.assistantFingerprintsBefore) && raw.assistantFingerprintsBefore.every(isNonEmptyString) &&
      ['waiting_for_submission', 'waiting_for_answer', 'generating', 'answer_ready', 'failed', 'attached'].includes(String(raw.status)) &&
      ['not_captured', 'staged', 'attaching', 'attached', 'capture_failed'].includes(String(raw.persistenceStatus)) &&
      (raw.attachmentStatus === undefined || ['available', 'skipped_retained', 'skipped_expired', 'attached'].includes(String(raw.attachmentStatus))) &&
      (raw.stagedAnswer === undefined || isRichContent(raw.stagedAnswer)) &&
      (raw.skippedAt === undefined || typeof raw.skippedAt === 'number' && Number.isFinite(raw.skippedAt)) &&
      (raw.expiresAt === undefined || typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)) &&
      (raw.capturedAt === undefined || isNonEmptyString(raw.capturedAt) && Number.isFinite(Date.parse(raw.capturedAt))) &&
      (raw.candidateAnswerFingerprint === undefined || isNonEmptyString(raw.candidateAnswerFingerprint)) &&
      (raw.attachedAt === undefined || isNonEmptyString(raw.attachedAt) && Number.isFinite(Date.parse(raw.attachedAt))) &&
      (raw.answerSource === undefined || isAnswerSource(raw.answerSource)) &&
      Number.isFinite(Date.parse(String(raw.createdAt))) && Number.isFinite(Date.parse(String(raw.updatedAt))) &&
      (raw.persistenceStatus !== 'staged' || isRichContent(raw.stagedAnswer) && isAnswerSource(raw.answerSource)) &&
      (raw.persistenceStatus === 'staged' || raw.stagedAnswer === undefined);
  }))) return false;
  if (!isChatGptUrl(value.sourcePageUrl as string) || !isChatGptUrl(value.sourceConversationKey as string)) return false;
  if (!isChatGptUrl(anchor.sourcePageUrl as string) || !isChatGptUrl(anchor.conversationKey as string) ||
    value.sourcePageUrl !== anchor.sourcePageUrl || value.sourceConversationKey !== anchor.conversationKey ||
    value.sourceMessageFingerprint !== anchor.messageFingerprint) return false;
  if (value.targetConversationUrl !== undefined &&
    (!isNonEmptyString(value.targetConversationUrl) || !isChatGptUrl(value.targetConversationUrl))) return false;
  if (value.dedicatedConversationUrl !== undefined &&
    (!isNonEmptyString(value.dedicatedConversationUrl) || !isChatGptUrl(value.dedicatedConversationUrl))) return false;
  if (value.richSelection !== undefined && !isRichSelection(value.richSelection)) return false;
  if (!Number.isFinite(Date.parse(value.createdAt as string)) || !Number.isFinite(Date.parse(value.updatedAt as string))) return false;
  const answeredRoundIds = new Set<string>();
  let latestUserId: string | null = null;
  for (const message of value.messages) {
    if (!isRecord(message) || !hasOnlyKeys(message, ['id', 'role', 'content', 'answerSource', 'roundId', 'attachedAt', 'attachedManually', 'createdAt'])) return false;
    if (!isNonEmptyString(message.id) || !isRichContent(message.content) || !['user', 'assistant'].includes(String(message.role)) ||
      typeof message.attachedManually !== 'boolean' || !isNonEmptyString(message.createdAt) ||
      !Number.isFinite(Date.parse(message.createdAt))) return false;
    if (message.answerSource !== undefined && !isAnswerSource(message.answerSource)) return false;
    if (message.roundId !== undefined && !isNonEmptyString(message.roundId)) return false;
    if (message.attachedAt !== undefined && (!isNonEmptyString(message.attachedAt) || !Number.isFinite(Date.parse(message.attachedAt)))) return false;
    if ((message.role === 'assistant') !== message.attachedManually) return false;
    if (message.role === 'user') latestUserId = message.id as string;
    else {
      const roundId = typeof message.roundId === 'string' ? message.roundId : latestUserId;
      if (!roundId || answeredRoundIds.has(roundId)) return false;
      answeredRoundIds.add(roundId);
    }
  }
  if (value.rounds) {
    const roundIds = new Set<string>();
    for (const raw of value.rounds) {
      const round = raw as Record<string, unknown>;
      const roundId = round.id as string;
      if (roundIds.has(roundId)) return false;
      roundIds.add(roundId);
      if (typeof round.questionMessageId === 'string') {
        const question = value.messages.find((message) => message.id === round.questionMessageId);
        if (!question || question.role !== 'user' || question.roundId !== undefined && question.roundId !== roundId) return false;
      }
      if (typeof round.answerMessageId === 'string') {
        const answer = value.messages.find((message) => message.id === round.answerMessageId);
        if (!answer || answer.role !== 'assistant' || answer.roundId !== roundId) return false;
      }
    }
  }
  return value.messages.length > 0;
}
