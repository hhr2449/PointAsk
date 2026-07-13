import type { ViewAnchor } from '../shared/local-thread';

const RELEASE_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']);

export class ViewAnchorController {
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  private corrections = 0;
  private released = false;
  private cleanupInput: (() => void) | null = null;

  start(element: HTMLElement, anchor: ViewAnchor, scrollTarget: HTMLElement | Window = window): void {
    this.stop(); this.released = false; this.corrections = 0;
    const release = () => { this.released = true; this.stopObserver(); };
    const key = (event: KeyboardEvent) => { if (RELEASE_KEYS.has(event.key)) release(); };
    const pointer = (event: PointerEvent) => {
      if (scrollTarget instanceof HTMLElement) {
        const rect = scrollTarget.getBoundingClientRect();
        if (event.clientX >= rect.right - 20 && event.clientY >= rect.top && event.clientY <= rect.bottom) release();
      } else if (event.clientX >= document.documentElement.clientWidth - 20) release();
    };
    scrollTarget.addEventListener('wheel', release, { passive: true, once: true });
    scrollTarget.addEventListener('touchstart', release, { passive: true, once: true });
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', pointer);
    this.cleanupInput = () => {
      scrollTarget.removeEventListener('wheel', release); scrollTarget.removeEventListener('touchstart', release);
      window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', pointer);
    };
    const correct = () => {
      if (this.released || !element.isConnected || this.corrections >= 12) return this.stopObserver();
      const delta = element.getBoundingClientRect().top - anchor.viewportOffsetTop;
      if (Math.abs(delta) > 2) { this.corrections++; this.scrollBy(scrollTarget, delta, 'auto'); }
    };
    this.observer = new MutationObserver(() => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(correct, 80);
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    correct();
    this.lifetimeTimer = setTimeout(() => this.stopObserver(), 120_000);
  }

  restore(element: HTMLElement, anchor: ViewAnchor, smooth = true, scrollTarget: HTMLElement | Window = window): void {
    const delta = element.getBoundingClientRect().top - anchor.viewportOffsetTop;
    if (Math.abs(delta) > 2) this.scrollBy(scrollTarget, delta, smooth ? 'smooth' : 'auto');
  }

  stop(): void { this.stopObserver(); this.cleanupInput?.(); this.cleanupInput = null; }
  private scrollBy(target: HTMLElement | Window, top: number, behavior: ScrollBehavior): void {
    if (typeof target.scrollBy === 'function') target.scrollBy({ top, behavior });
    else if (target instanceof HTMLElement) target.scrollTop += top;
  }
  private stopObserver(): void {
    this.observer?.disconnect(); this.observer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer); this.debounceTimer = null;
    if (this.lifetimeTimer) clearTimeout(this.lifetimeTimer); this.lifetimeTimer = null;
  }
}
