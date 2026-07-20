export type AnswerMode = 'workspace' | 'current_conversation' | 'dedicated_branch';
export type ThreadStatus = 'draft' | 'prompt_ready' | 'waiting_for_submission' | 'waiting_for_answer' | 'generating' | 'answer_ready' | 'answer_attached' | 'failed' | 'orphaned';
export type CurrentConversationScrollBehavior = 'stay_at_source' | 'follow_response';

export type RichContentBlock =
  | { type: 'text'; content: string }
  | { type: 'strong'; children: RichContentBlock[] }
  | { type: 'emphasis'; children: RichContentBlock[] }
  | { type: 'strikethrough'; children: RichContentBlock[] }
  | { type: 'paragraph'; children: RichContentBlock[] }
  | { type: 'blockquote'; children: RichContentBlock[] }
  | { type: 'ordered_list'; items: RichContentBlock[]; start?: number }
  | { type: 'unordered_list'; items: RichContentBlock[] }
  | { type: 'list_item'; children: RichContentBlock[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: RichContentBlock[] }
  | { type: 'table'; rows: RichContentBlock[] }
  | { type: 'table_row'; cells: RichContentBlock[] }
  | { type: 'table_cell'; children: RichContentBlock[]; header?: boolean }
  | { type: 'inline_code'; content: string }
  | { type: 'code_block'; content: string; language?: string }
  /** Legacy storage shape; normalized to code_block before rendering. */
  | { type: 'inline_math'; latex: string }
  | { type: 'block_math'; latex: string }
  | { type: 'code'; content: string; language?: string }
  | { type: 'line_break' };

export interface RichSelection {
  plainText: string;
  blocks: RichContentBlock[];
}

export interface ViewAnchor {
  sourceMessageFingerprint: string;
  blockFingerprint: string;
  viewportOffsetTop: number;
  scrollY: number;
  capturedAt: string;
}

export interface AnswerSourceLocator {
  conversationUrl: string;
  conversationKey: string;
  messageFingerprint: string;
  selectedText?: string;
  prefixText?: string;
  suffixText?: string;
}

export interface PointAskWorkspace {
  id: string;
  sourceConversationKey: string;
  sourceConversationUrl: string;
  targetConversationUrl?: string;
  targetConversationKey?: string;
  workspaceType: 'branch' | 'new_conversation';
  threadCount: number;
  approximateContentLength: number;
  contextState: WorkspaceContextState;
  pendingContextUpdate?: PendingWorkspaceContextUpdate;
  /** Local-only presentation preference for the Workspace control card. */
  controlCardState?: WorkspaceControlCardState;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceControlCardState {
  collapsed: boolean;
  /** The thread id is a recovery hint and must be revalidated against active threads. */
  activeThreadId?: string;
  hasAutoExpanded: boolean;
  updatedAt: string;
}

export interface WorkspaceContextState {
  contextVersion: number;
  lastSyncedMessageFingerprint?: string;
  syncedAt?: string;
  unsyncedMessageCount: number;
  unsyncedTurnCount: number;
  status: 'fresh' | 'outdated' | 'unknown' | 'diverged';
}

export interface WorkspaceContextMessage {
  fingerprint: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface PendingWorkspaceContextUpdate {
  id: string;
  workspaceId: string;
  label: string;
  prompt: string;
  messageFingerprints: string[];
  lastMessageFingerprint: string;
  status: 'waiting_for_fill' | 'filled';
  createdAt: string;
  updatedAt: string;
}

export interface TextAnchor {
  pageUrl: string;
  selectedText: string;
  prefixText: string;
  suffixText: string;
  paragraphText: string;
  paragraphHash: string;
  messageFingerprint: string;
  assistantMessageHash: string;
  conversationKey: string;
  sourcePageUrl: string;
  startOffset: number;
  endOffset: number;
  blockIndex?: number;
  nodePath?: number[];
  schemaVersion: number;
  createdAt: string;
}

export interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: RichContentBlock[];
  answerSource?: AnswerSourceLocator;
  roundId?: string;
  attachedAt?: string;
  attachedManually: boolean;
  createdAt: string;
}

export type RoundPersistenceStatus = 'not_captured' | 'staged' | 'attaching' | 'attached' | 'capture_failed';
export type RoundAttachmentStatus = 'available' | 'skipped_retained' | 'skipped_expired' | 'attached';

export interface LocalThreadRound {
  /** Stable round identity. Never reuse a pending or message id here. */
  id: string;
  /** Local user message that owns this round. */
  questionMessageId?: string;
  /** Local assistant message created after attachment. */
  answerMessageId?: string;
  pendingId: string;
  promptHash: string;
  assistantFingerprintsBefore: string[];
  candidateAnswerFingerprint?: string;
  status: 'waiting_for_submission' | 'waiting_for_answer' | 'generating' | 'answer_ready' | 'failed' | 'attached';
  persistenceStatus: RoundPersistenceStatus;
  attachmentStatus?: RoundAttachmentStatus;
  stagedAnswer?: RichContentBlock[];
  skippedAt?: number;
  expiresAt?: number;
  capturedAt?: string;
  attachedAt?: string;
  answerSource?: AnswerSourceLocator;
  createdAt: string;
  updatedAt: string;
}

export interface LocalThread {
  id: string;
  displayId: string;
  answerMode: AnswerMode;
  workspaceId?: string;
  dedicatedConversationUrl?: string;
  richSelection?: RichSelection;
  anchor: TextAnchor;
  sourcePageUrl: string;
  sourceConversationKey: string;
  sourceMessageFingerprint: string;
  targetConversationUrl?: string;
  messages: LocalMessage[];
  rounds?: LocalThreadRound[];
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  expanded?: boolean;
  collapsedRoundIds?: string[];
}
