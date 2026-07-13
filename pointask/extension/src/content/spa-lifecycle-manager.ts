import type { SiteAdapter } from '../adapters/site-adapter';

export type SpaLifecycleReason = 'dom' | 'url' | 'history';

export class SpaLifecycleManager {
  private cleanupObserver: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  private currentUrl = window.location.href;
  private started = false;

  constructor(private readonly adapter: SiteAdapter, private readonly callback: (reason: SpaLifecycleReason) => void) {}
  start(): void {
    if (this.started) return;
    this.started = true;
    this.cleanupObserver = this.adapter.observePageChanges(() => this.schedule('dom'));
    window.addEventListener('popstate', this.onHistory);
    window.addEventListener('hashchange', this.onHistory);
    this.urlTimer = setInterval(() => {
      if (window.location.href !== this.currentUrl) {
        this.currentUrl = window.location.href;
        this.schedule('url');
      }
    }, 750);
  }
  stop(): void {
    this.started = false;
    this.cleanupObserver?.();
    this.cleanupObserver = null;
    window.removeEventListener('popstate', this.onHistory);
    window.removeEventListener('hashchange', this.onHistory);
    if (this.urlTimer) clearInterval(this.urlTimer);
    if (this.timer) clearTimeout(this.timer);
    this.urlTimer = this.timer = null;
  }
  private readonly onHistory = () => this.schedule('history');
  private schedule(reason: SpaLifecycleReason): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.callback(reason); }, 200);
  }
}
