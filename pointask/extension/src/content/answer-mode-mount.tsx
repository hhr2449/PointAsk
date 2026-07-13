import { createRoot, type Root } from 'react-dom/client';
import { AnswerModeSelector } from '../components/answer-mode-selector';
import type { AnswerMode } from '../shared/local-thread';
import { attachmentConfirmationStyles } from './shadow-styles';
import { applyPointAskTheme } from './theme';

export class AnswerModeMount {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  open(onConfirm: (mode: AnswerMode) => void, onBack: () => void, onCancel: () => void): void {
    this.close();
    const host = document.createElement('pointask-answer-mode-selector'); host.dataset.pointaskOwned = 'true';
    applyPointAskTheme(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = `${attachmentConfirmationStyles}
      .pointask-mode-selector{width:min(520px,100%);padding:15px;border-radius:var(--pa-radius);background:var(--pa-bg);color:var(--pa-text)}
      .pointask-mode{display:flex;gap:10px;padding:9px;border:1px solid var(--pa-border);border-radius:9px;margin:7px 0;cursor:pointer}
      .pointask-mode:hover{background:var(--pa-hover)}.pointask-mode span{display:grid}.pointask-mode small{color:var(--pa-muted);margin-top:3px}`;
    const mount = document.createElement('div'); shadow.append(style, mount); document.documentElement.append(host);
    this.host = host; this.root = createRoot(mount);
    this.root.render(<AnswerModeSelector onConfirm={(mode) => { this.close(); onConfirm(mode); }}
      onBack={() => { this.close(); onBack(); }} onCancel={() => { this.close(); onCancel(); }} />);
  }
  close(): void { this.root?.unmount(); this.root = null; this.host?.remove(); this.host = null; }
}
