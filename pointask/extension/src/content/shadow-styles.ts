export const sharedShadowStyles = `
  :host { all: initial; color: #202123; font-family: system-ui, sans-serif; }
  * { box-sizing: border-box; }
  button, textarea { font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .55; }
  button:focus-visible, textarea:focus-visible { outline: 2px solid #0b57d0; outline-offset: 2px; }
  .pointask-primary { border: 0; border-radius: 8px; padding: 8px 13px; color: white; background: #10a37f; font-weight: 650; }
  .pointask-secondary { border: 1px solid #c7c7d1; border-radius: 8px; padding: 7px 12px; color: #303038; background: white; }
`;

export const composerStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483647; width: min(420px, calc(100vw - 16px)); }
  .pointask-composer { padding: 14px; border: 1px solid #8886; border-radius: 12px; color: var(--pointask-text, CanvasText); background: var(--pointask-surface, Canvas); box-shadow: 0 8px 28px rgb(0 0 0 / 20%); }
  .pointask-quote { max-height: 72px; overflow: auto; margin: 0 0 12px; padding: 8px 10px; border-left: 3px solid #10a37f; background: #f6f7f7; color: #555; font-size: 13px; }
  .pointask-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 650; }
  textarea { width: 100%; resize: vertical; min-height: 76px; max-height: 180px; padding: 9px; border: 1px solid #8888; border-radius: 8px; color: inherit; background: color-mix(in srgb, var(--pointask-surface, Canvas) 94%, var(--pointask-text, CanvasText) 6%); }
  .pointask-footer, .pointask-actions { display: flex; align-items: center; }
  .pointask-footer { justify-content: space-between; gap: 12px; margin-top: 9px; }
  .pointask-actions { gap: 8px; }
  output { color: #666; font-size: 12px; }
  .pointask-error { color: #b42318; }
`;

export const threadStyles = `${sharedShadowStyles}
  :host { display: block; width: 100%; margin: 10px 0; }
  pointask-thread-card { display: block; width: min(680px, 100%); margin-inline: auto; border: 1px solid #d9d9e3; border-radius: 12px; background: #fbfbfc; overflow: hidden; }
  .pointask-thread-header { display: flex; align-items: stretch; min-width: 0; }
  .pointask-header-actions { display: flex; align-items: center; gap: 4px; padding-right: 6px; }
  .pointask-quick { border: 0; border-radius: 7px; padding: 6px 8px; background: #eef7f4; color: #08775f; white-space: nowrap; }
  .pointask-more { position: relative; }
  .pointask-more > summary { cursor: pointer; list-style: none; padding: 6px 8px; border-radius: 7px; }
  .pointask-more-menu { position: absolute; z-index: 3; top: calc(100% + 4px); right: 0; display: grid; min-width: 190px; padding: 6px; border: 1px solid #ddd; border-radius: 9px; background: white; box-shadow: 0 8px 22px #0002; }
  .pointask-more-menu button { border: 0; padding: 8px; background: transparent; text-align: left; }
  .pointask-more-menu button:hover { background: #f4f4f5; }
  .pointask-more-menu .pointask-danger { color: #a22; }
  .pointask-answer-title { flex: none; border: 0; border-right: 1px solid #e2e2e8; padding: 0 10px; color: #08775f; background: transparent; font-weight: 700; }
  .pointask-toggle { display: flex; flex: 1; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border: 0; color: #202123; background: transparent; text-align: left; }
  .pointask-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pointask-count { flex: none; color: #666; font-size: 12px; }
  .pointask-delete { flex: none; border: 0; border-left: 1px solid #e2e2e8; padding: 0 12px; color: #a22; background: transparent; }
  .pointask-thread-body { max-height: min(420px, 55vh); overflow: auto; padding: 0 13px 13px; border-top: 1px solid #e2e2e8; }
  .pointask-status { margin: 10px 0; color: #666; font-size: 12px; }
  .pointask-status-failed, .pointask-error { color: #b42318; }
  .pointask-error-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .pointask-message { margin: 10px 0; padding: 10px; border-radius: 9px; background: white; }
  .pointask-selection { margin: 10px 0; padding: 10px; border-left: 3px solid #888; border-radius: 9px; background: white; }
  .pointask-selection strong { font-size: 12px; }
  .pointask-selection-content { margin: 4px 0 0; overflow-wrap: anywhere; }
  .pointask-assistant { border-left: 3px solid #10a37f; }
  .pointask-message strong { font-size: 12px; }
  .pointask-message-content { margin: 4px 0 0; }
  .pointask-copy-state { color: #666; font-size: 12px; }
  .pointask-card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .pointask-sticky-actions { position: sticky; bottom: 0; padding: 9px 0 2px; background: #fbfbfcee; }
  .pointask-workspace-context { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0; padding: 9px; border-radius: 9px; background: #eef7f4; font-size: 12px; }
  .pointask-modal-backdrop { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items: center; padding: 16px; background: #0004; }
  .pointask-modal { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 16px; border-radius: 12px; background: white; box-shadow: 0 12px 36px #0004; }
  .pointask-modal > label, .pointask-context-message-list label { display: block; margin: 8px 0; }
  .pointask-context-message-list { max-height: 260px; overflow: auto; margin: 10px 0; padding: 8px; border: 1px solid #ddd; border-radius: 8px; }
  @media (max-width: 480px) { .pointask-count { display: none; } .pointask-thread-body { max-height: 45vh; } }
`;

export const bannerStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483646; top: 12px; right: 12px; width: min(380px, calc(100vw - 24px)); pointer-events: none; }
  .pointask-banner-list { display: grid; gap: 10px; max-height: calc(100vh - 24px); overflow: auto; }
  .pointask-banner { position: relative; pointer-events: auto; padding: 14px; border: 1px solid #d9d9e3; border-radius: 12px; background: white; box-shadow: 0 8px 28px rgb(0 0 0 / 18%); font-size: 13px; line-height: 1.45; }
  .pointask-banner p { margin: 8px 0; overflow-wrap: anywhere; }
  .pointask-banner-source { color: #555; }
  .pointask-banner-close { position: absolute; top: 6px; right: 7px; border: 0; padding: 2px 6px; color: #666; background: transparent; font-size: 20px; }
  .pointask-banner-actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .pointask-banner-feedback { min-height: 18px; margin-top: 6px; color: #08775f; font-size: 12px; }
`;

export const attachmentConfirmationStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items: center; padding: 16px; background: rgb(0 0 0 / 22%); }
  .pointask-attachment-confirmation { width: min(480px, 100%); max-height: min(560px, calc(100vh - 32px)); overflow: auto; padding: 16px; border: 1px solid #d9d9e3; border-radius: 12px; background: white; box-shadow: 0 12px 36px rgb(0 0 0 / 24%); }
  h2 { margin: 0 0 12px; font-size: 17px; }
  blockquote { max-height: 260px; overflow: auto; margin: 0 0 6px; padding: 10px; border-left: 3px solid #10a37f; background: #f6f7f7; white-space: pre-wrap; overflow-wrap: anywhere; }
  output { color: #666; font-size: 12px; }
  .pointask-actions { display: flex; gap: 8px; margin-top: 14px; }
`;
