import { createRoot, type Root } from 'react-dom/client';
import type { SiteAdapter } from '../adapters/site-adapter';
import type { ClipboardManager } from '../bridge/clipboard-manager';
import type { PointAskWorkspace } from '../shared/local-thread';
import type { WorkspaceStore } from '../storage/workspace-store';
import { isCompatibleChatGptTargetUrl } from '../bridge/runtime-messages';
import { bannerStyles } from './shadow-styles';
import { applyPointAskTheme } from './theme';

export class WorkspaceContextBannerManager {
  private host: HTMLElement; private root: Root; private cleanup: (() => void) | null = null;
  private workspace: PointAskWorkspace | null = null; private feedback = '';
  constructor(private readonly store: WorkspaceStore, private readonly adapter: SiteAdapter, private readonly clipboard: ClipboardManager) {
    this.host = document.createElement('pointask-workspace-context-banner'); this.host.dataset.pointaskOwned = 'true';
    applyPointAskTheme(this.host);
    const shadow = this.host.attachShadow({ mode: 'open' }); const style = document.createElement('style'); style.textContent = bannerStyles;
    const mount = document.createElement('div'); shadow.append(style, mount); document.documentElement.append(this.host); this.root = createRoot(mount);
  }
  async start(): Promise<void> { await this.refresh(); this.cleanup = this.store.subscribe(() => { void this.refresh().catch(() => undefined); }); }
  stop(): void { this.cleanup?.(); this.root.unmount(); this.host.remove(); }
  private async refresh(): Promise<void> {
    this.workspace = (await this.store.list()).find((workspace) => workspace.pendingContextUpdate && workspace.targetConversationUrl &&
      isCompatibleChatGptTargetUrl(workspace.targetConversationUrl, window.location.href)) ?? null;
    this.render();
  }
  private render(): void {
    const workspace = this.workspace; const update = workspace?.pendingContextUpdate;
    this.host.style.display = workspace && update ? 'block' : 'none';
    this.root.render(workspace && update ? <div className="pointask-banner-list"><section className="pointask-banner">
      <strong>共享追问空间上下文更新</strong><p>{update.label}</p>
      <p>点击后只填入输入框，请检查并手动发送。PointAsk 不会自动提交。</p>
      <div className="pointask-banner-actions">
        <button type="button" className="pointask-primary" onClick={() => void this.fill(workspace)}>填入上下文更新</button>
        <button type="button" className="pointask-secondary" onClick={() => void this.confirm(workspace)}>我已手动发送</button>
      </div><div className="pointask-banner-feedback" aria-live="polite">{this.feedback}</div>
    </section></div> : null);
  }
  private async fill(workspace: PointAskWorkspace): Promise<void> {
    const update = workspace.pendingContextUpdate; if (!update) return;
    if (this.adapter.fillComposer(update.prompt)) {
      await this.store.upsert({ ...workspace, pendingContextUpdate: { ...update, status: 'filled', updatedAt: new Date().toISOString() } });
      this.feedback = '已填入，请检查后手动发送';
    } else {
      const result = await this.clipboard.copy(update.prompt); this.feedback = result.success ? '填入失败，已复制作为备用' : '无法填入或复制';
    }
    this.render();
  }
  private async confirm(workspace: PointAskWorkspace): Promise<void> {
    const update = workspace.pendingContextUpdate;
    if (!update || update.status !== 'filled') { this.feedback = '请先填入，并在 ChatGPT 中手动发送后再确认'; this.render(); return; }
    await this.store.confirmContextUpdate(workspace.id, update.id); this.workspace = null; this.feedback = ''; this.render();
  }
}
