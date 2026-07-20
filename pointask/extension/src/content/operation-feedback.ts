import type { PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { applyPointAskTheme } from './theme';
import { sharedShadowStyles } from './shadow-styles';

function toastHost(message: string): { host: HTMLElement; box: HTMLElement } {
  const host = document.createElement('pointask-operation-feedback'); host.dataset.pointaskOwned = 'true'; applyPointAskTheme(host);
  const shadow = host.attachShadow({ mode: 'open' }); const style = document.createElement('style');
  style.textContent = `${sharedShadowStyles}:host{position:fixed;z-index:2147483647;right:16px;bottom:16px}div{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--pa-border);border-radius:9px;background:var(--pa-bg);color:var(--pa-text);font-size:13px;box-shadow:var(--pa-shadow)}button{border:0;border-radius:6px;padding:5px 8px;color:inherit;background:var(--pa-hover);cursor:pointer}`;
  const box = document.createElement('div'); const text = document.createElement('span'); text.textContent = message; box.append(text); shadow.append(style, box);
  return { host, box };
}

export function showOperationToast(message: string, duration = 2_500): void {
  const { host } = toastHost(message); document.documentElement.append(host); setTimeout(() => host.remove(), duration);
}

export function showAttachmentUndo(
  bridge: WebConversationBridge,
  record: PendingAssociation,
  onUndo: (record: PendingAssociation) => void,
): void {
  [...document.querySelectorAll<HTMLElement>('pointask-operation-feedback')]
    .find((item) => item.dataset.pointaskThreadId === record.pendingThread.id)?.remove();
  const { host, box } = toastHost(`已附加到 ${record.localThread.displayId}`); host.dataset.pointaskThreadId = record.pendingThread.id;
  const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = '撤销';
  const timer = setTimeout(() => host.remove(), 5_000);
  undo.addEventListener('click', () => { clearTimeout(timer); void bridge.undoAttachment(record.pendingThread.id).then((updated) => { host.remove(); onUndo(updated); }); });
  box.append(undo); document.documentElement.append(host);
}
