import type { PendingAssociation } from '../bridge/runtime-messages';
import type { SelectionData } from './selection-manager';
import { applyPointAskTheme } from './theme';
import { sharedShadowStyles } from './shadow-styles';

const TOOLBAR_GAP = 10;
const VIEWPORT_MARGIN = 8;

interface SelectionToolbarOptions {
  onFollowUp(data: SelectionData): void;
  onAttach(data: SelectionData, association: PendingAssociation): void;
}

export class SelectionToolbar {
  private readonly host: HTMLElement;
  private readonly actions: HTMLElement;
  private data: SelectionData | null = null;
  private attachments: PendingAssociation[] = [];

  constructor(private readonly options: SelectionToolbarOptions) {
    this.host = document.createElement('pointask-selection-toolbar');
    this.host.dataset.pointaskOwned = 'true';
    applyPointAskTheme(this.host);
    this.host.style.display = 'none';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${sharedShadowStyles}</style>
      <style>
        :host { position: fixed; z-index: 2147483647; }
        .pointask-actions { display:flex;flex-wrap:wrap;gap:3px;box-sizing:border-box;max-width:min(520px,calc(100vw - 16px));padding:3px;background:var(--pa-bg);border:1px solid var(--pa-border);border-radius:var(--pa-radius);box-shadow:var(--pa-shadow); }
        button { border:0;border-radius:7px;padding:7px 10px;color:var(--pa-text);background:transparent;font:600 13px/1.2 var(--pointask-font);cursor:pointer;white-space:nowrap; }
        button:hover { background:var(--pa-hover); } button.pointask-attach { color:var(--pa-text); }
      </style>
      <div class="pointask-actions"></div>
    `;
    this.actions = shadow.querySelector('.pointask-actions') as HTMLElement;
    document.documentElement.append(this.host);
  }

  show(data: SelectionData, attachments: PendingAssociation[] = []): void {
    this.data = data;
    this.attachments = attachments;
    this.renderActions();
    this.host.style.display = 'block';
    this.positionNear(data.rangeRect);
  }

  hide(): void {
    this.data = null;
    this.attachments = [];
    this.host.style.display = 'none';
  }

  destroy(): void {
    this.host.remove();
  }

  focus(): void {
    this.actions.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private renderActions(): void {
    this.actions.replaceChildren();
    const followUp = document.createElement('button');
    followUp.type = 'button';
    followUp.textContent = '针对这里追问';
    followUp.setAttribute('aria-label', '针对这里追问');
    followUp.addEventListener('pointerdown', (event) => event.preventDefault());
    followUp.addEventListener('click', () => {
      if (this.data) this.options.onFollowUp(this.data);
    });
    this.actions.append(followUp);

    for (const association of this.attachments) {
      const attach = document.createElement('button');
      attach.type = 'button';
      attach.className = 'pointask-attach';
      const replacing = association.localThread.messages.at(-1)?.role === 'assistant';
      attach.textContent = replacing ? `替换 ${association.localThread.displayId} 回答` : `附加到 ${association.localThread.displayId}`;
      attach.setAttribute('aria-label', `${attach.textContent}：${association.pendingThread.question}`);
      attach.title = association.pendingThread.question;
      attach.addEventListener('pointerdown', (event) => event.preventDefault());
      attach.addEventListener('click', () => {
        if (this.data) this.options.onAttach(this.data, association);
      });
      this.actions.append(attach);
    }
  }

  private positionNear(rect: DOMRect): void {
    const width = this.host.offsetWidth || 280;
    const height = this.host.offsetHeight || 42;
    const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);
    const preferredTop = rect.bottom + TOOLBAR_GAP;
    const top = preferredTop + height <= window.innerHeight - VIEWPORT_MARGIN
      ? preferredTop
      : Math.max(VIEWPORT_MARGIN, rect.top - height - TOOLBAR_GAP);
    this.host.style.left = `${left}px`;
    this.host.style.top = `${top}px`;
  }
}
