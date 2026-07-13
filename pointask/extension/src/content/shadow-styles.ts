export const sharedShadowStyles = `
  :host { all: initial; color-scheme: light dark; font-family: var(--pointask-font, system-ui, sans-serif);
    --pa-bg: #fff; --pa-bg-subtle: #f7f7f8; --pa-text: #202123; --pa-muted: #6b6b70; --pa-border: #dedee3;
    --pa-hover: #f0f0f2; --pa-accent: #5f6b7a; --pa-danger: #b42318; --pa-radius: 10px; --pa-shadow: 0 8px 24px rgb(0 0 0 / 12%); color: var(--pa-text); }
  :host([data-pointask-theme="dark"]) { --pa-bg: #2f2f2f; --pa-bg-subtle: #252525; --pa-text: #ececec; --pa-muted: #aaa;
    --pa-border: #4a4a4a; --pa-hover: #3a3a3a; --pa-accent: #b4bdc8; --pa-danger: #ff8c82; --pa-shadow: 0 8px 28px rgb(0 0 0 / 35%); }
  * { box-sizing: border-box; }
  button, textarea { font: inherit; }
  button { cursor: pointer; color: inherit; }
  button:disabled { cursor: not-allowed; opacity: .55; }
  button:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--pa-accent); outline-offset: 2px; }
  .pointask-primary { border: 1px solid var(--pa-text); border-radius: 8px; padding: 7px 11px; color: var(--pa-bg); background: var(--pa-text); font-weight: 600; }
  .pointask-primary:hover { opacity: .88; }
  .pointask-secondary { border: 1px solid transparent; border-radius: 8px; padding: 7px 10px; color: var(--pa-text); background: transparent; }
  .pointask-secondary:hover { background: var(--pa-hover); }
`;

