import { createRoot, type Root } from 'react-dom/client';
import type { ClipboardManager } from '../bridge/clipboard-manager';
import { isRichContent, type AttachedRoundPayload, type PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { PendingThreadBanner } from '../components/pending-thread-banner';
import { WorkspaceControlCard, type ContinueWorkspaceResult } from '../components/workspace-control-card';
import { deriveWorkspaceControlState } from '../components/workspace-control-state';
import { CurrentAnswerActions } from '../components/current-answer-actions';
import { bannerStyles, currentAnswerActionStyles, workspaceControlStyles } from './shadow-styles';
import { isCompatibleChatGptTargetUrl } from '../bridge/runtime-messages';
import type { SiteAdapter } from '../adapters/site-adapter';
import type { CandidateAnswer } from '../adapters/site-adapter';
import { richPlainText } from '../shared/rich-content';
import { richContentStyles } from '../components/rich-content-renderer';
import { ViewAnchorController } from './view-anchor-controller';
import type { OperationAuthorizer } from './operation-authorizer';
import { showAttachmentUndo, showOperationToast } from './operation-feedback';
import { applyPointAskTheme } from './theme';
import type { SelectionData } from './selection-manager';
import { buildPrompt } from '../bridge/prompt-builder';
import { stableTextHash } from '../shared/text-utils';
import { textBlocks } from '../shared/rich-content';
import { roundIdForPending, threadRounds } from '../shared/thread-rounds';
import type { SelectableRound } from '../components/round-selection-view';
import { WorkspaceControlEntry } from '../components/workspace-control-entry';
import { deriveWorkspaceControlVisibility, isActiveWorkspaceThread } from '../components/workspace-control-visibility';
import type { PointAskWorkspace } from '../shared/local-thread';
import type { WorkspaceStore } from '../storage/workspace-store';
import type { ThreadStore } from '../storage/thread-store';
import { roundAttachmentStatus } from '../shared/staged-answer-retention';
import { buildWorkspaceThreadList, selectWorkspaceThread } from '../components/workspace-thread-list';
import { derivePointAskPageRole, isSameConversationUrl, type PointAskPageRole } from './page-role';
import { logPointAskLifecycle } from '../shared/lifecycle-log';

interface MountedAnswerAction {
  host: HTMLElement;
  root: Root;
  fingerprint: string;
  element: HTMLElement;
}

interface ResolvedWorkspaceRound extends SelectableRound {
  candidate?: CandidateAnswer;
  candidateReliable: boolean;
  stagedAnswer?: AttachedRoundPayload['richContent'];
  answerLocator?: AttachedRoundPayload['answerSource'];
  knownAnswerFingerprint?: string;
  status: 'waiting_for_submission' | 'submitting' | 'submission_unknown' | 'waiting_for_answer' | 'generating' | 'answer_ready' | 'failed' | 'attached';
  persistenceStatus: 'not_captured' | 'staged' | 'attaching' | 'attached' | 'capture_failed';
  attachmentStatus: 'available' | 'skipped_retained' | 'skipped_expired' | 'attached';
}

type WorkspaceAttachPhase = 'validate' | 'extract' | 'persist' | 'navigate';
interface RejectedWorkspaceRound { roundId: string; reason: string; }
type WorkspaceStagingTrigger = 'continue' | 'attach_all' | 'attach_selected';
type EnsureRoundStagedCode = 'staged' | 'already_staged' | 'already_attached' | 'answer_still_streaming' |
  'answer_not_complete' | 'answer_not_loaded' | 'answer_ambiguous' | 'locator_stale' | 'extraction_failed' |
  'capture_failed' | 'persist_failed' | 'storage_failed';
interface EnsureRoundStagedResult { ok: boolean; code: EnsureRoundStagedCode; record?: PendingAssociation; error?: string; }

function logWorkspaceAttach(details: { threadId: string; selectedRoundIds: string[]; validRoundIds: string[];
  rejectedRounds: RejectedWorkspaceRound[]; phase: WorkspaceAttachPhase; error?: unknown }): void {
  if (!import.meta.env.DEV) return;
  const error = details.error instanceof Error ? details.error.message : details.error ? String(details.error) : undefined;
  console.debug(`[PointAsk attach]\nthreadId=${details.threadId}\nselectedRoundIds=${JSON.stringify(details.selectedRoundIds)}` +
    `\nvalidRoundIds=${JSON.stringify(details.validRoundIds)}\nrejectedRounds=${JSON.stringify(details.rejectedRounds)}` +
    `\nphase=${details.phase}\nerror=${error ?? ''}`);
}

function logWorkspaceStaging(details: { threadId: string; roundId: string; activeRoundId?: string; trigger: WorkspaceStagingTrigger;
  beforeStatus?: string; afterStatus?: string; phase: 'resolve' | 'extract' | 'persist' | 'attach'; error?: unknown }): void {
  if (!import.meta.env.DEV) return;
  const error = details.error instanceof Error ? details.error.message : details.error ? String(details.error) : undefined;
  console.debug(`[PointAsk staging]\nthreadId=${details.threadId}\nroundId=${details.roundId}\nactiveRoundId=${details.activeRoundId ?? ''}` +
    `\ntrigger=${details.trigger}\nbeforeStatus=${details.beforeStatus ?? ''}\nafterStatus=${details.afterStatus ?? ''}` +
    `\nphase=${details.phase}\nerror=${error ?? ''}`);
}

function logWorkspaceRound(details: { threadId: string; roundId: string; activeRoundId?: string; pendingId?: string;
  trigger: 'answer_recognized' | 'continue' | 'attach_all' | 'attach_selected'; beforeStatus?: string; afterStatus?: string;
  phase: 'create_round' | 'recognize_answer' | 'stage' | 'attach'; selectedRoundIds?: string[]; error?: unknown }): void {
  if (!import.meta.env.DEV) return;
  const error = details.error instanceof Error ? details.error.message : details.error ? String(details.error) : undefined;
  console.debug(`[PointAsk round]\nthreadId=${details.threadId}\nroundId=${details.roundId}` +
    `\nactiveRoundId=${details.activeRoundId ?? ''}\npendingId=${details.pendingId ?? ''}\ntrigger=${details.trigger}` +
    `\nbeforeStatus=${details.beforeStatus ?? ''}\nafterStatus=${details.afterStatus ?? ''}\nphase=${details.phase}` +
    `\nselectedRoundIds=${JSON.stringify(details.selectedRoundIds ?? [])}\nerror=${error ?? ''}`);
}

export class PendingBannerManager {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  private records = new Map<string, PendingAssociation>();
  private readonly closedIds = new Set<string>();
  private readonly copiedIds = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly confirmingIds = new Set<string>();
  private cleanupRuntime: (() => void) | null = null;
  private cleanupExecuteSend: (() => void) | null = null;
  private cleanupReadyProbe: (() => void) | null = null;
  private cleanupWorkspaceStore: (() => void) | null = null;
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  private currentUrl = window.location.href;
  private readonly candidates = new Map<string, CandidateAnswer>();
  private readonly candidateStates = new Map<string, string>();
  private cleanupCandidateObserver: (() => void) | null = null;
  private readonly sendingIds = new Set<string>();
  private readonly reliableCandidateIds = new Set<string>();
  private readonly answerActions = new Map<string, MountedAnswerAction>();
  private readonly attachingIds = new Set<string>();
  private readonly returnedIds = new Set<string>();
  private partialSelectionId: string | null = null;
  private returnToThreadHandler: ((id: string) => boolean) | null = null;
  private selectedWorkspaceThreadId: string | null = null;
  private workspaceExpanded = true;
  private workspacePage: PointAskWorkspace | null = null;
  private workspacePageKnown = false;
  private loadedWorkspacePreferenceId: string | null = null;
  private idleExpandedByUser = false;
  private previousActiveWorkspaceCount = 0;
  private workspaceSelection: SelectionData | null = null;
  private readonly returnFailedIds = new Set<string>();
  private readonly stagingPromises = new Map<string, Promise<EnsureRoundStagedResult>>();
  private readonly submissionUnknownIds = new Set<string>();
  private readonly submissionReconciliationPromises = new Map<string, Promise<void>>();
  private pageRole: PointAskPageRole = 'unrelated';

  constructor(
    private readonly bridge: WebConversationBridge,
    private readonly clipboard: ClipboardManager,
    private readonly adapter?: SiteAdapter,
    private readonly authorizer?: OperationAuthorizer,
    private readonly workspaceStore?: WorkspaceStore,
    private readonly threadStore?: ThreadStore,
  ) {
  }

  private ensureHost(): { host: HTMLElement; root: Root } {
    if (this.host && this.root) return { host: this.host, root: this.root };
    const host = document.createElement('pointask-pending-thread-banner'); host.dataset.pointaskOwned = 'true'; applyPointAskTheme(host);
    const shadow = host.attachShadow({ mode: 'open' }); const style = document.createElement('style');
    style.textContent = `${bannerStyles}\n${workspaceControlStyles}\n${richContentStyles}`;
    const mount = document.createElement('div'); shadow.append(style, mount); document.documentElement.append(host);
    this.host = host; this.root = createRoot(mount); return { host, root: this.root };
  }

  private unmountHost(): void {
    this.root?.unmount(); this.host?.remove(); this.root = null; this.host = null;
  }

  async start(): Promise<void> {
    this.cleanupReadyProbe = this.bridge.onTargetReadyProbe((targetConversationUrl) => {
      const conversationUrl = window.location.href;
      const urlMatches = isCompatibleChatGptTargetUrl(targetConversationUrl, conversationUrl);
      const composerReady = Boolean(urlMatches && this.adapter?.isComposerReady());
      return { ready: composerReady, conversationUrl, composerReady };
    });
    const records = await this.bridge.getPagePendingThreads();
    this.records.clear();
    for (const record of records.sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0))) this.acceptRecord(record);
    await this.cleanupExpiredStagedAnswers();
    await this.refreshWorkspacePage();
    this.render();
    this.cleanupWorkspaceStore = this.workspaceStore?.subscribe(() => { void this.refreshWorkspacePage(true).then(() => this.render()); }) ?? null;
    this.cleanupRuntime = this.bridge.onPendingUpdated((record) => {
      if (record.associationStatus === 'cancelled' || record.associationStatus === 'created' || record.associationStatus === 'completed' ||
        (record.localThread.answerMode === 'current_conversation' && record.localThread.status === 'answer_attached')) {
        this.records.delete(record.pendingThread.id); this.clearCurrentUi(record.pendingThread.id);
      }
      else if (this.records.has(record.pendingThread.id) || record.associationStatus === 'awaiting_manual_association' ||
        Boolean(record.targetConversationUrl && isCompatibleChatGptTargetUrl(record.targetConversationUrl, window.location.href))) {
        this.acceptRecord(record);
        if (!record.pendingThread.candidateAnswerFingerprint) this.returnedIds.delete(record.pendingThread.id);
      }
      this.refreshCandidates();
      this.render();
    });
    this.cleanupExecuteSend = this.bridge.onExecutePendingSend(async (record, _attemptId, promptHash) => {
      if (record.localThread.answerMode !== 'workspace' || record.pendingThread.promptHash !== promptHash) {
        return { ok: false, error: '目标页面与共享追问线程不匹配' };
      }
      this.applyRecord(record);
      const ok = await this.fill(record.pendingThread.id, true);
      return { ok, submissionUnknown: this.submissionUnknownIds.has(record.pendingThread.id),
        error: ok ? undefined : this.errors.get(record.pendingThread.id) };
    });
    this.refreshCandidates();
    this.cleanupCandidateObserver = this.adapter?.observePageChanges(() => this.refreshCandidates()) ?? null;
    window.addEventListener('popstate', this.checkUrl);
    window.addEventListener('hashchange', this.checkUrl);
    this.urlTimer = setInterval(this.checkUrl, 500);
  }

  getAttachmentAssociations(): PendingAssociation[] {
    const records = [...this.records.values()].filter((record) =>
      record.associationStatus !== 'awaiting_manual_association' && record.associationStatus !== 'cancelled' &&
      record.associationStatus !== 'completed' && this.recordMatchesPageRole(record),
    );
    return this.partialSelectionId
      ? records.filter((record) => record.pendingThread.id === this.partialSelectionId)
      : records.filter((record) => record.localThread.answerMode !== 'current_conversation');
  }

  private recordMatchesPageRole(record: PendingAssociation): boolean {
    if (record.localThread.answerMode === 'workspace') return this.pageRole === 'workspace_target' &&
      isSameConversationUrl(record.targetConversationUrl ?? record.localThread.targetConversationUrl, window.location.href);
    if (record.localThread.answerMode === 'dedicated_branch') return this.pageRole === 'dedicated_target' &&
      isSameConversationUrl(record.targetConversationUrl ?? record.localThread.dedicatedConversationUrl, window.location.href);
    return this.pageRole === 'current_conversation_target' &&
      (isSameConversationUrl(record.localThread.sourceConversationKey, window.location.href) ||
        isSameConversationUrl(record.targetConversationUrl ?? record.localThread.targetConversationUrl, window.location.href));
  }

  setSelection(data: SelectionData | null): void {
    this.workspaceSelection = data && [...this.candidates.values()].some((candidate) =>
      candidate.fingerprint === data.messageFingerprint && candidate.element === data.sourceMessageElement) ? data : null;
    this.render();
  }

  setReturnToThreadHandler(handler: (id: string) => boolean): void {
    this.returnToThreadHandler = handler;
  }

  applyRecord(record: PendingAssociation): void {
    if (record.localThread.answerMode === 'current_conversation' && record.localThread.status === 'answer_attached') {
      this.records.delete(record.pendingThread.id);
      this.clearCurrentUi(record.pendingThread.id);
      this.render();
      return;
    }
    if (!this.acceptRecord(record)) return;
    this.pageRole = derivePointAskPageRole(window.location.href, this.workspacePage ? [this.workspacePage] : [], [...this.records.values()]);
    if (!record.pendingThread.candidateAnswerFingerprint) this.returnedIds.delete(record.pendingThread.id);
    this.refreshCandidates();
    this.render();
  }

  private acceptRecord(record: PendingAssociation): boolean {
    const threadId = record.localThread.id;
    if ((record.pendingThread.threadId || record.pendingThread.id) !== threadId) return false;
    const addressedRound = record.pendingThread.roundId
      ? threadRounds(record.localThread, record.pendingThread).find((round) => round.id === record.pendingThread.roundId) : undefined;
    if (record.localThread.answerMode === 'workspace' && record.pendingThread.roundId &&
      (!addressedRound || addressedRound.pendingId !== record.pendingThread.id ||
      Boolean(record.pendingThread.promptHash) && addressedRound.promptHash !== record.pendingThread.promptHash)) return false;
    const revisionOf = (item: PendingAssociation) => Math.max(item.revision ?? 0, item.localThread.revision ?? 0,
      item.pendingThread.revision ?? 0);
    const existing = [...this.records.values()].filter((item) => item.localThread.id === threadId)
      .sort((a, b) => revisionOf(b) - revisionOf(a))[0];
    const incomingRevision = revisionOf(record);
    const existingRevision = existing ? revisionOf(existing) : 0;
    if (existing && incomingRevision < existingRevision) {
      logPointAskLifecycle({ threadId, roundId: record.pendingThread.roundId, pendingId: record.pendingThread.id,
        operationId: record.pendingThread.operationId, revision: incomingRevision, event: 'stale_result_discarded',
        beforeStatus: existing.localThread.status, afterStatus: record.localThread.status,
        activeRoundId: existing.pendingThread.roundId, errorCode: 'stale_revision' });
      return false;
    }
    for (const [pendingId, item] of this.records) if (item.localThread.id === threadId && pendingId !== record.pendingThread.id) {
      this.records.delete(pendingId); this.clearCurrentUi(pendingId); this.errors.delete(pendingId);
    }
    const normalizedRecord = incomingRevision === record.revision && incomingRevision === record.localThread.revision &&
      incomingRevision === record.pendingThread.revision ? record : {
        ...record, revision: incomingRevision, localThread: { ...record.localThread, revision: incomingRevision },
        pendingThread: { ...record.pendingThread, revision: incomingRevision },
      };
    this.records.set(record.pendingThread.id, normalizedRecord);
    if (['submission_unknown', 'waiting_for_answer', 'generating', 'answer_ready', 'answer_attached'].includes(record.localThread.status) ||
      threadRounds(record.localThread, record.pendingThread).some((round) => ['staged', 'attached'].includes(round.persistenceStatus))) {
      this.errors.delete(record.pendingThread.id);
    }
    return true;
  }

  stop(): void {
    this.cleanupRuntime?.();
    this.cleanupRuntime = null;
    this.cleanupExecuteSend?.(); this.cleanupExecuteSend = null;
    this.cleanupReadyProbe?.(); this.cleanupReadyProbe = null;
    this.cleanupWorkspaceStore?.(); this.cleanupWorkspaceStore = null;
    this.cleanupCandidateObserver?.();
    this.cleanupCandidateObserver = null;
    window.removeEventListener('popstate', this.checkUrl);
    window.removeEventListener('hashchange', this.checkUrl);
    if (this.urlTimer) clearInterval(this.urlTimer);
    this.urlTimer = null;
    for (const id of [...this.answerActions.keys()]) this.removeAnswerAction(id);
    this.unmountHost();
  }

  private readonly checkUrl = () => {
    if (window.location.href === this.currentUrl) return;
    this.currentUrl = window.location.href;
    for (const [id, record] of this.records) {
      if (record.targetTabId !== undefined && record.associationStatus !== 'cancelled') {
        const storedUrl = record.targetConversationUrl ?? record.pendingThread.targetConversationUrl;
        const sourcePage = record.localThread.answerMode === 'workspace' &&
          isSameConversationUrl(record.localThread.sourceConversationKey, this.currentUrl);
        if (!sourcePage && storedUrl && isCompatibleChatGptTargetUrl(storedUrl, this.currentUrl)) {
          void this.bridge.associateCurrentPage(record.pendingThread.id, this.currentUrl).catch(() => undefined);
        } else {
          this.records.set(id, { ...record, associationStatus: 'awaiting_manual_association' });
          this.render();
        }
      }
    }
    void this.refreshPageAfterNavigation();
  };

  private async refreshPageAfterNavigation(): Promise<void> {
    const records = await this.bridge.getPagePendingThreads().catch(() => []);
    this.records.clear();
    for (const record of records.sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0))) this.acceptRecord(record);
    this.loadedWorkspacePreferenceId = null;
    await this.refreshWorkspacePage();
    this.refreshCandidates();
    this.render();
  }

  private async refreshWorkspacePage(fromStoreChange = false): Promise<void> {
    const workspaceRecords = [...this.records.values()].filter((record) => record.localThread.answerMode === 'workspace' &&
      Boolean((record.targetConversationUrl ?? record.pendingThread.targetConversationUrl) &&
        isSameConversationUrl(record.targetConversationUrl ?? record.pendingThread.targetConversationUrl!, window.location.href)));
    const workspaces = await this.workspaceStore?.list().catch(() => []) ?? [];
    this.pageRole = derivePointAskPageRole(window.location.href, workspaces, [...this.records.values()]);
    const recordWorkspaceIds = new Set(workspaceRecords.flatMap((record) => record.localThread.workspaceId ? [record.localThread.workspaceId] : []));
    const workspace = this.pageRole === 'workspace_target' ? workspaces.find((item) => Boolean(item.targetConversationUrl &&
      isSameConversationUrl(item.targetConversationUrl, window.location.href))) ??
      workspaces.find((item) => recordWorkspaceIds.has(item.id)) ?? null
      : null;
    this.workspacePage = workspace;
    this.workspacePageKnown = this.pageRole === 'workspace_target' && Boolean(workspace || workspaceRecords.length);
    if (!workspace) return;
    if (this.loadedWorkspacePreferenceId !== workspace.id || fromStoreChange) {
      const preference = workspace.controlCardState;
      this.workspaceExpanded = preference ? !preference.collapsed : true;
      this.selectedWorkspaceThreadId = preference?.selectedThreadId ?? null;
      this.loadedWorkspacePreferenceId = workspace.id;
    }
  }

  private persistWorkspaceControlState(): void {
    const workspace = this.workspacePage;
    if (!workspace || !this.workspaceStore) return;
    const state = { collapsed: !this.workspaceExpanded, selectedThreadId: this.selectedWorkspaceThreadId ?? undefined,
      hasAutoExpanded: true, updatedAt: new Date().toISOString() };
    this.workspacePage = { ...workspace, controlCardState: state };
    void this.workspaceStore.updateControlCardState(workspace.id, state).catch(() => undefined);
  }

  private render(): void {
    const visible = [...this.records.values()].filter((record) => !this.closedIds.has(record.pendingThread.id) &&
      record.localThread.answerMode !== 'current_conversation');
    const attachableIds = new Set([...this.candidates].filter(([id, candidate]) =>
      this.isReliableCandidate(id, candidate)).map(([id]) => id));
    const workspaceRecords = visible.filter((record) => record.localThread.answerMode === 'workspace' &&
      (!this.workspacePage?.id || !record.localThread.workspaceId || record.localThread.workspaceId === this.workspacePage.id))
      .sort((a, b) => Date.parse(b.localThread.updatedAt) - Date.parse(a.localThread.updatedAt));
    const legacyRecords = visible.filter((record) => record.localThread.answerMode !== 'workspace' &&
      (this.pageRole === 'dedicated_target' || this.pageRole === 'current_conversation_target'));
    const activeWorkspaceRecords = workspaceRecords.filter((record) => isActiveWorkspaceThread(record,
      this.sendingIds.has(record.pendingThread.id) || this.attachingIds.has(record.pendingThread.id) ||
      this.returnFailedIds.has(record.pendingThread.id)));
    if (this.previousActiveWorkspaceCount > 0 && activeWorkspaceRecords.length === 0) this.idleExpandedByUser = false;
    this.previousActiveWorkspaceCount = activeWorkspaceRecords.length;
    const active = selectWorkspaceThread(workspaceRecords, this.selectedWorkspaceThreadId, activeWorkspaceRecords);
    if ((active?.localThread.id ?? null) !== this.selectedWorkspaceThreadId) {
      this.selectedWorkspaceThreadId = active?.localThread.id ?? null;
      this.persistWorkspaceControlState();
    }
    const workspacePage = this.pageRole === 'workspace_target' && (this.workspacePageKnown || workspaceRecords.length > 0);
    if (workspacePage && activeWorkspaceRecords.length > 0 && !this.workspacePage?.controlCardState) this.persistWorkspaceControlState();
    const effectiveExpanded = this.workspaceExpanded && (activeWorkspaceRecords.length > 0 || this.idleExpandedByUser);
    const visibility = deriveWorkspaceControlVisibility(workspacePage, activeWorkspaceRecords.length, effectiveExpanded);
    if (visibility === 'hidden' && legacyRecords.length === 0) { this.unmountHost(); return; }
    const { host, root } = this.ensureHost();
    host.style.display = 'block';
    host.classList.toggle('pointask-has-workspace-control', visibility !== 'hidden');
    const activeCandidate = active ? this.candidates.get(active.pendingThread.id) : undefined;
    const activeReliable = Boolean(active && activeCandidate && this.isReliableCandidate(active.pendingThread.id, activeCandidate));
    const activeRounds = active ? this.resolveWorkspaceRounds(active) : [];
    const attachableRounds = activeRounds.filter((round) => !round.attached && round.attachmentStatus === 'available' &&
      (round.reliable || round.stageable));
    const stagedRoundCount = activeRounds.filter((round) => !round.attached && round.attachmentStatus === 'available' && round.reliable).length;
    const attachedRoundCount = activeRounds.filter((round) => round.attached).length;
    const activeSelection = active && activeCandidate && this.workspaceSelection?.messageFingerprint === activeCandidate.fingerprint
      ? this.workspaceSelection : null;
    const threadItems = buildWorkspaceThreadList(workspaceRecords, (record) => ({
      sending: this.sendingIds.has(record.pendingThread.id), attaching: this.attachingIds.has(record.pendingThread.id),
      returnFailed: this.returnFailedIds.has(record.pendingThread.id), error: this.errors.get(record.pendingThread.id),
    }));
    const switchThread = (threadId: string) => {
      if (!workspaceRecords.some((record) => record.localThread.id === threadId)) return;
      this.selectedWorkspaceThreadId = threadId; this.workspaceSelection = null; this.persistWorkspaceControlState(); this.render();
    };
    const returnThread = (threadId: string) => {
      const record = workspaceRecords.find((item) => item.localThread.id === threadId);
      if (record) void this.returnToSourceThread(record.pendingThread.id);
    };
    const deleteThread = (threadId: string) => { void this.deleteWorkspaceThread(threadId); };
    const showSelectedCard = Boolean(active && (activeWorkspaceRecords.length > 0 || effectiveExpanded));
    const isStillSelected = () => Boolean(active && this.selectedWorkspaceThreadId === active.localThread.id &&
      this.records.get(active.pendingThread.id)?.localThread.id === active.localThread.id);
    root.render(
      <>
      {active && showSelectedCard && <WorkspaceControlCard record={active} threads={threadItems} rounds={activeRounds} expanded={effectiveExpanded}
        state={deriveWorkspaceControlState({ record: active, candidate: activeCandidate, reliable: activeReliable,
          sending: this.sendingIds.has(active.pendingThread.id), selectionLength: activeSelection?.selectedText.length ?? 0,
          returnFailed: this.returnFailedIds.has(active.pendingThread.id), attachableRoundCount: attachableRounds.length,
          stagedRoundCount, totalRoundCount: activeRounds.length, attachedRoundCount,
          canContinue: Boolean(activeRounds.at(-1) && (activeRounds.at(-1)!.status === 'answer_ready' ||
            ['staged', 'attached', 'capture_failed'].includes(activeRounds.at(-1)!.persistenceStatus))) })}
        busy={this.sendingIds.has(active.pendingThread.id) || this.attachingIds.has(active.pendingThread.id)}
        error={this.errors.get(active.pendingThread.id)} selectionSummary={activeSelection ? `${activeSelection.selectedText.length} 个字符：${activeSelection.selectedText.slice(0, 36)}${activeSelection.selectedText.length > 36 ? '…' : ''}` : undefined}
        otherActiveCount={Math.max(0, activeWorkspaceRecords.length - (activeWorkspaceRecords.includes(active) ? 1 : 0))}
        onToggleExpanded={() => { this.workspaceExpanded = !effectiveExpanded; this.persistWorkspaceControlState(); this.render(); }}
        onSwitch={switchThread} onReturnThread={returnThread} onDeleteThread={deleteThread}
        onPrimary={() => { if (isStillSelected()) void this.runWorkspacePrimary(active!.pendingThread.id); }}
        onReturn={() => { if (isStillSelected()) void this.returnToSourceThread(active!.pendingThread.id); }}
        onContinue={(question, skipCapture) => isStillSelected()
          ? this.continueWorkspaceThread(active!.pendingThread.id, question, skipCapture)
          : Promise.resolve({ ok: false, error: '当前线程已切换，请在新线程中重试' })}
        onAttachRounds={(ids) => isStillSelected() ? this.attachWorkspaceRounds(active!.pendingThread.id, ids) : Promise.resolve(false)}
        onOpenRoundSelection={() => this.cleanupExpiredStagedAnswers(active!.localThread.id)}
        onClearSelection={() => { window.getSelection()?.removeAllRanges(); this.workspaceSelection = null; this.render(); }}
        onAttachOnly={() => { if (isStillSelected()) void this.attachWorkspaceAnswer(active!.pendingThread.id, false); }}
        onUnlink={() => { if (isStillSelected()) void this.unlink(active!.pendingThread.id); }}
        onCopyPrompt={() => { if (isStillSelected()) void this.copy(active!.pendingThread.id); }}
        debugInfo={import.meta.env.DEV ? JSON.stringify({ pendingId: active.pendingThread.id, threadId: active.localThread.id,
          roundId: active.pendingThread.roundId, status: active.localThread.status }, null, 2) : undefined} />}
      {!showSelectedCard && visibility !== 'hidden' && <WorkspaceControlEntry threads={threadItems} selectedThreadId={this.selectedWorkspaceThreadId ?? undefined}
        expanded={effectiveExpanded} idle={activeWorkspaceRecords.length === 0}
        onToggle={() => { this.workspaceExpanded = !effectiveExpanded; this.idleExpandedByUser = activeWorkspaceRecords.length === 0 && !effectiveExpanded;
          this.persistWorkspaceControlState(); this.render(); }}
        onSwitch={switchThread} onReturnThread={returnThread} onDeleteThread={deleteThread} />}
      {legacyRecords.length > 0 && <PendingThreadBanner
        records={legacyRecords}
        copiedIds={this.copiedIds}
        errors={this.errors}
        confirmingIds={this.confirmingIds}
        candidates={this.candidates}
        attachableIds={attachableIds}
        onCopy={(id) => void this.copy(id)}
        onFill={(id) => void this.fill(id)}
        onAssociate={(id, confirmed) => void this.associate(id, confirmed)}
        onReturn={(id) => void this.returnToSourceThread(id)}
        onCancel={(id) => void this.cancel(id)}
        onClose={(id) => { this.closedIds.add(id); this.render(); }}
        onAttachWhole={(id) => void this.attachWhole(id)}
        onAttachAndReturn={(id) => void this.attachWhole(id, true)}
        onSelectPartial={(id) => this.selectPartial(id)}
        onUndo={(id) => void this.undo(id)}
      />}
      </>,
    );
  }

  private async deleteWorkspaceThread(threadId: string): Promise<void> {
    const records = [...this.records.entries()].filter(([, record]) => record.localThread.id === threadId &&
      record.localThread.answerMode === 'workspace');
    if (records.length === 0) return;
    try {
      await this.bridge.deleteThreadData(threadId);
      for (const [pendingId] of records) {
        this.records.delete(pendingId); this.clearCurrentUi(pendingId);
      }
      if (this.selectedWorkspaceThreadId === threadId) this.selectedWorkspaceThreadId = null;
      this.workspaceSelection = null;
      this.persistWorkspaceControlState();
      this.render();
    } catch (error) {
      const pendingId = records[0]?.[0];
      if (pendingId) this.errors.set(pendingId, error instanceof Error ? error.message : '删除线程失败，请重试');
      this.render();
    }
  }

  private async copy(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    const result = await this.clipboard.copy(record.pendingThread.generatedPrompt);
    if (result.success) {
      this.copiedIds.add(id);
      this.errors.delete(id);
    } else {
      this.errors.set(id, result.error || '复制失败');
    }
    this.render();
  }

  private async runWorkspacePrimary(id: string): Promise<void> {
    const record = this.records.get(id); if (!record) return;
    if (this.returnFailedIds.has(id)) {
      await this.returnToSourceThread(id); return;
    }
    if (record.localThread.status === 'failed' || record.pendingThread.status === 'failed' ||
      record.pendingThread.submittedPromptHash !== record.pendingThread.promptHash && !this.candidates.has(id)) {
      await this.fill(id); return;
    }
    if (this.resolveWorkspaceRounds(record).some((round) => !round.attached && round.attachmentStatus === 'available' &&
      (round.reliable || round.stageable)) || this.workspaceSelection) {
      await this.attachWorkspaceAnswer(id, true); return;
    }
    if (record.localThread.status === 'answer_attached') await this.returnToSourceThread(id);
  }

  private async attachWorkspaceAnswer(id: string, returnAfter: boolean, requestedRoundIds?: string[]): Promise<boolean> {
    const attached = await this.attachSelectedRounds(id, requestedRoundIds);
    if (!attached) return false;
    if (returnAfter) await this.returnToSourceThread(id);
    return true;
  }

  private async attachSelectedRounds(id: string, requestedRoundIds?: string[]): Promise<PendingAssociation | null> {
    let record = this.records.get(id);
    if (!record || this.attachingIds.has(id)) return null;
    await this.cleanupExpiredStagedAnswers(record.localThread.id);
    record = this.records.get(id) ?? record;
    let resolved = this.resolveWorkspaceRounds(record);
    const selection = this.workspaceSelection;
    let selectedRound = selection ? resolved.find((round) => round.candidate?.fingerprint === selection.messageFingerprint &&
      round.candidate.element === selection.sourceMessageElement) : undefined;
    if (selection && !selectedRound) {
      const rejected = [{ roundId: record.pendingThread.roundId ?? 'unknown', reason: '所选回答定位已失效' }];
      logWorkspaceAttach({ threadId: record.localThread.id, selectedRoundIds: [], validRoundIds: [], rejectedRounds: rejected, phase: 'validate' });
      this.errors.set(id, '所选回答已变化，请重新选择回答内容'); this.render(); return null;
    }
    const selectedIds = selection && selectedRound ? [selectedRound.id] : requestedRoundIds
      ? [...new Set(requestedRoundIds)] : resolved.filter((round) => !round.attached && round.attachmentStatus === 'available' &&
        (round.reliable || round.stageable)).map((round) => round.id);
    const rejected: RejectedWorkspaceRound[] = [];
    if (!selectedIds.length) return null;
    if (this.authorizer && !(await this.authorizer.authorize())) return null;
    this.attachingIds.add(id); this.errors.delete(id); this.render();
    try {
      if (!selection) {
        const trigger: WorkspaceStagingTrigger = requestedRoundIds ? 'attach_selected' : 'attach_all';
        const roundsToStage = requestedRoundIds
          ? resolved.filter((round) => !round.attached && round.attachmentStatus === 'available' &&
              selectedIds.includes(round.id)).map((round) => round.id)
          : selectedIds;
        for (const roundId of roundsToStage) {
          const round = resolved.find((item) => item.id === roundId);
          if (!round || round.attached || round.persistenceStatus === 'staged') continue;
          const staged = await this.ensureRoundStaged(record.localThread.id, roundId, trigger);
          if (staged.record) record = staged.record;
          if (!staged.ok) rejected.push({ roundId, reason: staged.error ?? staged.code });
        }
        record = this.records.get(id) ?? record;
        resolved = this.resolveWorkspaceRounds(record);
      }
      selectedRound = selection ? resolved.find((round) => round.candidate?.fingerprint === selection.messageFingerprint &&
        round.candidate.element === selection.sourceMessageElement) : undefined;
      const chosen = selection && selectedRound ? [selectedRound] : selectedIds.flatMap((roundId) => {
        const round = resolved.find((item) => item.id === roundId);
        if (!round) { rejected.push({ roundId, reason: '轮次不存在' }); return []; }
        if (round.attached) { rejected.push({ roundId, reason: '已经附加' }); return []; }
        if (round.status !== 'answer_ready') { rejected.push({ roundId, reason: '回答尚未完成' }); return []; }
        if (round.persistenceStatus !== 'staged') {
          if (!rejected.some((item) => item.roundId === roundId)) rejected.push({ roundId, reason: '回答尚未暂存' });
          return [];
        }
        if (!round.stagedAnswer || !isRichContent(round.stagedAnswer)) { rejected.push({ roundId, reason: '暂存内容无效' }); return []; }
        if (!round.question.trim() || round.question === '问题内容不可用') { rejected.push({ roundId, reason: '缺少问题内容' }); return []; }
        if (!round.answerLocator?.messageFingerprint) { rejected.push({ roundId, reason: '缺少回答定位信息' }); return []; }
        return [round];
      });
      logWorkspaceAttach({ threadId: record.localThread.id, selectedRoundIds: selectedIds,
        validRoundIds: chosen.map((round) => round.id), rejectedRounds: rejected, phase: 'validate' });
      if (!chosen.length) {
        const detail = rejected.map((item) => `${item.roundId}：${item.reason}`).join('；');
        this.errors.set(id, detail ? `没有可附加的所选轮次（${detail}）` : '没有可可靠附加的轮次，请先选择回答内容');
        this.render(); return null;
      }
      const payloads: AttachedRoundPayload[] = [];
      for (const round of chosen) {
        let rich;
        try {
          rich = selection && round.id === selectedRound?.id ? selection.richSelection : { blocks: round.stagedAnswer };
        } catch {
          throw new Error(`${round.id}：读取回答内容失败`);
        }
        const blocks = rich?.blocks;
        if (!blocks?.length || !isRichContent(blocks)) {
          const error = new Error(`${round.id}：回答内容为空或格式无效`);
          throw error;
        }
        const locator = selection && round.id === selectedRound?.id ? {
          conversationUrl: window.location.href, conversationKey: this.adapter?.getConversationKey() ?? window.location.href,
          messageFingerprint: round.candidate!.fingerprint,
          ...(selection && round.id === selectedRound?.id ? { selectedText: selection.selectedText,
            prefixText: selection.textAnchor?.prefixText, suffixText: selection.textAnchor?.suffixText } : {}),
        } : round.answerLocator!;
        payloads.push({ roundId: round.id, richContent: blocks, answerSource: locator });
      }
      logWorkspaceAttach({ threadId: record.localThread.id, selectedRoundIds: selectedIds,
        validRoundIds: payloads.map((payload) => payload.roundId), rejectedRounds: rejected, phase: 'persist' });
      const selectedSet = new Set(selectedIds);
      const skippedRoundIds = requestedRoundIds ? resolved.filter((round) => !selectedSet.has(round.id) && !round.attached &&
        round.attachmentStatus === 'available' && round.persistenceStatus === 'staged' && Boolean(round.stagedAnswer?.length))
        .map((round) => round.id) : undefined;
      const updated = await this.bridge.attachRounds(id, payloads, window.location.href, skippedRoundIds);
      const persisted = new Set(threadRounds(updated.localThread, updated.pendingThread)
        .filter((round) => round.status === 'attached').map((round) => round.id));
      const missing = payloads.filter((payload) => !persisted.has(payload.roundId));
      if (missing.length) throw new Error(`保存后未确认轮次：${missing.map((payload) => payload.roundId).join(', ')}`);
      for (const payload of payloads) logWorkspaceStaging({ threadId: record.localThread.id, roundId: payload.roundId,
        activeRoundId: record.pendingThread.roundId, trigger: requestedRoundIds ? 'attach_selected' : 'attach_all',
        beforeStatus: 'staged', afterStatus: 'attached', phase: 'attach' });
      for (const payload of payloads) logWorkspaceRound({ threadId: record.localThread.id, roundId: payload.roundId,
        activeRoundId: record.pendingThread.roundId, pendingId: record.pendingThread.id,
        trigger: requestedRoundIds ? 'attach_selected' : 'attach_all', beforeStatus: 'staged', afterStatus: 'attached',
        phase: 'attach', selectedRoundIds: selectedIds });
      if (!this.acceptRecord(updated)) return null;
      this.candidates.delete(id); this.workspaceSelection = null;
      this.errors.delete(id); this.submissionUnknownIds.delete(id); this.render();
      return updated;
    } catch (error) {
      logWorkspaceAttach({ threadId: record.localThread.id, selectedRoundIds: selectedIds,
        validRoundIds: [], rejectedRounds: rejected,
        phase: error instanceof Error && /回答内容|读取回答/.test(error.message) ? 'extract' : 'persist', error });
      this.errors.set(id, error instanceof Error ? error.message : '保存附加内容失败，请重试'); this.render(); return null;
    } finally { this.attachingIds.delete(id); this.render(); }
  }

  private async attachWorkspaceRounds(id: string, roundIds: string[]): Promise<boolean> {
    if (this.workspaceSelection) return this.attachWorkspaceAnswer(id, true);
    return this.attachWorkspaceAnswer(id, true, roundIds);
  }

  private async continueWorkspaceThread(id: string, question: string, skipCapture = false): Promise<ContinueWorkspaceResult> {
    if (this.sendingIds.has(id)) return { ok: false, error: '正在处理当前继续追问' };
    this.sendingIds.add(id); this.render();
    try { return await this.performContinueWorkspaceThread(id, question, skipCapture); }
    finally { this.sendingIds.delete(id); this.render(); }
  }

  private async performContinueWorkspaceThread(id: string, question: string, skipCapture: boolean): Promise<ContinueWorkspaceResult> {
    let record = this.records.get(id); if (!record || !question.trim()) return { ok: false };
    const currentRoundId = roundIdForPending(record.localThread, record.pendingThread);
    const currentRound = this.resolveWorkspaceRounds(record).find((round) => round.id === currentRoundId);
    if (!currentRound || currentRound.status !== 'answer_ready' && currentRound.persistenceStatus !== 'attached') {
      const error = '当前轮回答尚未生成完成，无法继续追问'; this.errors.set(id, error); this.render(); return { ok: false, error };
    }
    if (currentRound.persistenceStatus !== 'staged' && currentRound.persistenceStatus !== 'attached') {
      if (skipCapture) {
        try {
          record = await this.bridge.stageRoundAnswer(id, currentRound.id, record.pendingThread.promptHash ?? '', {
            captureFailed: true, answerSource: currentRound.answerLocator, targetUrl: window.location.href,
          });
          this.acceptRecord(record); this.render();
        } catch (error) {
          const message = error instanceof Error ? error.message : '无法保存暂存状态';
          return { ok: false, captureFailed: true, error: message };
        }
      } else {
        this.attachingIds.add(id); this.errors.delete(id); this.render();
        let staged: EnsureRoundStagedResult;
        try { staged = await this.ensureRoundStaged(record.localThread.id, currentRoundId!, 'continue'); }
        finally { this.attachingIds.delete(id); this.render(); }
        if (!staged.ok) return { ok: false, captureFailed: true, error: staged.error ?? '当前回答暂存失败' };
        record = staged.record ?? record;
      }
    }
    const confirmedActiveRoundId = roundIdForPending(record.localThread, record.pendingThread);
    if (confirmedActiveRoundId !== currentRoundId) {
      const error = '当前轮次已变化，请重新提交继续追问'; this.errors.set(id, error); this.render(); return { ok: false, error };
    }
    const timestamp = new Date().toISOString();
    const roundId = `pointask-round-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const questionMessageId = `pointask-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pendingId = `pointask-pending-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const generatedPrompt = buildPrompt({ selectedText: record.localThread.anchor.selectedText,
      paragraphText: record.localThread.anchor.paragraphText, userQuestion: question.trim(), previousLocalMessages: record.localThread.messages,
      mode: 'compact', answerMode: 'workspace', displayId: record.localThread.displayId });
    const pending = { ...record.pendingThread, id: pendingId, threadId: record.localThread.id, roundId, question: question.trim(), generatedPrompt,
      promptHash: stableTextHash(generatedPrompt), assistantFingerprintsBefore: this.adapter?.getAssistantMessageFingerprints() ?? [],
      candidateAnswerFingerprint: undefined, submittedPromptHash: undefined, submittedAt: undefined, status: 'prompt_ready' as const,
      createdAt: timestamp, updatedAt: timestamp,
      revision: Math.max(record.revision ?? 0, record.localThread.revision ?? 0, record.pendingThread.revision ?? 0) + 1,
      operationId: `pointask-operation-${roundId}` };
    const localThread = { ...record.localThread, messages: [...record.localThread.messages, {
      id: questionMessageId, roundId, role: 'user' as const, content: textBlocks(question.trim()), attachedManually: false, createdAt: timestamp,
    }], rounds: [...threadRounds(record.localThread, record.pendingThread), {
      id: roundId, questionMessageId, pendingId, promptHash: stableTextHash(generatedPrompt), assistantFingerprintsBefore: this.adapter?.getAssistantMessageFingerprints() ?? [],
      status: 'waiting_for_submission' as const, persistenceStatus: 'not_captured' as const, createdAt: timestamp, updatedAt: timestamp,
      attachmentStatus: 'available' as const,
      revision: pending.revision,
    }], status: 'waiting_for_submission' as const, updatedAt: timestamp, revision: pending.revision };
    logWorkspaceRound({ threadId: record.localThread.id, roundId, activeRoundId: currentRoundId, pendingId,
      trigger: 'continue', beforeStatus: currentRound.persistenceStatus, afterStatus: 'waiting_for_submission', phase: 'create_round' });
    logPointAskLifecycle({ threadId: record.localThread.id, roundId, pendingId, operationId: pending.operationId,
      revision: pending.revision, event: 'create_round', beforeStatus: currentRound.status,
      afterStatus: 'waiting_for_submission', activeRoundId: currentRoundId });
    this.sendingIds.add(pendingId); this.errors.delete(id); this.render();
    try {
      const created = await this.bridge.savePendingThread(pending, localThread);
      this.records.delete(id); this.acceptRecord(created); this.selectedWorkspaceThreadId = created.localThread.id;
      this.persistWorkspaceControlState();
      this.sendingIds.delete(pendingId); this.render();
      return { ok: await this.fill(pendingId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送失败，请重试'; this.errors.set(id, message); return { ok: false, error: message };
    } finally { this.sendingIds.delete(pendingId); this.render(); }
  }

  private ensureRoundStaged(threadId: string, roundId: string,
    trigger: WorkspaceStagingTrigger = 'continue'): Promise<EnsureRoundStagedResult> {
    const key = `${threadId}:${roundId}`;
    const existing = this.stagingPromises.get(key);
    if (existing) return existing;
    const operation = this.performEnsureRoundStaged(threadId, roundId, trigger)
      .finally(() => this.stagingPromises.delete(key));
    this.stagingPromises.set(key, operation);
    return operation;
  }

  private async performEnsureRoundStaged(threadId: string, roundId: string,
    trigger: WorkspaceStagingTrigger): Promise<EnsureRoundStagedResult> {
    let record = [...this.records.values()].find((item) => item.localThread.id === threadId);
    const activeRoundId = record ? roundIdForPending(record.localThread, record.pendingThread) : undefined;
    let round = record ? this.resolveWorkspaceRounds(record).find((item) => item.id === roundId) : undefined;
    const beforeStatus = round?.persistenceStatus;
    logPointAskLifecycle({ threadId, roundId, pendingId: record?.pendingThread.id, operationId: record?.pendingThread.operationId,
      revision: record?.revision, event: 'stage_start', beforeStatus, activeRoundId });
    const log = (phase: 'resolve' | 'extract' | 'persist' | 'attach', afterStatus?: string, error?: unknown) =>
      logWorkspaceStaging({ threadId, roundId, activeRoundId, trigger, beforeStatus, afterStatus, phase, error });
    if (!record || !round || record.localThread.id !== (record.pendingThread.threadId || record.pendingThread.id)) {
      log('resolve', beforeStatus, '轮次状态已变化');
      return { ok: false, code: 'capture_failed', error: '当前回答暂存失败：轮次状态已变化' };
    }
    if (round.persistenceStatus === 'staged') {
      log('resolve', 'staged'); return { ok: true, code: 'already_staged', record };
    }
    if (round.persistenceStatus === 'attached' || round.attached) {
      log('resolve', 'attached'); return { ok: true, code: 'already_attached', record };
    }
    if (round.status === 'generating' || round.candidate?.streaming) {
      log('resolve', beforeStatus, 'answer_still_streaming');
      return { ok: false, code: 'answer_still_streaming', error: '当前回答仍在生成，请等待完成后重试' };
    }
    if (round.status !== 'answer_ready') {
      log('resolve', beforeStatus, 'answer_not_complete');
      return { ok: false, code: 'answer_not_complete', error: '当前轮回答尚未完成' };
    }
    for (let attempt = 1; attempt < 3 && (!round.candidate || !round.candidate.element.isConnected); attempt++) {
      logPointAskLifecycle({ threadId, roundId, pendingId: record.pendingThread.id, operationId: record.pendingThread.operationId,
        revision: record.revision, event: 'stage_retry', beforeStatus, activeRoundId,
        promptMatched: true, assistantMatched: false, errorCode: 'locator_stale' });
      await new Promise((resolve) => setTimeout(resolve, 40));
      const refreshed = [...this.records.values()].find((item) => item.localThread.id === threadId);
      const refreshedRound = refreshed && this.resolveWorkspaceRounds(refreshed).find((item) => item.id === roundId);
      if (refreshed && refreshedRound) { record = refreshed; round = refreshedRound; }
    }
    const fallbackFingerprint = round.candidate?.fingerprint ?? round.knownAnswerFingerprint;
    const fallbackLocator = round.answerLocator ?? (fallbackFingerprint ? {
      conversationUrl: window.location.href, conversationKey: this.adapter?.getConversationKey() ?? window.location.href,
      messageFingerprint: fallbackFingerprint,
    } : undefined);
    const fail = async (code: Exclude<EnsureRoundStagedCode, 'staged' | 'already_staged' | 'already_attached' | 'answer_still_streaming'>,
      message: string, phase: 'resolve' | 'extract' | 'persist'): Promise<EnsureRoundStagedResult> => {
      try {
        const storedRound = threadRounds(record.localThread).find((item) => item.id === roundId);
        const updated = await this.bridge.stageRoundAnswer(record.pendingThread.id, roundId, storedRound?.promptHash ?? '', {
          captureFailed: true, answerSource: fallbackLocator, targetUrl: window.location.href,
        });
        this.acceptRecord(updated); this.render();
      } catch { /* Keep the user's draft even if persisting the failure marker also fails. */ }
      log(phase, 'capture_failed', message);
      logPointAskLifecycle({ threadId, roundId, pendingId: record.pendingThread.id, operationId: record.pendingThread.operationId,
        revision: record.revision, event: 'stage_failure', beforeStatus, afterStatus: 'capture_failed', activeRoundId,
        errorCode: code });
      logWorkspaceRound({ threadId, roundId, activeRoundId, pendingId:
        threadRounds(record.localThread).find((item) => item.id === roundId)?.pendingId,
      trigger, beforeStatus, afterStatus: 'capture_failed', phase: 'stage', error: message });
      this.errors.set(record.pendingThread.id, message); this.render();
      return { ok: false, code, error: `当前回答暂存失败：${message}` };
    };
    if (!record.targetConversationUrl || !isCompatibleChatGptTargetUrl(record.targetConversationUrl, window.location.href)) {
      return fail('capture_failed', '当前页面不是目标 Workspace', 'resolve');
    }
    if (!round.candidate) return round.knownAnswerFingerprint || round.answerLocator
      ? fail('answer_not_loaded', '回答当前未加载，请滚动加载后重试', 'resolve')
      : fail('answer_ambiguous', '无法唯一匹配当前回答', 'resolve');
    if (!round.candidateReliable) return fail('answer_ambiguous', '当前回答匹配不唯一', 'resolve');
    log('extract', beforeStatus);
    const matchedFingerprint = round.candidate.fingerprint;
    let rich = this.adapter?.getMessageRichContent(round.candidate.element);
    for (let attempt = 1; attempt < 3 && (!rich?.blocks.length || !isRichContent(rich.blocks)); attempt++) {
      logPointAskLifecycle({ threadId, roundId, pendingId: record.pendingThread.id, operationId: record.pendingThread.operationId,
        revision: record.revision, event: 'stage_retry', beforeStatus, activeRoundId,
        promptMatched: true, assistantMatched: true, streaming: false, errorCode: 'extraction_failed' });
      await new Promise((resolve) => setTimeout(resolve, 40));
      const refreshedRound = this.resolveWorkspaceRounds(record).find((item) => item.id === roundId);
      if (!refreshedRound?.candidate || refreshedRound.candidate.fingerprint !== matchedFingerprint ||
        refreshedRound.candidate.streaming) return fail('locator_stale', '回答定位在提取过程中已变化', 'extract');
      round = refreshedRound;
      rich = this.adapter?.getMessageRichContent(refreshedRound.candidate.element);
    }
    if (!rich?.blocks.length || !isRichContent(rich.blocks)) return fail('extraction_failed', '回答内容为空或格式无效', 'extract');
    const answerSource = { conversationUrl: window.location.href,
      conversationKey: this.adapter?.getConversationKey() ?? window.location.href, messageFingerprint: matchedFingerprint };
    const persistStage = (association: PendingAssociation) => {
      const storedRound = threadRounds(association.localThread).find((item) => item.id === roundId);
      if (!storedRound?.promptHash) throw new Error('轮次提示词标识缺失，请刷新页面后重试');
      return this.bridge.stageRoundAnswer(association.pendingThread.id, roundId, storedRound.promptHash, {
        captureFailed: false, richContent: rich.blocks, answerSource, targetUrl: window.location.href,
      });
    };
    try {
      const storedRound = threadRounds(record.localThread).find((item) => item.id === round.id);
      let updated: PendingAssociation;
      try {
        updated = await persistStage(record);
      } catch (firstError) {
        // A service-worker restart or a closed response port may happen after
        // the atomic write completed. Re-read the page snapshot before retrying
        // so a successful stage is never overwritten with capture_failed.
        let refreshed: PendingAssociation | undefined;
        try {
          const pageRecords = await this.bridge.getPagePendingThreads(window.location.href);
          refreshed = pageRecords.find((item) => item.pendingThread.id === record.pendingThread.id &&
            item.localThread.id === threadId);
        } catch { /* Preserve the first staging error below. */ }
        const refreshedRound = refreshed && threadRounds(refreshed.localThread).find((item) => item.id === round.id);
        if (refreshed && refreshedRound?.persistenceStatus === 'staged' && refreshedRound.stagedAnswer?.length) {
          updated = refreshed;
        } else if (refreshed && refreshedRound?.status === 'answer_ready' && refreshedRound.promptHash === storedRound?.promptHash) {
          updated = await persistStage(refreshed);
        } else {
          throw firstError;
        }
      }
      if (!this.acceptRecord(updated)) return { ok: false, code: 'persist_failed', error: '暂存结果已过期，请重试' };
      this.errors.delete(record.pendingThread.id); this.render();
      log('persist', 'staged');
      logPointAskLifecycle({ threadId, roundId, pendingId: updated.pendingThread.id, operationId: updated.pendingThread.operationId,
        revision: updated.revision, event: 'stage_success', beforeStatus, afterStatus: 'staged', activeRoundId,
        promptMatched: true, assistantMatched: true, streaming: false });
      logWorkspaceRound({ threadId, roundId, activeRoundId, pendingId: storedRound?.pendingId, trigger,
        beforeStatus, afterStatus: 'staged', phase: 'stage' });
      return { ok: true, code: 'staged', record: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地保存失败';
      // Extraction succeeded, so this is not capture_failed. Keeping the round
      // answer_ready/not_captured makes the operation safely retryable.
      log('persist', beforeStatus, message);
      logPointAskLifecycle({ threadId, roundId, pendingId: record.pendingThread.id, operationId: record.pendingThread.operationId,
        revision: record.revision, event: 'stage_failure', beforeStatus, afterStatus: beforeStatus, activeRoundId,
        errorCode: 'storage_failed' });
      logWorkspaceRound({ threadId, roundId, activeRoundId,
        pendingId: threadRounds(record.localThread).find((item) => item.id === round.id)?.pendingId,
        trigger, beforeStatus, afterStatus: beforeStatus, phase: 'stage', error: message });
      this.errors.set(record.pendingThread.id, `当前回答暂存保存失败：${message}`); this.render();
      return { ok: false, code: 'storage_failed', error: `当前回答暂存保存失败：${message}` };
    }
  }

  private resolveWorkspaceRounds(record: PendingAssociation): ResolvedWorkspaceRound[] {
    const questions = new Map(record.localThread.messages.filter((message) => message.role === 'user')
      .map((message) => [message.roundId ?? message.id, richPlainText(message.content)]));
    const rounds = threadRounds(record.localThread, record.pendingThread);
    const currentRoundId = roundIdForPending(record.localThread, record.pendingThread);
    return rounds.map((round, index) => {
      const attached = round.status === 'attached';
      const exactCandidate = !attached && this.adapter && ['answer_ready', 'generating'].includes(round.status)
        ? (round.id === currentRoundId ? this.candidates.get(record.pendingThread.id) : undefined) ??
          this.adapter.findCandidateAnswer(round.promptHash, round.assistantFingerprintsBefore) ?? undefined : undefined;
      const rememberedElement = !exactCandidate && round.candidateAnswerFingerprint
        ? this.adapter?.findAssistantMessageByFingerprint(round.candidateAnswerFingerprint) : null;
      const candidate = exactCandidate ?? (rememberedElement ? { element: rememberedElement, fingerprint: round.candidateAnswerFingerprint!,
        streaming: this.adapter?.isMessageStreaming(rememberedElement) ?? false } : undefined);
      const sharedWithOtherThread = Boolean(candidate && [...this.candidates].some(([pendingId, other]) =>
        pendingId !== record.pendingThread.id && other.fingerprint === candidate.fingerprint));
      // Once the strict prompt matcher has persisted a fingerprint for this
      // round, that stable fingerprint remains authoritative while its answer
      // element is loaded. The preceding user turn may be virtualized away,
      // making findCandidateAnswer() temporarily unable to repeat the original
      // adjacency proof even though this is still the same recorded answer.
      const candidateReliable = Boolean(candidate && !candidate.streaming && !sharedWithOtherThread && (exactCandidate ||
        Boolean(round.candidateAnswerFingerprint && round.candidateAnswerFingerprint === candidate.fingerprint)));
      const attachmentStatus = roundAttachmentStatus(round);
      const stagedAnswer = round.persistenceStatus === 'staged' ? round.stagedAnswer : undefined;
      const reliable = Boolean(stagedAnswer && isRichContent(stagedAnswer) && round.answerSource?.messageFingerprint);
      // A completed active round is actionable even before capture. The user
      // click is what runs ensureRoundStaged and produces a precise
      // not-loaded/ambiguous error when extraction cannot proceed.
      const stageable = attachmentStatus === 'available' && !attached && round.persistenceStatus === 'not_captured' && round.status === 'answer_ready' && !reliable &&
        (!candidate || candidateReliable);
      return { id: round.id, index: index + 1, question: questions.get(round.id) ?? '问题内容不可用', attached,
        latest: index === rounds.length - 1, reliable, stageable, candidate, candidateReliable, status: round.status,
        persistenceStatus: round.persistenceStatus, attachmentStatus, stagedAnswer, answerLocator: round.answerSource,
        knownAnswerFingerprint: round.candidateAnswerFingerprint };
    });
  }

  private async cleanupExpiredStagedAnswers(threadId?: string): Promise<void> {
    if (!this.threadStore) return;
    await this.threadStore.cleanupExpiredStagedAnswers();
    const ids = new Set([...this.records.values()].map((record) => record.localThread.id));
    if (threadId) ids.add(threadId);
    for (const id of ids) {
      const localThread = await this.threadStore.get(id);
      if (!localThread) continue;
      for (const record of this.records.values()) if (record.localThread.id === id) {
        this.acceptRecord({ ...record, localThread });
      }
    }
    this.render();
  }

  private async unlink(id: string): Promise<void> {
    try { const record = await this.bridge.unlinkTargetPage(id); this.acceptRecord(record); this.render(); }
    catch (error) { this.errors.set(id, error instanceof Error ? error.message : '取消关联失败'); this.render(); }
  }

  private async fill(id: string, skipAuthorization = false): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || this.sendingIds.has(id)) return false;
    if (record.pendingThread.submittedPromptHash === record.pendingThread.promptHash) {
      this.errors.delete(id); this.submissionUnknownIds.delete(id); this.render(); return true;
    }
    if (record.pendingThread.status === 'submission_unknown' || record.localThread.status === 'submission_unknown') return true;
    if (!skipAuthorization && this.authorizer && !(await this.authorizer.authorize())) return false;
    const promptHash = record.pendingThread.promptHash ?? '';
    let submissionMayHaveOccurred = false;
    this.sendingIds.add(id); this.errors.delete(id); this.render();
    try {
      if (!this.adapter || !(await this.adapter.waitForComposerReady())) throw new Error('追问空间尚未准备好，请重试');
      if (!this.adapter.fillComposer(record.pendingThread.generatedPrompt)) throw new Error('追问空间输入框暂时无法写入');
      if (!(await this.adapter.waitForSubmitReady())) throw new Error('发送按钮当前不可用');
      let submitted = this.adapter.hasSubmittedPrompt(promptHash);
      submissionMayHaveOccurred = submitted;
      if (!submitted) {
        if (!this.adapter.submitComposer()) throw new Error('发送失败，请重试');
        submissionMayHaveOccurred = true;
        for (let attempt = 0; !submitted && attempt < 150; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          submitted = this.adapter.hasSubmittedPrompt(promptHash) || Boolean(this.adapter.findCandidateAnswer(
            promptHash, record.pendingThread.assistantFingerprintsBefore ?? []));
        }
      }
      if (!submitted) {
        logPointAskLifecycle({ threadId: record.localThread.id, roundId: record.pendingThread.roundId, pendingId: id,
          operationId: record.pendingThread.operationId, revision: record.revision, event: 'submit_timeout',
          beforeStatus: record.localThread.status, afterStatus: 'submission_unknown', activeRoundId: record.pendingThread.roundId,
          promptMatched: false, assistantMatched: false, errorCode: 'confirmation_timeout' });
        await this.persistSubmissionUnknown(record, promptHash);
        showOperationToast('已提交，正在确认发送'); return true;
      }
      // Commit waiting_for_answer only after ChatGPT has rendered the exact
      // user turn. button.click() alone is not proof that React accepted it.
      const reserved = await this.bridge.reservePromptSubmission(id, promptHash, window.location.href);
      this.acceptRecord(reserved); this.errors.delete(id); this.submissionUnknownIds.delete(id);
      const reconciled = this.records.get(id) ?? reserved;
      logPointAskLifecycle({ threadId: reconciled.localThread.id, roundId: reconciled.pendingThread.roundId, pendingId: id,
        operationId: reconciled.pendingThread.operationId, revision: reconciled.revision, event: 'submit_reconciled',
        beforeStatus: record.localThread.status, afterStatus: reconciled.localThread.status,
        activeRoundId: reconciled.pendingThread.roundId, promptMatched: true });
      showOperationToast('已发送');
      return true;
    } catch (error) {
      if (submissionMayHaveOccurred) {
        await this.persistSubmissionUnknown(this.records.get(id) ?? record, promptHash);
        showOperationToast('已提交，正在确认发送'); return true;
      }
      this.errors.set(id, error instanceof Error ? error.message : '操作失败，请重试');
      return false;
    } finally { this.sendingIds.delete(id); this.render(); }
  }

  private async persistSubmissionUnknown(record: PendingAssociation, promptHash: string): Promise<void> {
    const id = record.pendingThread.id;
    this.submissionUnknownIds.add(id);
    try {
      const unknown = await this.bridge.markSubmissionUnknown(id, promptHash, window.location.href);
      this.acceptRecord(unknown);
    } catch {
      const timestamp = new Date().toISOString();
      this.records.set(id, { ...record,
        pendingThread: { ...record.pendingThread, status: 'submission_unknown', updatedAt: timestamp },
        localThread: { ...record.localThread, status: 'submission_unknown', updatedAt: timestamp } });
    }
    this.errors.delete(id);
  }

  private refreshCandidates(): void {
    if (!this.adapter) return;
    let changed = false;
    for (const [id, record] of this.records) {
      if (record.localThread.status === 'answer_attached' || !this.recordMatchesPageRole(record)) continue;
      const promptHash = record.pendingThread.promptHash ?? '';
      const candidate = this.adapter.findCandidateAnswer(
        promptHash,
        record.pendingThread.assistantFingerprintsBefore ?? [],
      );
      const submittedEvidence = Boolean(promptHash && (candidate || this.adapter.hasSubmittedPrompt(promptHash)));
      if (submittedEvidence && record.pendingThread.submittedPromptHash !== promptHash && !candidate &&
        !this.submissionReconciliationPromises.has(id)) {
        const reconciliation = this.bridge.reservePromptSubmission(id, promptHash, window.location.href).then((updated) => {
          if (this.acceptRecord(updated)) { this.errors.delete(id); this.submissionUnknownIds.delete(id); this.render(); }
        }).catch(() => undefined).finally(() => this.submissionReconciliationPromises.delete(id));
        this.submissionReconciliationPromises.set(id, reconciliation);
      }
      if (candidate) {
        this.candidates.set(id, candidate); this.errors.delete(id); this.submissionUnknownIds.delete(id); changed = true;
        this.reliableCandidateIds.add(id);
        const signature = `${candidate.fingerprint}:${candidate.streaming}`;
        if (this.candidateStates.get(id) !== signature) {
          this.candidateStates.set(id, signature);
          const roundId = record.pendingThread.roundId;
          const beforeStatus = roundId ? threadRounds(record.localThread).find((round) => round.id === roundId)?.status : undefined;
          void this.bridge.updateCandidateState(id, candidate.fingerprint, candidate.streaming).then((updated) => {
            logPointAskLifecycle({ threadId: updated.localThread.id, roundId, pendingId: id,
              operationId: updated.pendingThread.operationId, revision: updated.revision,
              event: candidate.streaming ? 'answer_streaming' : 'answer_ready', beforeStatus,
              afterStatus: candidate.streaming ? 'generating' : 'answer_ready', activeRoundId: updated.pendingThread.roundId,
              promptMatched: true, assistantMatched: true, streaming: candidate.streaming });
            if (roundId) logWorkspaceRound({ threadId: record.localThread.id, roundId,
              activeRoundId: updated.pendingThread.roundId, pendingId: id, trigger: 'answer_recognized', beforeStatus,
              afterStatus: candidate.streaming ? 'generating' : 'answer_ready', phase: 'recognize_answer' });
            this.acceptRecord(updated); this.render();
          }).catch((error) => {
            if (roundId) logWorkspaceRound({ threadId: record.localThread.id, roundId,
              activeRoundId: record.pendingThread.roundId, pendingId: id, trigger: 'answer_recognized', beforeStatus,
              afterStatus: beforeStatus, phase: 'recognize_answer', error });
          });
        }
      } else {
        this.reliableCandidateIds.delete(id);
        const fingerprint = record.pendingThread.candidateAnswerFingerprint;
        const element = fingerprint ? this.adapter.findAssistantMessageByFingerprint(fingerprint) : null;
        if (fingerprint && element) {
          this.candidates.set(id, { element, fingerprint, streaming: this.adapter.isMessageStreaming(element) }); changed = true;
        } else if (this.candidates.delete(id)) changed = true;
      }
    }
    this.syncCurrentAnswerActions();
    if (changed) this.render();
  }

  private syncCurrentAnswerActions(): void {
    const fingerprintCounts = new Map<string, number>();
    for (const [id, candidate] of this.candidates) {
      const record = this.records.get(id);
      if (record?.localThread.answerMode === 'current_conversation' && record.localThread.status !== 'answer_attached') {
        fingerprintCounts.set(candidate.fingerprint, (fingerprintCounts.get(candidate.fingerprint) ?? 0) + 1);
      }
    }
    const desired = new Set<string>();
    for (const [id, candidate] of this.candidates) {
      const record = this.records.get(id);
      if (!record || record.localThread.answerMode !== 'current_conversation' || record.localThread.status === 'answer_attached' ||
        this.returnedIds.has(id) || !candidate.element.isConnected) continue;
      desired.add(id);
      let mounted = this.answerActions.get(id);
      if (!mounted) {
        const host = document.createElement('pointask-current-answer-actions'); host.dataset.pointaskOwned = 'true'; host.dataset.pointaskThreadId = id;
        applyPointAskTheme(host, candidate.element);
        const shadow = host.attachShadow({ mode: 'open' }); const style = document.createElement('style'); style.textContent = currentAnswerActionStyles;
        const mount = document.createElement('div'); shadow.append(style, mount);
        mounted = { host, root: createRoot(mount), fingerprint: candidate.fingerprint, element: candidate.element }; this.answerActions.set(id, mounted);
      }
      if (mounted.fingerprint !== candidate.fingerprint || mounted.element !== candidate.element || !mounted.host.isConnected) {
        mounted.fingerprint = candidate.fingerprint; mounted.element = candidate.element; candidate.element.insertAdjacentElement('afterend', mounted.host);
      }
      const reliable = this.reliableCandidateIds.has(id) && fingerprintCounts.get(candidate.fingerprint) === 1;
      mounted.root.render(<CurrentAnswerActions
        displayId={record.localThread.displayId}
        streaming={candidate.streaming}
        reliable={reliable}
        attaching={this.attachingIds.has(id)}
        error={this.errors.get(id)}
        onAttachAndReturn={() => void this.attachCurrentWholeAndReturn(id)}
        onReturn={() => void this.returnCurrentOnly(id)}
        onSelectPartial={() => this.selectPartial(id)}
      />);
    }
    for (const id of this.answerActions.keys()) if (!desired.has(id)) this.removeAnswerAction(id);
  }

  private removeAnswerAction(id: string): void {
    const mounted = this.answerActions.get(id); if (!mounted) return;
    mounted.root.unmount(); mounted.host.remove(); this.answerActions.delete(id);
  }

  private clearCurrentUi(id: string): void {
    if (this.partialSelectionId === id) this.partialSelectionId = null;
    this.candidates.delete(id); this.reliableCandidateIds.delete(id); this.returnedIds.delete(id); this.errors.delete(id);
    [...document.querySelectorAll<HTMLElement>('pointask-operation-feedback')]
      .find((feedback) => feedback.dataset.pointaskThreadId === id)?.remove();
    this.removeAnswerAction(id);
  }

  private isReliableCurrentCandidate(id: string, candidate: CandidateAnswer): boolean {
    if (this.records.get(id)?.localThread.answerMode !== 'current_conversation') return false;
    return this.isReliableCandidate(id, candidate);
  }

  private isReliableCandidate(id: string, candidate: CandidateAnswer): boolean {
    if (!this.reliableCandidateIds.has(id) || candidate.streaming) return false;
    for (const [otherId, other] of this.candidates) {
      if (otherId !== id && other.fingerprint === candidate.fingerprint) return false;
    }
    const record = this.records.get(id);
    const current = record && this.adapter?.findCandidateAnswer(record.pendingThread.promptHash ?? '', record.pendingThread.assistantFingerprintsBefore ?? []);
    return Boolean(current && current.fingerprint === candidate.fingerprint && current.element === candidate.element && !current.streaming);
  }

  private async attachCurrentWholeAndReturn(id: string): Promise<void> {
    const record = this.records.get(id); const candidate = this.candidates.get(id);
    if (!record || record.localThread.answerMode !== 'current_conversation' || !candidate || candidate.streaming || this.attachingIds.has(id) ||
      !this.isReliableCurrentCandidate(id, candidate)) return;
    this.attachingIds.add(id); this.errors.delete(id); this.syncCurrentAnswerActions();
    try {
      const richContent = this.adapter?.getMessageRichContent(candidate.element);
      if (!richContent?.blocks.length) throw new Error('无法安全读取这条回答');
      const updated = await this.bridge.attachAnswer(id, richPlainText(richContent.blocks), false, window.location.href, richContent.blocks, {
        conversationUrl: window.location.href,
        conversationKey: this.adapter?.getConversationKey() ?? window.location.href,
        messageFingerprint: candidate.fingerprint,
      });
      await this.finishCurrentAttachment(id, updated);
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '附加失败，请重试');
    } finally {
      this.attachingIds.delete(id); this.syncCurrentAnswerActions(); this.render();
    }
  }

  async attachCurrentSelection(data: SelectionData, association: PendingAssociation): Promise<boolean> {
    const id = association.pendingThread.id; const record = this.records.get(id); const candidate = this.candidates.get(id);
    if (this.partialSelectionId !== id || !record || record.localThread.answerMode !== 'current_conversation' || !candidate ||
      data.messageFingerprint !== candidate.fingerprint || data.sourceMessageElement !== candidate.element || this.attachingIds.has(id)) return false;
    this.attachingIds.add(id); this.errors.delete(id); this.syncCurrentAnswerActions();
    try {
      const updated = await this.bridge.attachAnswer(id, data.selectedText, false, window.location.href, data.richSelection?.blocks, {
        conversationUrl: window.location.href, conversationKey: data.conversationKey, messageFingerprint: data.messageFingerprint,
        selectedText: data.selectedText, prefixText: data.textAnchor?.prefixText, suffixText: data.textAnchor?.suffixText,
      });
      await this.finishCurrentAttachment(id, updated);
      return true;
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '附加失败，请重试');
      return false;
    } finally {
      this.attachingIds.delete(id); this.syncCurrentAnswerActions(); this.render();
    }
  }

  private async finishCurrentAttachment(id: string, updated: PendingAssociation): Promise<void> {
    this.acceptRecord(updated); this.partialSelectionId = this.partialSelectionId === id ? null : this.partialSelectionId;
    this.candidates.delete(id); this.reliableCandidateIds.delete(id); this.removeAnswerAction(id);
    await this.returnToSourceThread(id);
    this.records.delete(id); this.clearCurrentUi(id); this.render();
  }

  private async returnCurrentOnly(id: string): Promise<void> {
    if (this.partialSelectionId === id) this.partialSelectionId = null;
    this.returnedIds.add(id); this.removeAnswerAction(id);
    await this.returnToSourceThread(id);
    this.render();
  }

  private async attachWhole(id: string, returnAfter = false): Promise<void> {
    const record = this.records.get(id); const candidate = this.candidates.get(id);
    if (!record || !candidate || candidate.streaming) return;
    if (record.localThread.answerMode === 'current_conversation') return this.attachCurrentWholeAndReturn(id);
    if (!this.isReliableCandidate(id, candidate)) {
      this.errors.set(id, '回答匹配不唯一，请框选需要附加的内容'); this.render(); return;
    }
    if (this.authorizer && !(await this.authorizer.authorize())) return;
    try {
      const richContent = this.adapter?.getMessageRichContent(candidate.element);
      if (!richContent?.blocks.length) throw new Error('无法安全读取这条回答');
      const updated = await this.bridge.attachAnswer(
        id,
        richPlainText(richContent.blocks),
        record.localThread.status === 'answer_attached',
        window.location.href,
        richContent.blocks,
        {
          conversationUrl: window.location.href,
          conversationKey: this.adapter?.getConversationKey() ?? window.location.href,
          messageFingerprint: candidate.fingerprint,
        },
      );
      if (updated.localThread.answerMode === 'current_conversation' && updated.localThread.status === 'answer_attached') this.records.delete(id);
      else this.acceptRecord(updated);
      showAttachmentUndo(this.bridge, updated, (restored) => { this.acceptRecord(restored); this.render(); });
      this.candidates.delete(id);
      this.render();
      if (returnAfter) await this.returnToSourceThread(id);
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '附加失败');
      this.render();
    }
  }

  private selectPartial(id: string): void {
    const candidate = this.candidates.get(id);
    if (this.records.get(id)?.localThread.answerMode === 'current_conversation') this.partialSelectionId = id;
    if (candidate) candidate.element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    this.errors.set(id, '请框选需要的回答内容，然后点击“附加到 PointAsk”');
    this.render();
  }

  private async undo(id: string): Promise<void> {
    try { const record = await this.bridge.undoAttachment(id); this.acceptRecord(record); this.refreshCandidates(); this.render(); }
    catch (error) { this.errors.set(id, error instanceof Error ? error.message : '撤销失败'); this.render(); }
  }

  private async returnToSourceThread(id: string): Promise<boolean> {
    const record = this.records.get(id); if (!record) return false;
    if (record.localThread.answerMode === 'current_conversation') {
      if (record.localThread.status === 'answer_attached') await this.bridge.returnToSource(id);
      if (this.returnToThreadHandler?.(id)) return true;
      const resolution = this.adapter?.resolveTextAnchor(record.pendingThread.anchor, true);
      if (resolution?.status === 'resolved' && resolution.element) {
        if (record.pendingThread.viewAnchor) {
          new ViewAnchorController().restore(resolution.element, record.pendingThread.viewAnchor, true, this.adapter?.getScrollContainer(resolution.element) ?? window);
        } else {
          resolution.element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }
      }
      return true;
    }
    try {
      logWorkspaceAttach({ threadId: record.localThread.id, selectedRoundIds: [], validRoundIds: [], rejectedRounds: [], phase: 'navigate' });
      await this.bridge.returnToSource(id);
      this.returnFailedIds.delete(id);
      this.errors.delete(id);
      showOperationToast('已返回原文');
      return true;
    } catch (error) {
      const hasAttachedRound = threadRounds(record.localThread, record.pendingThread).some((round) => round.status === 'attached');
      logWorkspaceAttach({ threadId: record.localThread.id, selectedRoundIds: [], validRoundIds: [], rejectedRounds: [], phase: 'navigate', error });
      if (hasAttachedRound) {
        this.returnFailedIds.add(id);
        this.errors.set(id, '内容已附加，但未能返回原页面');
      } else {
        this.errors.set(id, error instanceof Error ? error.message : '返回原文失败，请重试');
      }
      this.render();
      return false;
    }
  }

  private async associate(id: string, confirmed: boolean): Promise<void> {
    const current = this.records.get(id);
    if (!confirmed && this.confirmingIds.has(id)) {
      this.confirmingIds.delete(id);
      this.render();
      return;
    }
    if (!confirmed && current?.targetTabId !== undefined) {
      this.confirmingIds.add(id);
      this.render();
      return;
    }
    try {
      const record = await this.bridge.associateCurrentPage(id, window.location.href, confirmed);
      this.confirmingIds.delete(id);
      this.acceptRecord(record);
      this.render();
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '关联失败');
      this.render();
    }
  }

  private async cancel(id: string): Promise<void> {
    try {
      await this.bridge.cancel(id);
      this.records.delete(id); this.clearCurrentUi(id);
      this.render();
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '取消失败');
      this.render();
    }
  }
}
