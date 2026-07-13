import { createRoot, type Root } from 'react-dom/client';
import type { ClipboardManager } from '../bridge/clipboard-manager';
import type { PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { PendingThreadBanner } from '../components/pending-thread-banner';
import { CurrentAnswerActions } from '../components/current-answer-actions';
import { bannerStyles, currentAnswerActionStyles } from './shadow-styles';
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

interface MountedAnswerAction {
  host: HTMLElement;
  root: Root;
  fingerprint: string;
  element: HTMLElement;
}

export class PendingBannerManager {
  private readonly host: HTMLElement;
  private readonly root: Root;
  private records = new Map<string, PendingAssociation>();
  private readonly closedIds = new Set<string>();
  private readonly copiedIds = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly confirmingIds = new Set<string>();
  private cleanupRuntime: (() => void) | null = null;
  private cleanupExecuteSend: (() => void) | null = null;
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

  constructor(
    private readonly bridge: WebConversationBridge,
    private readonly clipboard: ClipboardManager,
    private readonly adapter?: SiteAdapter,
    private readonly authorizer?: OperationAuthorizer,
  ) {
    this.host = document.createElement('pointask-pending-thread-banner');
    this.host.dataset.pointaskOwned = 'true';
    applyPointAskTheme(this.host);
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${bannerStyles}\n${richContentStyles}`;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    document.documentElement.append(this.host);
    this.root = createRoot(mount);
  }

  async start(): Promise<void> {
    const records = await this.bridge.getPagePendingThreads();
    this.records = new Map(records.map((record) => [record.pendingThread.id, record]));
    this.render();
    this.cleanupRuntime = this.bridge.onPendingUpdated((record) => {
      if (record.associationStatus === 'cancelled' || record.associationStatus === 'completed' || record.associationStatus === 'created' ||
        (record.localThread.answerMode === 'current_conversation' && record.localThread.status === 'answer_attached')) {
        this.records.delete(record.pendingThread.id); this.clearCurrentUi(record.pendingThread.id);
      }
      else if (this.records.has(record.pendingThread.id) || record.associationStatus === 'awaiting_manual_association' ||
        Boolean(record.targetConversationUrl && isCompatibleChatGptTargetUrl(record.targetConversationUrl, window.location.href))) {
        this.records.set(record.pendingThread.id, record);
        if (!record.pendingThread.candidateAnswerFingerprint) this.returnedIds.delete(record.pendingThread.id);
      }
      this.refreshCandidates();
      this.render();
    });
    this.cleanupExecuteSend = this.bridge.onExecutePendingSend(async (record) => {
      if (record.localThread.answerMode === 'current_conversation' || record.pendingThread.id !== record.localThread.id) return false;
      this.applyRecord(record);
      return this.fill(record.pendingThread.id, true);
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
      record.associationStatus !== 'completed',
    );
    return this.partialSelectionId
      ? records.filter((record) => record.pendingThread.id === this.partialSelectionId)
      : records.filter((record) => record.localThread.answerMode !== 'current_conversation');
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
    this.records.set(record.pendingThread.id, record);
    if (!record.pendingThread.candidateAnswerFingerprint) this.returnedIds.delete(record.pendingThread.id);
    this.refreshCandidates();
    this.render();
  }

  stop(): void {
    this.cleanupRuntime?.();
    this.cleanupRuntime = null;
    this.cleanupExecuteSend?.();
    this.cleanupExecuteSend = null;
    this.cleanupCandidateObserver?.();
    this.cleanupCandidateObserver = null;
    window.removeEventListener('popstate', this.checkUrl);
    window.removeEventListener('hashchange', this.checkUrl);
    if (this.urlTimer) clearInterval(this.urlTimer);
    this.urlTimer = null;
    for (const id of [...this.answerActions.keys()]) this.removeAnswerAction(id);
    this.root.unmount();
    this.host.remove();
  }

  private readonly checkUrl = () => {
    if (window.location.href === this.currentUrl) return;
    this.currentUrl = window.location.href;
    for (const [id, record] of this.records) {
      if (record.targetTabId !== undefined && record.associationStatus !== 'cancelled') {
        const storedUrl = record.targetConversationUrl ?? record.pendingThread.targetConversationUrl;
        if (storedUrl && isCompatibleChatGptTargetUrl(storedUrl, this.currentUrl)) {
          void this.bridge.associateCurrentPage(record.pendingThread.id, this.currentUrl).catch(() => undefined);
        } else {
          this.records.set(id, { ...record, associationStatus: 'awaiting_manual_association' });
          this.render();
        }
      }
    }
  };

  private render(): void {
    const visible = [...this.records.values()].filter((record) => !this.closedIds.has(record.pendingThread.id) &&
      record.localThread.answerMode !== 'current_conversation');
    this.host.style.display = visible.length ? 'block' : 'none';
    this.root.render(
      <PendingThreadBanner
        records={visible}
        copiedIds={this.copiedIds}
        errors={this.errors}
        confirmingIds={this.confirmingIds}
        candidates={this.candidates}
        onCopy={(id) => void this.copy(id)}
        onFill={(id) => void this.fill(id)}
        onAssociate={(id, confirmed) => void this.associate(id, confirmed)}
        onReturn={(id) => void this.returnToSource(id)}
        onCancel={(id) => void this.cancel(id)}
        onClose={(id) => { this.closedIds.add(id); this.render(); }}
        onAttachWhole={(id) => void this.attachWhole(id)}
        onSelectPartial={(id) => this.selectPartial(id)}
        onUndo={(id) => void this.undo(id)}
      />,
    );
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

  private async fill(id: string, skipAuthorization = false): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || this.sendingIds.has(id)) return false;
    if (record.pendingThread.submittedPromptHash === record.pendingThread.promptHash) { this.errors.set(id, '该问题已经发送'); this.render(); return false; }
    if (!skipAuthorization && this.authorizer && !(await this.authorizer.authorize())) return false;
    this.sendingIds.add(id); this.errors.set(id, '正在发送……'); this.render();
    try {
      let filled = false;
      for (let attempt = 0; !filled && attempt < 150; attempt++) {
        filled = Boolean(this.adapter?.fillComposer(record.pendingThread.generatedPrompt));
        if (!filled) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!filled || !this.adapter) throw new Error('追问空间尚未准备好，请重试');
      let ready = this.adapter.canSubmitComposer();
      for (let attempt = 0; !ready && attempt < 50; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100)); ready = this.adapter.canSubmitComposer();
      }
      if (!ready) throw new Error('发送按钮当前不可用');
      const reserved = await this.bridge.reservePromptSubmission(id, record.pendingThread.promptHash ?? '', window.location.href);
      if (!this.adapter.submitComposer()) {
        await this.bridge.releasePromptSubmission(id, record.pendingThread.promptHash ?? '').catch(() => undefined);
        throw new Error('发送失败，请重试');
      }
      this.records.set(id, reserved); this.errors.set(id, '已发送');
      showOperationToast('已发送');
      return true;
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '操作失败，请重试');
      return false;
    } finally { this.sendingIds.delete(id); this.render(); }
  }

  private refreshCandidates(): void {
    if (!this.adapter) return;
    let changed = false;
    for (const [id, record] of this.records) {
      if (record.localThread.status === 'answer_attached') continue;
      const candidate = this.adapter.findCandidateAnswer(
        record.pendingThread.promptHash ?? '',
        record.pendingThread.assistantFingerprintsBefore ?? [],
      );
      if (candidate) {
        this.candidates.set(id, candidate); changed = true;
        this.reliableCandidateIds.add(id);
        const signature = `${candidate.fingerprint}:${candidate.streaming}`;
        if (this.candidateStates.get(id) !== signature) {
          this.candidateStates.set(id, signature);
          void this.bridge.updateCandidateState(id, candidate.fingerprint, candidate.streaming).then((updated) => {
            this.records.set(id, updated); this.render();
          }).catch(() => undefined);
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
    if (!this.reliableCandidateIds.has(id)) return false;
    for (const [otherId, other] of this.candidates) {
      if (otherId !== id && other.fingerprint === candidate.fingerprint && this.records.get(otherId)?.localThread.answerMode === 'current_conversation') return false;
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
    this.records.set(id, updated); this.partialSelectionId = this.partialSelectionId === id ? null : this.partialSelectionId;
    this.candidates.delete(id); this.reliableCandidateIds.delete(id); this.removeAnswerAction(id);
    await this.returnToSource(id);
    this.records.delete(id); this.clearCurrentUi(id); this.render();
  }

  private async returnCurrentOnly(id: string): Promise<void> {
    if (this.partialSelectionId === id) this.partialSelectionId = null;
    this.returnedIds.add(id); this.removeAnswerAction(id);
    await this.returnToSource(id);
    this.render();
  }

  private async attachWhole(id: string): Promise<void> {
    const record = this.records.get(id); const candidate = this.candidates.get(id);
    if (!record || !candidate || candidate.streaming) return;
    if (record.localThread.answerMode === 'current_conversation') return this.attachCurrentWholeAndReturn(id);
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
      else this.records.set(id, updated);
      showAttachmentUndo(this.bridge, updated, (restored) => { this.records.set(id, restored); this.render(); });
      this.candidates.delete(id);
      this.render();
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
    try { const record = await this.bridge.undoAttachment(id); this.records.set(id, record); this.refreshCandidates(); this.render(); }
    catch (error) { this.errors.set(id, error instanceof Error ? error.message : '撤销失败'); this.render(); }
  }

  private async returnToSource(id: string): Promise<void> {
    const record = this.records.get(id); if (!record) return;
    if (record.localThread.answerMode === 'current_conversation') {
      if (record.localThread.status === 'answer_attached') await this.bridge.returnToSource(id);
      if (this.returnToThreadHandler?.(id)) return;
      const resolution = this.adapter?.resolveTextAnchor(record.pendingThread.anchor, true);
      if (resolution?.status === 'resolved' && resolution.element) {
        if (record.pendingThread.viewAnchor) {
          new ViewAnchorController().restore(resolution.element, record.pendingThread.viewAnchor, true, this.adapter?.getScrollContainer(resolution.element) ?? window);
        } else {
          resolution.element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }
      }
      return;
    }
    await this.bridge.returnToSource(id);
    showOperationToast('已返回原文');
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
      this.records.set(id, record);
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
