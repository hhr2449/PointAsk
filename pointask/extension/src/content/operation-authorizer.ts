import type { SettingsStore } from '../storage/settings-store';
import { sharedShadowStyles } from './shadow-styles';
import { applyPointAskTheme } from './theme';

export type AuthorizationChoice = 'remember' | 'once' | 'cancel';

export class OperationAuthorizer {
  private pending: Promise<boolean> | null = null;
  constructor(private readonly settingsStore: SettingsStore) {}

  async authorize(): Promise<boolean> {
    if ((await this.settingsStore.get()).autoActionAuthorized) return true;
    if (this.pending) return this.pending;
    this.pending = this.prompt().finally(() => { this.pending = null; });
    return this.pending;
  }

  private prompt(): Promise<boolean> {
    return new Promise((resolve) => {
      const host = document.createElement('pointask-operation-authorization'); host.dataset.pointaskOwned = 'true';
      applyPointAskTheme(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = `${sharedShadowStyles}
        :host{position:fixed;z-index:2147483647;top:16px;right:16px;width:min(390px,calc(100vw - 32px))}
        section{padding:14px;border:1px solid var(--pa-border);border-radius:var(--pa-radius);background:var(--pa-bg);box-shadow:var(--pa-shadow);color:var(--pa-text)}
        h2{margin:0 0 7px;font-size:15px}p{margin:0;color:var(--pa-muted);font-size:13px;line-height:1.45}.pointask-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}`;
      const section = document.createElement('section'); section.setAttribute('role', 'dialog'); section.setAttribute('aria-modal', 'true');
      const title = document.createElement('h2'); title.textContent = '允许本次 PointAsk 操作？';
      const description = document.createElement('p'); description.textContent = '允许 PointAsk 在你主动点击操作按钮后，自动完成本次填入、发送或附加。PointAsk 不会在后台自行操作。';
      const actions = document.createElement('div'); actions.className = 'pointask-actions'; section.append(title, description, actions);
      const finish = (choice: AuthorizationChoice) => {
        host.remove();
        if (choice === 'remember') {
          void this.settingsStore.get().then((settings) => this.settingsStore.set({ ...settings, autoActionAuthorized: true }))
            .then(() => resolve(true), () => resolve(false));
        } else resolve(choice === 'once');
      };
      for (const [choice, label, primary] of [
        ['remember', '允许并记住', true], ['once', '仅本次', false], ['cancel', '取消', false],
      ] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.className = primary ? 'pointask-primary' : 'pointask-secondary'; button.addEventListener('click', () => finish(choice)); actions.append(button);
      }
      shadow.append(style, section); document.documentElement.append(host);
      shadow.querySelector<HTMLButtonElement>('button')?.focus();
    });
  }
}
