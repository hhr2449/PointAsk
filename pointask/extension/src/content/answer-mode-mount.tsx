import { createRoot, type Root } from 'react-dom/client';
import { AnswerModeSelector } from '../components/answer-mode-selector';
import type { AnswerMode } from '../shared/local-thread';
import { attachmentConfirmationStyles } from './shadow-styles';

export class AnswerModeMount {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  open(onConfirm: (mode: AnswerMode) => void, onBack: () => void, onCancel: () => void): void {
    this.close();
    const host = document.createElement('pointask-answer-mode-selector'); host.dataset.pointaskOwned = 'true';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = `${attachmentConfirmationStyles}
      .pointask-mode-selector{width:min(520px,100%);padding:18px;border-radius:12px;background:Canvas;color:CanvasText}
      .pointask-mode{display:flex;gap:10px;padding:10px;border:1px solid #8885;border-radius:9px;margin:8px 0;cursor:pointer}
      .pointask-mode span{display:grid}.pointask-mode small{color:#777;margin-top:3px}`;
    const mount = document.createElement('div'); shadow.append(style, mount); document.documentElement.append(host);
    this.host = host; this.root = createRoot(mount);
    this.root.render(<AnswerModeSelector onConfirm={(mode) => { this.close(); onConfirm(mode); }}
      onBack={() => { this.close(); onBack(); }} onCancel={() => { this.close(); onCancel(); }} />);
  }
  close(): void { this.root?.unmount(); this.root = null; this.host?.remove(); this.host = null; }
}
