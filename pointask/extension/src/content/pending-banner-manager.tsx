import { createRoot, type Root } from 'react-dom/client';
import type { ClipboardManager } from '../bridge/clipboard-manager';
import type { PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { PendingThreadBanner } from '../components/pending-thread-banner';
import { bannerStyles } from './shadow-styles';
import { isCompatibleChatGptTargetUrl } from '../bridge/runtime-messages';
import type { SiteAdapter } from '../adapters/site-adapter';
import type { CandidateAnswer } from '../adapters/site-adapter';
import { richPlainText } from '../shared/rich-content';
import { richContentStyles } from '../components/rich-content-renderer';
import { ViewAnchorController } from './view-anchor-controller';

export class PendingBannerManager {
  private readonly host: HTMLElement;
  private readonly root: Root;
  private records = new Map<string, PendingAssociation>();
  private readonly closedIds = new Set<string>();
  private readonly copiedIds = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly confirmingIds = new Set<string>();
  private cleanupRuntime: (() => void) | null = null;
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  private currentUrl = window.location.href;
  private readonly candidates = new Map<string, CandidateAnswer>();
  private readonly candidateStates = new Map<string, string>();
  private cleanupCandidateObserver: (() => void) | null = null;

  constructor(
    private readonly bridge: WebConversationBridge,
    private readonly clipboard: ClipboardManager,
    private readonly adapter?: SiteAdapter,
  ) {
    this.host = document.createElement('pointask-pending-thread-banner');
    this.host.dataset.pointaskOwned = 'true';
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
        (record.localThread.answerMode === 'current_conversation' && record.localThread.status === 'answer_attached')) this.records.delete(record.pendingThread.id);
      else if (this.records.has(record.pendingThread.id) || record.associationStatus === 'awaiting_manual_association' ||
        Boolean(record.targetConversationUrl && isCompatibleChatGptTargetUrl(record.targetConversationUrl, window.location.href))) {
        this.records.set(record.pendingThread.id, record);
      }
      this.refreshCandidates();
      this.render();
    });
    this.refreshCandidates();
    this.cleanupCandidateObserver = this.adapter?.observePageChanges(() => this.refreshCandidates()) ?? null;
    window.addEventListener('popstate', this.checkUrl);
    window.addEventListener('hashchange', this.checkUrl);
    this.urlTimer = setInterval(this.checkUrl, 500);
  }

  getAttachmentAssociations(): PendingAssociation[] {
    return [...this.records.values()].filter((record) =>
      record.associationStatus !== 'awaiting_manual_association' && record.associationStatus !== 'cancelled' &&
      record.associationStatus !== 'completed',
    );
  }

  applyRecord(record: PendingAssociation): void {
    if (record.localThread.answerMode === 'current_conversation' && record.localThread.status === 'answer_attached') {
      this.records.delete(record.pendingThread.id);
      this.render();
      return;
    }
    this.records.set(record.pendingThread.id, record);
    this.render();
  }

  stop(): void {
    this.cleanupRuntime?.();
    this.cleanupRuntime = null;
    this.cleanupCandidateObserver?.();
    this.cleanupCandidateObserver = null;
    window.removeEventListener('popstate', this.checkUrl);
    window.removeEventListener('hashchange', this.checkUrl);
    if (this.urlTimer) clearInterval(this.urlTimer);
    this.urlTimer = null;
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
    const visible = [...this.records.values()].filter((record) => !this.closedIds.has(record.pendingThread.id));
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

  private async fill(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (this.adapter?.fillComposer(record.pendingThread.generatedPrompt)) {
      this.copiedIds.delete(id);
      this.errors.set(id, '已填入；请检查后手动发送');
      this.render();
      return;
    }
    const fallback = await this.clipboard.copy(record.pendingThread.generatedPrompt);
    if (fallback.success) {
      this.copiedIds.add(id);
      this.errors.set(id, '无法填入，提示词已复制，请手动粘贴');
    } else this.errors.set(id, fallback.error || '无法填入或复制提示词');
    this.render();
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
        const signature = `${candidate.fingerprint}:${candidate.streaming}`;
        if (this.candidateStates.get(id) !== signature) {
          this.candidateStates.set(id, signature);
          void this.bridge.updateCandidateState(id, candidate.fingerprint, candidate.streaming).then((updated) => {
            this.records.set(id, updated); this.render();
          }).catch(() => undefined);
        }
      }
      else if (this.candidates.delete(id)) changed = true;
    }
    if (changed) this.render();
  }

  private async attachWhole(id: string): Promise<void> {
    const record = this.records.get(id); const candidate = this.candidates.get(id);
    if (!record || !candidate || candidate.streaming) return;
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
      this.candidates.delete(id);
      this.render();
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '附加失败');
      this.render();
    }
  }

  private selectPartial(id: string): void {
    const candidate = this.candidates.get(id);
    if (candidate) candidate.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    if (record.localThread.answerMode === 'current_conversation' && record.pendingThread.viewAnchor) {
      const resolution = this.adapter?.resolveTextAnchor(record.pendingThread.anchor, true);
      if (resolution?.status === 'resolved' && resolution.element) {
        new ViewAnchorController().restore(resolution.element, record.pendingThread.viewAnchor, true, this.adapter?.getScrollContainer(resolution.element) ?? window);
      }
      if (record.localThread.status !== 'answer_attached') return;
    }
    await this.bridge.returnToSource(id);
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
      this.records.delete(id);
      this.render();
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : '取消失败');
      this.render();
    }
  }
}
