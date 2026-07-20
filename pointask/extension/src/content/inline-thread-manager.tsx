import { createRoot, type Root } from 'react-dom/client';
import type { ClipboardManager } from '../bridge/clipboard-manager';
import type { PendingThreadManager } from '../bridge/pending-thread-manager';
import { buildPrompt, type PromptMode } from '../bridge/prompt-builder';
import type { PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { ThreadCard } from '../components/thread-card';
import type { LocalMessage, LocalThread, TextAnchor } from '../shared/local-thread';
import { stableTextHash } from '../shared/text-utils';
import type { SelectionData } from './selection-manager';
import { threadMenuOverlayStyles, threadStyles } from './shadow-styles';
import type { ThreadStore } from '../storage/thread-store';
import type { PendingStore } from '../storage/pending-store';
import type { MetricsStore } from '../storage/metrics-store';
import type { WorkspaceStore } from '../storage/workspace-store';
import type { AnswerMode, PointAskWorkspace } from '../shared/local-thread';
import { richPlainText, textBlocks } from '../shared/rich-content';
import { richContentStyles } from '../components/rich-content-renderer';
import { ViewAnchorController } from './view-anchor-controller';
import type { SiteAdapter } from '../adapters/site-adapter';
import { applyPointAskTheme } from './theme';
import type { OperationAuthorizer } from './operation-authorizer';
import { showOperationToast } from './operation-feedback';

interface MountedThread {
  host: HTMLElement;
  root: Root;
  thread: LocalThread;
  copied: boolean;
  error?: string;
  manualBranch: boolean;
  anchorElement: HTMLElement;
  workspace?: PointAskWorkspace;
}

let nextMessageId = 1;

function createMessageId(now: Date): string {
  return `pointask-message-${now.getTime()}-${nextMessageId++}`;
}

function toAnchor(data: SelectionData): TextAnchor {
  return data.textAnchor ?? {
    pageUrl: data.sourcePageUrl,
    selectedText: data.selectedText,
    prefixText: '',
    suffixText: '',
    paragraphText: data.paragraphText,
    paragraphHash: stableTextHash(data.paragraphText),
    messageFingerprint: data.messageFingerprint,
    assistantMessageHash: data.messageFingerprint || stableTextHash(data.paragraphText),
    conversationKey: data.conversationKey,
    sourcePageUrl: data.sourcePageUrl,
    startOffset: 0,
    endOffset: data.selectedText.length,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
  };
}

export class InlineThreadManager {
  private readonly mounted = new Map<string, MountedThread>();
  private readonly expandedIds = new Set<string>();
  private continueHandler: ((id: string, thread: LocalThread, anchorElement: HTMLElement) => void) | null = null;
  private defaultPromptMode: PromptMode = 'compact';
  private expandNewThreads = false;
  private currentConversationScrollBehavior: 'stay_at_source' | 'follow_response' = 'stay_at_source';
  private readonly viewAnchors = new Map<string, ViewAnchorController>();
  private readonly highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sendingIds = new Set<string>();
  private readonly openingTargetIds = new Set<string>();
  private readonly menuOverlayHost: HTMLElement;
  private readonly menuOverlay: HTMLElement;
  private workspaceContextHandler: ((workspace: PointAskWorkspace, threadId: string) => void) | null = null;

  constructor(
    private readonly pendingThreads: PendingThreadManager,
    private readonly clipboard: ClipboardManager,
    private readonly webBridge?: WebConversationBridge,
    private readonly rootFactory: (container: Element | DocumentFragment) => Root = createRoot,
    private readonly now: () => Date = () => new Date(),
    private readonly threadStore?: ThreadStore,
    private readonly pendingStore?: PendingStore,
    private readonly metrics?: MetricsStore,
    private readonly workspaceStore?: WorkspaceStore,
    private readonly siteAdapter?: SiteAdapter,
    private readonly operationAuthorizer?: OperationAuthorizer,
  ) {
    this.menuOverlayHost = document.createElement('pointask-thread-menu-overlay');
    this.menuOverlayHost.dataset.pointaskOwned = 'true';
    const shadow = this.menuOverlayHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = threadMenuOverlayStyles;
    this.menuOverlay = document.createElement('div'); this.menuOverlay.className = 'pointask-thread-menu-overlay';
    shadow.append(style, this.menuOverlay); document.documentElement.append(this.menuOverlayHost);
  }

  async create(
    data: SelectionData,
    question: string,
    answerMode: AnswerMode = 'workspace',
    mode: PromptMode = this.defaultPromptMode,
    previousLocalMessages: LocalMessage[] = [],
  ): Promise<string | null> {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !data.messageFingerprint) return null;
    const anchor = toAnchor(data);
    const displayId = this.threadStore
      ? await this.threadStore.allocateDisplayId(data.conversationKey)
      : `PA-${String(this.mounted.size + 1).padStart(3, '0')}`;
    let workspace: PointAskWorkspace | null = null;
    if (answerMode === 'workspace' && this.workspaceStore) {
      const timestamp = this.now().toISOString();
      const contextMessages = this.siteAdapter?.getConversationContextMessages() ?? [];
      workspace = await this.workspaceStore.createOrIncrement({
        id: `pointask-workspace-${stableTextHash(data.conversationKey)}`,
        sourceConversationKey: data.conversationKey,
        sourceConversationUrl: data.sourcePageUrl,
        workspaceType: 'new_conversation',
        threadCount: 0,
        approximateContentLength: 0,
        contextState: {
          contextVersion: 1,
          lastSyncedMessageFingerprint: contextMessages.at(-1)?.fingerprint,
          syncedAt: timestamp,
          unsyncedMessageCount: 0,
          unsyncedTurnCount: 0,
          status: contextMessages.length ? 'fresh' : 'unknown',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }, data.selectedText.length + data.paragraphText.length + trimmedQuestion.length);
    }
    const generatedPrompt = buildPrompt({
      selectedText: data.selectedText,
      paragraphText: data.paragraphText,
      assistantMessageText: data.assistantMessageText,
      userQuestion: trimmedQuestion,
      previousLocalMessages,
      mode,
      answerMode,
      displayId,
      contextVersion: workspace?.contextState.contextVersion,
    });
    const threadTimestamp = this.now().toISOString();
    const pending = this.pendingThreads.create({
      anchor, question: trimmedQuestion, generatedPrompt, promptMode: mode,
      displayId, answerMode, workspaceId: workspace?.id,
      richSelection: data.richSelection ?? { plainText: data.selectedText, blocks: textBlocks(data.selectedText) },
      promptHash: stableTextHash(generatedPrompt),
      assistantFingerprintsBefore: data.assistantFingerprintsBefore ?? [],
      viewAnchor: answerMode === 'current_conversation' ? {
        sourceMessageFingerprint: data.messageFingerprint,
        blockFingerprint: stableTextHash(data.paragraphText),
        viewportOffsetTop: data.anchorElement.getBoundingClientRect().top,
        scrollY: window.scrollY,
        capturedAt: threadTimestamp,
      } : undefined,
    });
    if (!pending) return null;
    const timestamp = this.now().toISOString();
    const userMessage: LocalMessage = {
      id: createMessageId(this.now()),
      role: 'user',
      content: textBlocks(trimmedQuestion),
      attachedManually: false,
      createdAt: timestamp,
    };
    pending.roundId = userMessage.id;
    const thread: LocalThread = {
      id: pending.id,
      displayId,
      answerMode,
      workspaceId: workspace?.id,
      dedicatedConversationUrl: answerMode === 'dedicated_branch' ? undefined : undefined,
      richSelection: data.richSelection ?? { plainText: data.selectedText, blocks: textBlocks(data.selectedText) },
      anchor,
      sourcePageUrl: data.sourcePageUrl,
      sourceConversationKey: data.conversationKey,
      sourceMessageFingerprint: data.messageFingerprint,
      messages: [...previousLocalMessages, userMessage],
      rounds: [{
        id: userMessage.id, pendingId: pending.id, promptHash: pending.promptHash ?? stableTextHash(generatedPrompt),
        assistantFingerprintsBefore: pending.assistantFingerprintsBefore ?? [], status: 'waiting_for_submission',
        persistenceStatus: 'not_captured',
        createdAt: timestamp, updatedAt: timestamp,
      }],
      targetConversationUrl: answerMode === 'current_conversation' ? data.sourcePageUrl : workspace?.targetConversationUrl,
      status: 'prompt_ready',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.mount(thread, data.anchorElement);
    if (this.expandNewThreads) this.expandedIds.add(thread.id);
    else this.expandedIds.delete(thread.id);
    thread.expanded = this.expandedIds.has(thread.id);
    this.renderAll();
    await Promise.all([this.threadStore?.upsert(thread), this.pendingStore?.upsert(pending), this.metrics?.increment('questionsCreated')]);
    return thread.id;
  }

  async startAnswerFlow(id: string): Promise<boolean> {
    const item = this.mounted.get(id);
    const pending = this.pendingThreads.get(id);
    if (!item || !pending) return false;
    if (item.thread.answerMode === 'current_conversation') {
      if (!this.webBridge) return false;
      try {
        await this.webBridge.savePendingThread(pending, item.thread);
        const record = await this.webBridge.associateCurrentPage(pending.id, item.thread.sourcePageUrl, true);
        const waiting = this.pendingThreads.markWaitingForSubmission(id);
        item.thread = { ...record.localThread, status: 'waiting_for_submission' };
        if (waiting) await this.webBridge.updateLocalThread(waiting, item.thread);
        void Promise.all([this.threadStore?.upsert(item.thread), waiting && this.pendingStore?.upsert(waiting)]);
        this.render(id);
        return true;
      } catch (error) {
        item.error = error instanceof Error ? error.message : '无法关联当前对话'; this.render(id); return false;
      }
    }
    return true;
  }

  async confirmAnswerModeAndSend(id: string): Promise<boolean> {
    if (!(await this.startAnswerFlow(id))) return false;
    const mode = this.mounted.get(id)?.thread.answerMode;
    if (mode === 'current_conversation') return this.sendCurrentConversation(id);
    return this.copyAndOpenTarget(id);
  }

  private async recordSendFailure(id: string, error: unknown): Promise<void> {
    const item = this.mounted.get(id);
    const pending = this.pendingThreads.get(id);
    if (!item || !pending) return;
    item.error = error instanceof Error ? error.message : '发送失败，请重试';
    if (pending.submittedPromptHash === pending.promptHash) return;
    const failedPending = this.pendingThreads.markFailed(id);
    if (!failedPending) return;
    item.thread = { ...item.thread, status: 'failed', updatedAt: this.now().toISOString() };
    await Promise.all([
      this.threadStore?.upsert(item.thread),
      this.pendingStore?.upsert(failedPending),
      this.webBridge?.updateLocalThread(failedPending, item.thread).catch(() => undefined),
    ]);
  }

  private placeHost(anchorElement: HTMLElement, host: HTMLElement): void {
    let sibling = anchorElement.nextElementSibling;
    let lastOwned: Element = anchorElement;
    while (sibling?.matches('pointask-inline-thread[data-pointask-owned="true"]')) {
      if (sibling === host) return;
      lastOwned = sibling;
      sibling = sibling.nextElementSibling;
    }
    lastOwned.insertAdjacentElement('afterend', host);
  }

  mount(thread: LocalThread, anchorElement: HTMLElement): boolean {
    const existing = this.mounted.get(thread.id);
    if (existing?.host.isConnected) {
      existing.thread = thread;
      existing.anchorElement = anchorElement;
      this.placeHost(anchorElement, existing.host);
      if (thread.expanded) this.expandedIds.add(thread.id);
      else this.expandedIds.delete(thread.id);
      this.render(thread.id);
      return false;
    }
    if (existing) { existing.root.unmount(); this.mounted.delete(thread.id); }
    const host = document.createElement('pointask-inline-thread');
    host.dataset.pointaskOwned = 'true';
    host.dataset.pointaskThreadId = thread.id;
    applyPointAskTheme(host, anchorElement);
    applyPointAskTheme(this.menuOverlayHost, anchorElement);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${threadStyles}\n${richContentStyles}`;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    this.placeHost(anchorElement, host);
    this.mounted.set(thread.id, { host, root: this.rootFactory(mount), thread, copied: false, manualBranch: false, anchorElement });
    if (thread.workspaceId && this.workspaceStore) void this.workspaceStore.get(thread.workspaceId).then((workspace) => {
      const mounted = this.mounted.get(thread.id); if (mounted && workspace) { mounted.workspace = workspace; this.render(thread.id); }
    });
    if (thread.expanded) this.expandedIds.add(thread.id);
    else this.expandedIds.delete(thread.id);
    this.render(thread.id);
    return true;
  }

  toggle(id: string): void {
    const item = this.mounted.get(id);
    if (!item) return;
    const viewportTop = item.host.getBoundingClientRect().top;
    const timestamp = this.now().toISOString();
    if (this.expandedIds.has(id)) this.expandedIds.delete(id);
    else this.expandedIds.add(id);
    const expanded = this.expandedIds.has(id);
    item.thread = { ...item.thread, expanded, updatedAt: timestamp };
    void this.threadStore?.setExpanded(id, expanded, timestamp);
    void this.metrics?.increment('threadsExpanded');
    this.render(id);
    this.stabilizeCardPosition(id, viewportTop);
  }

  async toggleRound(id: string, roundId: string): Promise<void> {
    const item = this.mounted.get(id);
    if (!item) return;
    const viewportTop = item.host.getBoundingClientRect().top;
    const thread = item.thread;
    const userRoundIds = thread.messages.filter((message) => message.role === 'user').map((message) => message.id);
    const collapsed = new Set(thread.collapsedRoundIds ?? userRoundIds.slice(0, -1));
    if (collapsed.has(roundId)) collapsed.delete(roundId);
    else collapsed.add(roundId);
    const nextCollapsedRoundIds = [...collapsed].filter((messageId) => userRoundIds.includes(messageId));
    const timestamp = this.now().toISOString();
    item.thread = {
      ...thread,
      collapsedRoundIds: nextCollapsedRoundIds,
      updatedAt: timestamp,
    };
    await this.threadStore?.upsert(item.thread);
    this.render(id);
    this.stabilizeCardPosition(id, viewportTop);
  }

  private stabilizeCardPosition(id: string, viewportTop: number): void {
    const schedule = window.requestAnimationFrame?.bind(window) ?? ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    schedule(() => {
      const item = this.mounted.get(id);
      if (!item?.host.isConnected) return;
      const delta = item.host.getBoundingClientRect().top - viewportTop;
      if (Math.abs(delta) < 1) return;
      const target = this.siteAdapter?.getScrollContainer(item.anchorElement) ?? window;
      if (typeof target.scrollBy === 'function') target.scrollBy({ top: delta, behavior: 'auto' });
      else if (target instanceof HTMLElement) target.scrollTop += delta;
    });
  }

  async copy(id: string): Promise<boolean> {
    const item = this.mounted.get(id);
    const pending = this.pendingThreads.get(id);
    if (!item || !pending || pending.status !== 'prompt_ready') return false;
    const result = await this.clipboard.copy(pending.generatedPrompt);
    if (!this.mounted.has(id)) return result.success;
    item.copied = result.success;
    item.error = result.success ? undefined : result.error;
    this.render(id);
    if (result.success) void this.metrics?.increment('promptsCopied');
    return result.success;
  }

  next(id: string): void {
    const item = this.mounted.get(id);
    if (!item || !this.pendingThreads.markWaitingForAnswer(id)) return;
    item.thread = { ...item.thread, status: 'waiting_for_answer', updatedAt: this.now().toISOString() };
    this.render(id);
  }

  async copyAndOpenTarget(id: string): Promise<boolean> {
    const item = this.mounted.get(id);
    const pending = this.pendingThreads.get(id);
    if (!item || !pending || !this.webBridge || this.openingTargetIds.has(id)) return false;
    this.openingTargetIds.add(id);
    try {
      await this.webBridge.savePendingThread(pending, item.thread);
      const workspaceAttemptId = `pointask-attempt-${typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      const workspaceResult = item.thread.answerMode === 'workspace'
        ? await this.webBridge.openOrAutoSendWorkspace(pending.id, pending.promptHash ?? '', workspaceAttemptId)
        : null;
      const record = workspaceResult?.record ?? (item.thread.targetConversationUrl
        ? await this.webBridge.openAnswerPage(pending.id)
        : await this.webBridge.openTargetChat(pending.id));
      const updatedPending = this.pendingThreads.markWaitingForSubmission(id);
      if (updatedPending && !workspaceResult?.autoSent) await this.webBridge.savePendingThread(updatedPending, record.localThread);
      this.pendingThreads.restore(record.pendingThread);
      item.thread = record.localThread;
      void this.metrics?.increment('targetPagesOpened');
      this.render(id);
      return true;
    } catch (error) {
      item.error = error instanceof Error ? error.message : '无法打开目标页面';
      this.render(id);
      return false;
    } finally { this.openingTargetIds.delete(id); }
  }

  async sendCurrentConversation(id: string): Promise<boolean> {
    const item = this.mounted.get(id); let pending = this.pendingThreads.get(id);
    if (!item || !pending || item.thread.answerMode !== 'current_conversation' || !this.webBridge || !this.siteAdapter || this.sendingIds.has(id)) return false;
    if (pending.submittedPromptHash === pending.promptHash) { item.error = '该问题已经发送'; this.render(id); return false; }
    this.sendingIds.add(id); item.error = undefined;
    pending = this.pendingThreads.markWaitingForSubmission(id) ?? pending;
    item.thread = { ...item.thread, status: 'waiting_for_submission', updatedAt: this.now().toISOString() };
    this.render(id);
    try {
      if (this.siteAdapter.getConversationKey() !== item.thread.sourceConversationKey) throw new Error('当前页面与线程不匹配');
      if (!this.siteAdapter.fillComposer(pending.generatedPrompt)) throw new Error('当前对话暂时无法发送，请重试');
      let ready = this.siteAdapter.canSubmitComposer();
      for (let attempt = 0; !ready && attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50)); ready = this.siteAdapter.canSubmitComposer();
      }
      if (!ready) throw new Error('发送按钮当前不可用');
      const record = await this.webBridge.reservePromptSubmission(pending.id, pending.promptHash ?? '', window.location.href);
      if (!this.siteAdapter.submitComposer()) {
        await this.webBridge.releasePromptSubmission(pending.id, pending.promptHash ?? '').catch(() => undefined);
        throw new Error('发送失败，请重试');
      }
      this.pendingThreads.restore(record.pendingThread); item.thread = record.localThread;
      void Promise.all([this.threadStore?.upsert(item.thread), this.pendingStore?.upsert(record.pendingThread)]);
      showOperationToast('已发送'); this.render(id); return true;
    } catch (error) {
      await this.recordSendFailure(id, error); return false;
    } finally { this.sendingIds.delete(id); this.render(id); }
  }

  async prepareManualBranch(id: string): Promise<boolean> {
    const item = this.mounted.get(id);
    const pending = this.pendingThreads.get(id);
    if (!item || !pending || !this.webBridge) return false;
    try {
      await this.webBridge.savePendingThread(pending, item.thread);
      const record = await this.webBridge.prepareManualBranch(pending.id);
      item.thread = record.localThread;
      item.manualBranch = true;
      void this.metrics?.increment('targetsAssociated');
      this.render(id);
      return true;
    } catch (error) {
      item.error = error instanceof Error ? error.message : '无法准备手动分支';
      this.render(id);
      return false;
    }
  }

  cancel(id: string): void {
    const item = this.mounted.get(id); if (!item) return;
    const pending = this.pendingThreads.markFailed(id);
    item.thread = { ...item.thread, status: item.thread.messages.at(-1)?.role === 'assistant' ? 'answer_attached' : 'failed', updatedAt: this.now().toISOString() };
    this.viewAnchors.get(id)?.stop(); this.viewAnchors.delete(id);
    void Promise.all([this.threadStore?.upsert(item.thread), pending && this.pendingStore?.upsert(pending)]);
    void this.webBridge?.cancel(this.pendingThreads.get(id)?.id ?? id).catch(() => undefined); this.render(id);
  }

  delete(id: string): void {
    const item = this.mounted.get(id);
    if (!item) return;
    if (item.thread.workspaceId && this.workspaceStore) {
      void this.workspaceStore.get(item.thread.workspaceId).then((workspace) => workspace && this.workspaceStore?.upsert({
        ...workspace,
        threadCount: Math.max(0, workspace.threadCount - 1),
        updatedAt: this.now().toISOString(),
      }));
    }
    this.pendingThreads.delete(id);
    const removePersisted = () => Promise.all([this.threadStore?.delete(id), this.pendingStore?.delete(id), this.metrics?.increment('threadsDeleted')]);
    if (this.webBridge && item.thread.status !== 'draft') void this.webBridge.cancel(this.pendingThreads.get(id)?.id ?? id).then(removePersisted, removePersisted);
    else void removePersisted();
    item.root.unmount();
    this.viewAnchors.get(id)?.stop(); this.viewAnchors.delete(id);
    item.host.remove();
    this.mounted.delete(id);
    this.expandedIds.delete(id);
    const highlightTimer = this.highlightTimers.get(id); if (highlightTimer) clearTimeout(highlightTimer); this.highlightTimers.delete(id);
  }

  handleAssociationUpdate(record: PendingAssociation): void {
    const threadId = record.pendingThread.threadId || record.pendingThread.id;
    const item = this.mounted.get(threadId);
    if (!item) return;
    if (record.associationStatus === 'cancelled') {
      this.pendingThreads.delete(record.pendingThread.id);
      return;
    }
    this.pendingThreads.restore(record.pendingThread);
    const wasAttached = item.thread.status === 'answer_attached';
    const previousLatestRoundId = [...item.thread.messages].reverse().find((message) => message.role === 'user')?.id;
    const previousLatestHadAnswer = item.thread.messages.at(-1)?.role === 'assistant';
    item.thread = record.localThread;
    if (item.thread.status !== 'failed') item.error = undefined;
    if (item.thread.answerMode === 'dedicated_branch' && record.targetConversationUrl) {
      item.thread = { ...item.thread, dedicatedConversationUrl: record.targetConversationUrl };
    }
    if (item.thread.answerMode === 'workspace' && item.thread.workspaceId && record.targetConversationUrl && this.workspaceStore) {
      void this.workspaceStore.get(item.thread.workspaceId).then((workspace) => workspace && this.workspaceStore?.upsert({
        ...workspace,
        targetConversationUrl: record.targetConversationUrl,
        targetConversationKey: record.targetConversationUrl,
        updatedAt: this.now().toISOString(),
      }));
    }
    const latestRoundId = [...item.thread.messages].reverse().find((message) => message.role === 'user')?.id;
    const latestHasAnswer = item.thread.messages.at(-1)?.role === 'assistant';
    if (latestRoundId && latestHasAnswer && (!previousLatestHadAnswer || previousLatestRoundId !== latestRoundId)) {
      const userRoundIds = item.thread.messages.filter((message) => message.role === 'user').map((message) => message.id);
      const collapsed = new Set(item.thread.collapsedRoundIds ?? userRoundIds.slice(0, -1));
      collapsed.delete(latestRoundId);
      item.thread = { ...item.thread, collapsedRoundIds: [...collapsed] };
    }
    if (!wasAttached && item.thread.status === 'answer_attached' && item.thread.answerMode === 'current_conversation') {
      this.expandedIds.add(item.thread.id);
      item.thread = { ...item.thread, expanded: true };
      item.host.classList.add('pointask-thread-highlight');
      const previousTimer = this.highlightTimers.get(item.thread.id); if (previousTimer) clearTimeout(previousTimer);
      this.highlightTimers.set(item.thread.id, setTimeout(() => {
        item.host.classList.remove('pointask-thread-highlight'); this.highlightTimers.delete(item.thread.id);
      }, 1_800));
    }
    void this.threadStore?.upsert(item.thread);
    if (!wasAttached && item.thread.status === 'answer_attached') void this.metrics?.increment('answersAttached');
    if (item.thread.status === 'answer_attached') { this.viewAnchors.get(item.thread.id)?.stop(); this.viewAnchors.delete(item.thread.id); }
    this.render(threadId);
  }

  setContinueHandler(handler: (id: string, thread: LocalThread, anchorElement: HTMLElement) => void): void {
    this.continueHandler = handler;
  }

  setWorkspaceContextHandler(handler: (workspace: PointAskWorkspace, threadId: string) => void): void {
    this.workspaceContextHandler = handler;
  }

  async refreshWorkspaceContextProgress(): Promise<void> {
    if (!this.workspaceStore || !this.siteAdapter) return;
    const messages = this.siteAdapter.getConversationContextMessages();
    const ids = new Set([...this.mounted.values()].map((item) => item.thread.workspaceId).filter((id): id is string => Boolean(id)));
    for (const id of ids) {
      const workspace = await this.workspaceStore.updateContextProgress(id, messages);
      for (const [threadId, item] of this.mounted) if (item.thread.workspaceId === id) { item.workspace = workspace ?? undefined; this.render(threadId); }
    }
  }

  async continueThread(id: string, question: string): Promise<boolean> {
    const item = this.mounted.get(id);
    const currentPending = this.pendingThreads.get(id);
    const trimmedQuestion = question.trim();
    if (!item || !currentPending || !trimmedQuestion || item.thread.status !== 'answer_attached') return false;
    const workspace = item.thread.workspaceId && this.workspaceStore ? await this.workspaceStore.get(item.thread.workspaceId) : item.workspace;
    if (workspace) item.workspace = workspace;
    const generatedPrompt = buildPrompt({
      selectedText: item.thread.anchor.selectedText,
      paragraphText: item.thread.anchor.paragraphText,
      userQuestion: trimmedQuestion,
      previousLocalMessages: item.thread.messages,
      mode: 'compact',
      answerMode: item.thread.answerMode,
      displayId: item.thread.displayId,
      contextVersion: workspace?.contextState.contextVersion,
    });
    const timestamp = this.now().toISOString();
    const questionMessage: LocalMessage = {
      id: createMessageId(this.now()),
      role: 'user',
      content: textBlocks(trimmedQuestion),
      attachedManually: false,
      createdAt: timestamp,
    };
    const pending = this.pendingThreads.prepareNext(id, trimmedQuestion, generatedPrompt, 'compact', this.siteAdapter?.getAssistantMessageFingerprints(), questionMessage.id);
    if (!pending) return false;
    item.thread = {
      ...item.thread,
      messages: [...item.thread.messages, questionMessage],
      status: 'waiting_for_submission',
      updatedAt: timestamp,
    };
    void this.metrics?.increment('followUpsContinued');
    item.copied = false;
    this.render(id);
    if (!this.webBridge) return true;
    try {
      const created = await this.webBridge.savePendingThread(pending, item.thread);
      this.pendingThreads.restore(created.pendingThread);
      item.thread = created.localThread;
      await this.pendingStore?.replaceForThread(pending);
      await this.threadStore?.upsert(item.thread);
      this.render(id);
      return this.confirmAnswerModeAndSend(id);
    } catch (error) {
      item.error = error instanceof Error ? error.message : '无法继续追问';
      this.render(id);
      return false;
    }
  }

  async deleteRound(id: string, userMessageId: string): Promise<boolean> {
    const item = this.mounted.get(id);
    const pending = this.pendingThreads.get(id);
    if (!item || !pending) return false;
    const start = item.thread.messages.findIndex((message) => message.id === userMessageId && message.role === 'user');
    if (start < 0) return false;
    const nextUser = item.thread.messages.findIndex((message, index) => index > start && message.role === 'user');
    const end = nextUser < 0 ? item.thread.messages.length : nextUser;
    const messages = [...item.thread.messages.slice(0, start), ...item.thread.messages.slice(end)];
    if (!messages.length) {
      this.delete(id);
      return true;
    }
    const timestamp = this.now().toISOString();
    const hadExplicitState = Array.isArray(item.thread.collapsedRoundIds);
    item.thread = {
      ...item.thread,
      messages,
      status: messages.at(-1)?.role === 'assistant' ? 'answer_attached' : 'waiting_for_answer',
      updatedAt: timestamp,
    };
    const collapsed = new Set(item.thread.collapsedRoundIds ?? []);
    collapsed.delete(userMessageId);
    const latestRoundId = messages.filter((message) => message.role === 'user').at(-1)?.id;
    if (latestRoundId) collapsed.delete(latestRoundId);
    item.thread.collapsedRoundIds = hadExplicitState ? [...collapsed] : undefined;
    const lastQuestionBlocks = [...messages].reverse().find((message) => message.role === 'user')?.content;
    const lastQuestion = lastQuestionBlocks ? richPlainText(lastQuestionBlocks) : '';
    const updatedPending = lastQuestion ? this.pendingThreads.updateQuestion(id, lastQuestion) : pending;
    this.render(id);
    if (this.webBridge && updatedPending) await this.webBridge.updateLocalThread(updatedPending, item.thread);
    void this.threadStore?.upsert(item.thread);
    return true;
  }

  async unlinkTarget(id: string): Promise<boolean> {
    const item = this.mounted.get(id);
    if (!item || !this.webBridge) return false;
    try {
      const record = await this.webBridge.unlinkTargetPage(this.pendingThreads.get(id)?.id ?? id);
      item.thread = record.localThread;
      if (item.thread.answerMode === 'workspace' && item.thread.workspaceId && this.workspaceStore) {
        const workspace = await this.workspaceStore.get(item.thread.workspaceId);
        if (workspace) {
          const { targetConversationUrl: _url, targetConversationKey: _key, ...unlinked } = workspace;
          void _url; void _key;
          await this.workspaceStore.upsert(unlinked);
        }
      }
      item.manualBranch = false;
      this.render(id);
      return true;
    } catch (error) {
      item.error = error instanceof Error ? error.message : '解除关联失败';
      this.render(id);
      return false;
    }
  }

  async createNewWorkspace(id: string): Promise<boolean> {
    const item = this.mounted.get(id);
    if (!item || item.thread.answerMode !== 'workspace' || !this.workspaceStore || !this.threadStore) return false;
    const timestamp = this.now().toISOString();
    const workspaceThreads = (await this.threadStore.listByConversation(item.thread.sourceConversationKey))
      .filter((thread) => thread.answerMode === 'workspace');
    const workspace = await this.workspaceStore.replaceForSource({
      id: `pointask-workspace-${stableTextHash(`${item.thread.sourceConversationKey}|${timestamp}`)}`,
      sourceConversationKey: item.thread.sourceConversationKey,
      sourceConversationUrl: item.thread.sourcePageUrl,
      workspaceType: 'new_conversation', threadCount: workspaceThreads.length,
      approximateContentLength: workspaceThreads.reduce((total, thread) => total + thread.messages.reduce((sum, message) => sum + richPlainText(message.content).length, 0), 0),
      contextState: { contextVersion: 1, unsyncedMessageCount: 0, unsyncedTurnCount: 0, status: 'unknown' },
      createdAt: timestamp, updatedAt: timestamp,
    });
    await this.threadStore.replaceWorkspace(item.thread.sourceConversationKey, workspace.id);
    if (this.pendingStore) {
      const pending = await this.pendingStore.list();
      await Promise.all(pending.filter((entry) => entry.sourceConversationKey === item.thread.sourceConversationKey && entry.answerMode === 'workspace')
        .map((entry) => this.pendingStore?.upsert({ ...entry, workspaceId: workspace.id, targetConversationUrl: undefined, updatedAt: timestamp })));
    }
    for (const mounted of this.mounted.values()) {
      if (mounted.thread.sourceConversationKey !== item.thread.sourceConversationKey || mounted.thread.answerMode !== 'workspace') continue;
      mounted.thread = { ...mounted.thread, workspaceId: workspace.id, targetConversationUrl: undefined, updatedAt: timestamp };
      this.pendingThreads.updateRouting(mounted.thread.id, 'workspace', workspace.id);
      this.render(mounted.thread.id);
    }
    return true;
  }

  configure(options: { defaultPromptMode: PromptMode; expandNewThreads: boolean; currentConversationScrollBehavior?: 'stay_at_source' | 'follow_response' }): void {
    this.defaultPromptMode = options.defaultPromptMode;
    this.expandNewThreads = options.expandNewThreads;
    this.currentConversationScrollBehavior = options.currentConversationScrollBehavior ?? 'stay_at_source';
    if (this.currentConversationScrollBehavior === 'follow_response') {
      for (const controller of this.viewAnchors.values()) controller.stop();
      this.viewAnchors.clear();
    }
  }

  syncVisible(ids: Set<string>): void {
    for (const [id, item] of this.mounted) {
      if (ids.has(id)) continue;
      item.root.unmount();
      this.viewAnchors.get(id)?.stop(); this.viewAnchors.delete(id);
      item.host.remove();
      this.mounted.delete(id);
      this.expandedIds.delete(id);
      const highlightTimer = this.highlightTimers.get(id); if (highlightTimer) clearTimeout(highlightTimer); this.highlightTimers.delete(id);
    }
  }

  getThread(id: string): LocalThread | null { return this.mounted.get(id)?.thread ?? null; }
  getHost(id: string): HTMLElement | null { return this.mounted.get(id)?.host ?? null; }
  reveal(id: string, roundId?: string): boolean {
    const item = this.mounted.get(id);
    if (!item?.host.isConnected) return false;
    const timestamp = this.now().toISOString();
    this.expandedIds.add(id);
    const collapsed = new Set(item.thread.collapsedRoundIds ?? []); if (roundId) collapsed.delete(roundId);
    item.thread = { ...item.thread, expanded: true, collapsedRoundIds: item.thread.collapsedRoundIds || roundId ? [...collapsed] : undefined, updatedAt: timestamp };
    void this.threadStore?.upsert(item.thread); this.render(id);
    item.host.classList.add('pointask-thread-highlight');
    const previousTimer = this.highlightTimers.get(id); if (previousTimer) clearTimeout(previousTimer);
    this.highlightTimers.set(id, setTimeout(() => {
      item.host.classList.remove('pointask-thread-highlight'); this.highlightTimers.delete(id);
    }, 1_800));
    const schedule = window.requestAnimationFrame?.bind(window) ?? ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    schedule(() => item.host.isConnected && item.host.scrollIntoView?.({ behavior: 'smooth', block: 'center' }));
    return true;
  }
  focus(id: string): void {
    setTimeout(() => this.mounted.get(id)?.host.shadowRoot?.querySelector<HTMLButtonElement>('.pointask-toggle')?.focus());
  }

  private renderAll(): void { for (const id of this.mounted.keys()) this.render(id); }
  private render(id: string): void {
    const item = this.mounted.get(id);
    if (!item) return;
    item.root.render(
      <ThreadCard
        thread={item.thread}
        workspace={item.workspace}
        pending={this.pendingThreads.get(id)}
        copied={item.copied}
        error={item.error}
        manualBranch={item.manualBranch}
        expanded={this.expandedIds.has(id)}
        sending={this.sendingIds.has(id)}
        menuOverlay={this.menuOverlay}
        onToggle={() => this.toggle(id)}
        onDelete={() => this.delete(id)}
        onCopy={() => void this.copy(id)}
        onOpenTarget={() => void (item.thread.answerMode === 'current_conversation' ? this.sendCurrentConversation(id)
          : this.copyAndOpenTarget(id))}
        onManualBranch={() => void this.prepareManualBranch(id)}
        onCancel={() => this.cancel(id)}
        onOpenAnswer={() => {
          if (!this.webBridge) return;
          const pendingId = this.pendingThreads.get(id)?.id ?? id;
          if (item.thread.answerMode === 'current_conversation') void this.webBridge.returnToSource(pendingId).catch(() => undefined);
          else void this.webBridge.openAnswerPage(pendingId).catch(() => undefined);
        }}
        onContinue={() => this.continueHandler?.(id, item.thread, item.anchorElement)}
        onDeleteRound={(messageId) => void this.deleteRound(id, messageId)}
        onModifyAssociation={() => void this.prepareManualBranch(id)}
        onUnlinkAssociation={() => void this.unlinkTarget(id)}
        onNewWorkspace={() => void this.createNewWorkspace(id)}
        onViewAnswer={(locator) => void this.webBridge?.navigateToAnswer(id, locator).catch((error: unknown) => {
          item.error = error instanceof Error ? error.message : '已打开原会话，但未能精确定位原回答';
          this.render(id);
        })}
        onUndoAttachment={() => void this.webBridge?.undoAttachment(this.pendingThreads.get(id)?.id ?? id).then((record) => this.handleAssociationUpdate(record)).catch((error: unknown) => {
          item.error = error instanceof Error ? error.message : '撤销附加失败'; this.render(id);
        })}
        onGoCandidate={() => {
          const candidate = this.pendingThreads.get(id)?.candidateAnswerFingerprint;
          if (!candidate) { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); return; }
          const localCandidate = this.siteAdapter?.findAssistantMessageByFingerprint(candidate);
          if (localCandidate) { localCandidate.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
          if (!this.webBridge) return;
          void this.webBridge.navigateToAnswer(id, {
            conversationUrl: item.thread.targetConversationUrl ?? item.thread.sourcePageUrl,
            conversationKey: item.thread.targetConversationUrl ?? item.thread.sourceConversationKey,
            messageFingerprint: candidate,
          });
        }}
        onUpdateWorkspaceContext={() => item.workspace && this.workspaceContextHandler?.(item.workspace, id)}
        onToggleRound={(roundId) => void this.toggleRound(id, roundId)}
      />,
    );
  }
}
