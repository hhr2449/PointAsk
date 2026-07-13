import type { PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';

export function showAttachmentUndo(
  bridge: WebConversationBridge,
  record: PendingAssociation,
  onUndo: (record: PendingAssociation) => void,
): void {
  [...document.querySelectorAll<HTMLElement>('pointask-operation-feedback')]
    .find((item) => item.dataset.pointaskThreadId === record.pendingThread.id)?.remove();
  const host = document.createElement('pointask-operation-feedback'); host.dataset.pointaskOwned = 'true'; host.dataset.pointaskThreadId = record.pendingThread.id;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = ':host{position:fixed;z-index:2147483647;right:16px;bottom:16px}div{display:flex;align-items:center;gap:10px;padding:10px 13px;border-radius:9px;background:#202123;color:white;font:13px system-ui;box-shadow:0 8px 24px #0004}button{border:0;border-radius:6px;padding:5px 8px;cursor:pointer}';
  const box = document.createElement('div'); const text = document.createElement('span'); text.textContent = '回答已附加';
  const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = '撤销';
  const timer = setTimeout(() => host.remove(), 5_000);
  undo.addEventListener('click', () => { clearTimeout(timer); void bridge.undoAttachment(record.pendingThread.id).then((updated) => { host.remove(); onUndo(updated); }); });
  box.append(text, undo); shadow.append(style, box); document.documentElement.append(host);
}
