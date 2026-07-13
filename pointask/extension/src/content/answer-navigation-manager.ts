import type { SiteAdapter } from '../adapters/site-adapter';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';

export class AnswerNavigationManager {
  private cleanupObserver: (() => void) | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupRuntime: (() => void) | null = null;
  private failureTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly adapter: SiteAdapter, private readonly bridge: WebConversationBridge) {}

  async start(): Promise<void> {
    if (!document.getElementById('pointask-answer-highlight-style')) {
      const style = document.createElement('style'); style.id = 'pointask-answer-highlight-style'; style.dataset.pointaskOwned = 'true';
      style.textContent = '.pointask-answer-highlight{outline:3px solid #10a37f!important;outline-offset:4px;transition:outline-color .2s}';
      document.documentElement.append(style);
    }
    await this.tryResolve();
    this.cleanupRuntime = this.bridge.onNavigationReady(() => { void this.tryResolve(); });
    this.cleanupObserver = this.adapter.observePageChanges(() => { void this.tryResolve(); });
  }
  stop(): void {
    this.cleanupObserver?.(); this.cleanupObserver = null;
    this.cleanupRuntime?.(); this.cleanupRuntime = null;
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    if (this.failureTimer) clearTimeout(this.failureTimer);
    document.querySelectorAll('.pointask-answer-highlight').forEach((element) => element.classList.remove('pointask-answer-highlight'));
  }
  private async tryResolve(): Promise<void> {
    const navigation = await this.bridge.getPendingNavigation().catch(() => null);
    if (!navigation) return;
    const element = this.adapter.resolveAnswerSource(navigation.locator);
    if (!element) {
      if (!this.failureTimer) this.failureTimer = setTimeout(() => {
        this.showFailure(); void this.bridge.completeNavigation(navigation.id).catch(() => undefined); this.failureTimer = null;
      }, 10_000);
      return;
    }
    if (this.failureTimer) clearTimeout(this.failureTimer); this.failureTimer = null;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('pointask-answer-highlight');
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => element.classList.remove('pointask-answer-highlight'), 1_500);
    await this.bridge.completeNavigation(navigation.id).catch(() => undefined);
  }
  private showFailure(): void {
    const host = document.createElement('pointask-navigation-status'); host.dataset.pointaskOwned = 'true';
    const shadow = host.attachShadow({ mode: 'open' });
    const message = document.createElement('div'); message.textContent = '已打开原会话，但未能精确定位原回答';
    message.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:9px;background:#202123;color:white;font:13px system-ui';
    shadow.append(message); document.documentElement.append(host); setTimeout(() => host.remove(), 4_000);
  }
}