export const composerStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483647; width: min(420px, calc(100vw - 16px)); }
  .pointask-composer { padding: 13px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); color: var(--pa-text); background: var(--pa-bg); box-shadow: var(--pa-shadow); }
  .pointask-quote { max-height: 72px; overflow: auto; margin: 0 0 10px; padding: 7px 9px; border-left: 2px solid var(--pa-accent); background: var(--pa-bg-subtle); color: var(--pa-muted); font-size: 13px; }
  .pointask-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 650; }
  textarea { width: 100%; resize: vertical; min-height: 76px; max-height: 180px; padding: 9px; border: 1px solid var(--pa-border); border-radius: 8px; color: inherit; background: var(--pa-bg-subtle); }
  .pointask-footer, .pointask-actions { display: flex; align-items: center; }
  .pointask-footer { justify-content: space-between; gap: 12px; margin-top: 9px; }
  .pointask-actions { gap: 8px; }
  output { color: #666; font-size: 12px; }
  .pointask-error { color: #b42318; }
`;

export const threadStyles = `${sharedShadowStyles}
  :host { display: block; width: 100%; margin: 10px 0; }
  pointask-thread-card { display: block; width: min(680px, 100%); margin-inline: auto; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); color: var(--pa-text); background: color-mix(in srgb, var(--pa-bg) 96%, transparent); }
  .pointask-thread-header { display: flex; align-items: stretch; min-width: 0; }
  .pointask-header-actions { display: flex; align-items: center; gap: 3px; padding-right: 5px; }
  .pointask-quick { border: 0; border-radius: 7px; padding: 6px 9px; background: transparent; white-space: nowrap; }
  .pointask-quick:hover { background: var(--pa-hover); }
  .pointask-primary-action { color: var(--pa-text); font-weight: 600; }
  .pointask-more { position: relative; }
  .pointask-more > summary { cursor: pointer; list-style: none; padding: 5px 8px; border-radius: 7px; font-weight: 700; }
  .pointask-more > summary:hover { background: var(--pa-hover); }
  .pointask-more-menu { position: absolute; z-index: 3; top: calc(100% + 4px); right: 0; display: grid; min-width: 190px; padding: 5px; border: 1px solid var(--pa-border); border-radius: 9px; color: var(--pa-text); background: var(--pa-bg); box-shadow: var(--pa-shadow); }
  .pointask-more-menu button { border: 0; padding: 8px; background: transparent; text-align: left; }
  .pointask-more-menu button:hover { background: var(--pa-hover); }
  .pointask-more-menu .pointask-danger { color: var(--pa-danger); }
  .pointask-toggle { display: flex; flex: 1; min-width: 0; align-items: center; gap: 9px; padding: 10px 11px; border: 0; color: inherit; background: transparent; text-align: left; }
  .pointask-toggle:hover { background: var(--pa-hover); }
  .pointask-summary { display: flex; flex: 1; min-width: 0; gap: 7px; align-items: baseline; }
  .pointask-summary b { flex: none; font-size: 12px; }
  .pointask-summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pa-muted); }
  .pointask-count { flex: none; color: var(--pa-muted); font-size: 12px; }
  .pointask-status-dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--pa-muted); }
  .pointask-status-answer_attached, .pointask-status-answer_ready { background: var(--pa-accent); }
  .pointask-status-failed, .pointask-status-orphaned { background: var(--pa-danger); }
  .pointask-thread-body { padding: 1px 13px 12px; border-top: 1px solid var(--pa-border); }
  .pointask-status { margin: 9px 0; color: var(--pa-muted); font-size: 12px; }
  .pointask-status-line { display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; }
  .pointask-error { color: var(--pa-danger); }
  .pointask-error-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .pointask-message { margin: 12px 0; padding: 0; }
  .pointask-selection { margin: 10px 0; padding: 8px 10px; border-left: 2px solid var(--pa-border); color: var(--pa-muted); }
  .pointask-selection strong { font-size: 12px; }
  .pointask-selection-content { margin: 4px 0 0; overflow-wrap: anywhere; }
  .pointask-assistant { color: var(--pa-text); }
  .pointask-message strong { font-size: 12px; }
  .pointask-message-content { margin: 4px 0 0; }
  .pointask-copy-state { color: var(--pa-muted); font-size: 12px; }
  .pointask-card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .pointask-workspace-context { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 9px 0; padding: 7px 9px; border-radius: 8px; background: var(--pa-bg-subtle); color: var(--pa-muted); font-size: 12px; }
  .pointask-modal-backdrop { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items: center; padding: 16px; background: #0003; }
  .pointask-modal { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 15px; border:1px solid var(--pa-border); border-radius: var(--pa-radius); color:var(--pa-text); background:var(--pa-bg); box-shadow:var(--pa-shadow); }
  .pointask-modal > label, .pointask-context-message-list label { display: block; margin: 8px 0; }
  .pointask-context-message-list { max-height: 260px; overflow: auto; margin: 10px 0; padding: 8px; border: 1px solid var(--pa-border); border-radius: 8px; }
  @media (max-width: 520px) { .pointask-count { display: none; } .pointask-header-actions { max-width: 42%; } .pointask-quick { overflow:hidden;text-overflow:ellipsis; } .pointask-thread-body { padding-inline: 10px; } }
`;

export const bannerStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483646; top: 12px; right: 12px; width: min(380px, calc(100vw - 24px)); pointer-events: none; }
  .pointask-banner-list { display: grid; gap: 10px; max-height: calc(100vh - 24px); overflow: auto; }
  .pointask-banner { position: relative; pointer-events: auto; padding: 13px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); color: var(--pa-text); background: var(--pa-bg); box-shadow: var(--pa-shadow); font-size: 13px; line-height: 1.45; }
  .pointask-banner p { margin: 8px 0; overflow-wrap: anywhere; }
  .pointask-banner-source { color: var(--pa-muted); }
  .pointask-banner-close { position: absolute; top: 6px; right: 7px; border: 0; padding: 2px 6px; color: #666; background: transparent; font-size: 20px; }
  .pointask-banner-actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .pointask-banner-feedback { min-height: 18px; margin-top: 6px; color: var(--pa-muted); font-size: 12px; }
`;

export const attachmentConfirmationStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items:center; padding:16px; background:rgb(0 0 0 / 16%); }
  .pointask-attachment-confirmation { width:min(480px,100%); max-height:min(560px,calc(100vh - 32px)); overflow:auto; padding:15px; border:1px solid var(--pa-border); border-radius:var(--pa-radius); color:var(--pa-text); background:var(--pa-bg); box-shadow:var(--pa-shadow); }
  h2 { margin: 0 0 12px; font-size: 17px; }
  blockquote { max-height: 260px; overflow: auto; margin: 0 0 6px; padding: 10px; border-left: 3px solid #10a37f; background: #f6f7f7; white-space: pre-wrap; overflow-wrap: anywhere; }
  output { color: #666; font-size: 12px; }
  .pointask-actions { display: flex; gap: 8px; margin-top: 14px; }
`;
