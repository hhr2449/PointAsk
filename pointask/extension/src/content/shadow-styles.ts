export const sharedShadowStyles = `
  :host { all: initial; color-scheme: light dark; font-family: var(--pointask-font, system-ui, sans-serif);
    --pa-bg: #fff; --pa-bg-subtle: #f7f7f8; --pa-text: #202123; --pa-muted: #6b6b70; --pa-border: #dedee3;
    --pa-hover: #f0f0f2; --pa-accent: #5f6b7a; --pa-danger: #b42318; --pa-radius: 10px; --pa-shadow: 0 8px 24px rgb(0 0 0 / 12%); color: var(--pa-text); }
  :host([data-pointask-theme="dark"]) { --pa-bg: #2f2f2f; --pa-bg-subtle: #252525; --pa-text: #ececec; --pa-muted: #aaa;
    --pa-border: #4a4a4a; --pa-hover: #3a3a3a; --pa-accent: #b4bdc8; --pa-danger: #ff8c82; --pa-shadow: 0 8px 28px rgb(0 0 0 / 35%); }
  * { box-sizing: border-box; }
  button, textarea { font: inherit; }
  button { appearance: none; border: 0; background: none; cursor: pointer; color: inherit; }
  button:disabled { cursor: not-allowed; opacity: .55; }
  button:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--pa-accent); outline-offset: 2px; }
  .pointask-primary, .pointask-secondary, .pointask-more-trigger, .pointask-ghost {
    border-radius: 8px; font-size: 13px; line-height: 1.2; transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease, box-shadow .15s ease;
  }
  .pointask-primary { border: 1px solid var(--pa-text); padding: 7px 11px; color: var(--pa-bg); background: var(--pa-text); font-weight: 600; }
  .pointask-primary:not(:disabled):hover { opacity: .88; }
  .pointask-secondary { border: 1px solid transparent; padding: 7px 10px; color: var(--pa-text); background: transparent; }
  .pointask-secondary:not(:disabled):hover { background: var(--pa-hover); }
`;

export const composerStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483647; width: min(420px, calc(100vw - 16px)); }
  .pointask-composer { padding: 13px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); color: var(--pa-text); background: var(--pa-bg); box-shadow: var(--pa-shadow); }
  .pointask-quote { max-height: 72px; overflow: auto; margin: 0 0 10px; padding: 7px 9px; border-left: 2px solid var(--pa-accent); background: var(--pa-bg-subtle); color: var(--pa-muted); font-size: 13px; }
  .pointask-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 650; }
  textarea { width: 100%; resize: vertical; min-height: 76px; max-height: 180px; padding: 9px; border: 1px solid var(--pa-border); border-radius: 8px; color: inherit; background: var(--pa-bg-subtle); }
  .pointask-answer-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 9px 0 0; padding: 0; border: 0; }
  .pointask-answer-mode legend { grid-column: 1 / -1; margin-bottom: 5px; color: var(--pa-muted); font-size: 12px; font-weight: 650; }
  .pointask-answer-mode label { display: flex; align-items: flex-start; gap: 7px; padding: 8px; border: 1px solid var(--pa-border); border-radius: 8px; cursor: pointer; }
  .pointask-answer-mode label:has(input:checked) { border-color: var(--pa-accent); background: var(--pa-bg-subtle); }
  .pointask-answer-mode input { margin: 2px 0 0; }
  .pointask-answer-mode span { display: grid; gap: 2px; font-size: 12px; }
  .pointask-answer-mode small { color: var(--pa-muted); line-height: 1.3; }
  .pointask-footer, .pointask-actions { display: flex; align-items: center; }
  .pointask-footer { justify-content: space-between; gap: 12px; margin-top: 9px; }
  .pointask-actions { gap: 8px; }
  output { color: var(--pa-muted); font-size: 12px; }
  .pointask-error { color: #b42318; }
`;

export const threadStyles = `${sharedShadowStyles}
  :host { display: block; box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; margin: 10px 0; overflow-anchor: none; }
  :host(.pointask-thread-highlight) pointask-thread-card { outline: 3px solid #10a37f; outline-offset: 3px; transition: outline-color .25s ease; }
  pointask-thread-card { display: block; box-sizing: border-box; width: 100%; max-width: 680px; min-width: 0; margin-inline: auto; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); color: var(--pa-text); background: color-mix(in srgb, var(--pa-bg) 96%, transparent); overflow-wrap: anywhere; }
  .pointask-thread-header { display: flex; align-items: stretch; min-width: 0; }
  .pointask-header-actions { display: flex; min-width: 0; align-items: center; gap: 3px; padding-right: 5px; }
  .pointask-quick { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; border: 0; border-radius: 7px; padding: 6px 9px; background: transparent; white-space: nowrap; font-size: 13px; line-height: 1.2; }
  .pointask-quick:hover { background: var(--pa-hover); }
  .pointask-primary-action { color: var(--pa-text); font-weight: 600; }
  .pointask-more-trigger { border: 0; border-radius: 7px; padding: 5px 8px; background: transparent; font-weight: 700; user-select: none; -webkit-user-select: none; font-size: 13px; line-height: 1.2; }
  .pointask-more-trigger:hover, .pointask-more-trigger[aria-expanded="true"] { background: var(--pa-hover); }
  .pointask-toggle { display: flex; flex: 1; min-width: 0; align-items: center; gap: 9px; padding: 10px 11px; border: 0; color: inherit; background: transparent; text-align: left; }
  .pointask-toggle:hover { background: var(--pa-hover); }
  .pointask-summary { display: flex; flex: 1; min-width: 0; gap: 7px; align-items: baseline; }
  .pointask-summary b { flex: none; font-size: 14px; line-height: 1.35; font-weight: 600; }
  .pointask-summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pa-muted); font-size: 14px; line-height: 1.35; }
  .pointask-count { flex: none; color: var(--pa-muted); font-size: 12px; }
  .pointask-status-dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--pa-muted); }
  .pointask-status-answer_attached, .pointask-status-answer_ready { background: var(--pa-accent); }
  .pointask-status-failed, .pointask-status-orphaned { background: var(--pa-danger); }
  .pointask-thread-body { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; padding: 8px 13px 12px; border-top: 1px solid var(--pa-border); overflow-wrap: anywhere; }
  .pointask-status { margin: 9px 0; color: var(--pa-muted); font-size: 12px; }
  .pointask-status-line { display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; }
  .pointask-error { color: var(--pa-danger); }
  .pointask-error-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .pointask-round-list { display: grid; width: 100%; max-width: 100%; min-width: 0; gap: 10px; margin: 10px 0 0; }
  .pointask-round { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; overflow: clip; border: 1px solid var(--pa-border); border-radius: 12px; background: color-mix(in srgb, var(--pa-bg) 97%, var(--pa-bg-subtle)); overflow-wrap: anywhere; }
  .pointask-round-header { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 42px; }
  .pointask-round-toggle { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; padding: 10px 11px; text-align: left; color: inherit; }
  .pointask-round-toggle:hover { background: var(--pa-hover); }
  .pointask-round-title { display: flex; flex: 1; min-width: 0; align-items: baseline; gap: 6px; }
  .pointask-round-title b { flex: none; font-size: 14px; line-height: 1.35; font-weight: 600; }
  .pointask-round-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pa-text); font-size: 14px; line-height: 1.35; font-weight: 600; }
  .pointask-round-chevron { flex: none; color: var(--pa-muted); font-size: 13px; line-height: 1; }
  .pointask-round-menu { padding: 7px 8px 7px 0; }
  .pointask-round-body { display: grid; width: 100%; max-width: 100%; min-width: 0; gap: 10px; padding: 0 11px 11px; }
  .pointask-round-question { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; padding: 10px 11px; border-radius: 10px; background: var(--pa-bg-subtle); overflow-wrap: anywhere; }
  .pointask-round-question-content { width: 100%; max-width: 100%; min-width: 0; color: var(--pa-text); font-size: 16px; line-height: 1.55; font-weight: 550; overflow-wrap: anywhere; white-space: pre-wrap; }
  .pointask-question-text-collapsed { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  .pointask-question-text-expanded { display: block; max-height: min(240px, 32vh); overflow-y: auto; overscroll-behavior: contain; }
  .pointask-question-toggle { margin-top: 5px; border-radius: 6px; padding: 3px 5px; color: var(--pa-muted); font-size: 12px; text-decoration: underline; }
  .pointask-question-toggle:hover { background: var(--pa-hover); color: var(--pa-text); }
  .pointask-round-answer { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; padding-left: 12px; border-left: 2px solid color-mix(in srgb, var(--pa-accent) 72%, var(--pa-border)); overflow-wrap: anywhere; }
  .pointask-round-answer-label { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: var(--pa-text); font-size: 15px; line-height: 1.35; font-weight: 600; }
  .pointask-round-answer-label::before { content: "◦"; color: var(--pa-muted); font-size: 14px; line-height: 1; }
  .pointask-round-answer-content { width: 100%; max-width: 100%; min-width: 0; color: var(--pa-text); font-size: 16px; line-height: 1.65; overflow-wrap: anywhere; }
  .pointask-round-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .pointask-round-secondary { border-color: var(--pa-border); padding: 6px 9px; color: var(--pa-muted); background: transparent; }
  .pointask-round-secondary:hover { background: var(--pa-hover); }
  .pointask-selection { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; margin: 10px 0; padding: 8px 10px; border-left: 2px solid var(--pa-border); color: var(--pa-muted); overflow-wrap: anywhere; }
  .pointask-selection > strong { font-size: 12px; }
  .pointask-selection-content { width: 100%; max-width: 100%; min-width: 0; margin: 4px 0 0; overflow-wrap: anywhere; }
  .pointask-assistant { color: var(--pa-text); }
  .pointask-message { margin: 12px 0; padding: 0; }
  .pointask-message > strong { font-size: 12px; }
  .pointask-message-content { margin: 4px 0 0; }
  .pointask-copy-state { color: var(--pa-muted); font-size: 12px; }
  .pointask-card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .pointask-workspace-context { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 9px 0; padding: 7px 9px; border-radius: 8px; background: var(--pa-bg-subtle); color: var(--pa-muted); font-size: 12px; }
  .pointask-workspace-context > span { min-width: 0; overflow-wrap: anywhere; }
  .pointask-modal-backdrop { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items: center; padding: 16px; background: #0003; }
  .pointask-modal { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 15px; border:1px solid var(--pa-border); border-radius: var(--pa-radius); color:var(--pa-text); background:var(--pa-bg); box-shadow:var(--pa-shadow); }
  .pointask-modal > label, .pointask-context-message-list label { display: block; margin: 8px 0; }
  .pointask-context-message-list { max-height: 260px; overflow: auto; margin: 10px 0; padding: 8px; border: 1px solid var(--pa-border); border-radius: 8px; }
  @media (max-width: 520px) { .pointask-count { display: none; } .pointask-header-actions { max-width: 42%; } .pointask-quick { overflow:hidden;text-overflow:ellipsis; } .pointask-thread-body { padding-inline: 10px; } }
`;

export const threadMenuOverlayStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483647; inset: 0; width: 0; height: 0; pointer-events: none; }
  .pointask-thread-menu-overlay { position: fixed; z-index: 2147483647; inset: 0; pointer-events: none; }
  .pointask-more-menu { position: fixed; z-index: 2147483647; display: grid; min-width: 190px; max-width: calc(100vw - 16px); padding: 5px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--pa-border); border-radius: 9px; color: var(--pa-text); background: var(--pa-bg); box-shadow: var(--pa-shadow); pointer-events: auto; visibility: hidden; }
  .pointask-more-menu button { border: 0; border-radius: 6px; padding: 8px; color: inherit; background: transparent; text-align: left; white-space: nowrap; font: inherit; }
  .pointask-more-menu button:hover, .pointask-more-menu button:focus-visible { background: var(--pa-hover); }
  .pointask-more-menu .pointask-danger { color: var(--pa-danger); }
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

export const workspaceControlStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483646; top: 16px; right: 16px; width: min(360px, calc(100vw - 32px)); pointer-events: none;
    --pointask-control-radius: 14px; --pointask-control-gap: 16px; }
  .pointask-workspace-control { position: relative; max-height: calc(100vh - 32px); overflow: auto; overscroll-behavior: contain; pointer-events: auto;
    border: 1px solid var(--pa-border); border-radius: var(--pointask-control-radius); color: var(--pa-text); background: var(--pa-bg); box-shadow: var(--pa-shadow); font-size: 13px; line-height: 1.45; }
  .pointask-workspace-control.pointask-collapsed { width: 240px; margin-left: auto; overflow: visible; }
  .pointask-control-header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 48px; padding: 0 16px; background: var(--pa-bg); }
  .pointask-control-brand { display: flex; align-items: center; min-width: 0; gap: 8px; }
  .pointask-control-brand strong::after { content: "·"; margin-left: 8px; color: var(--pa-muted); }
  .pointask-control-brand select { max-width: 112px; border: 1px solid var(--pa-border); border-radius: 7px; padding: 4px 6px; color: inherit; background: var(--pa-bg); font: inherit; }
  .pointask-control-toggle { flex: none; padding: 6px; border-radius: 7px; color: var(--pa-muted); }
  .pointask-control-toggle:hover { background: var(--pa-hover); }
  .pointask-control-space-title { padding: 0 16px 12px; border-bottom: 1px solid var(--pa-border); color: var(--pa-muted); font-weight: 600; }
  .pointask-collapsed-status { padding: 0 16px 12px; color: var(--pa-muted); }
  .pointask-control-body { position: relative; }
  .pointask-control-view { display: grid; gap: var(--pointask-control-gap); padding: 16px; }
  .pointask-control-view section, .pointask-control-view h2, .pointask-control-view p { margin: 0; }
  .pointask-control-view h2 { font-size: 16px; }
  .pointask-control-view h3 { margin: 0 0 5px; color: var(--pa-muted); font-size: 12px; }
  .pointask-control-summary { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  .pointask-control-status { display: flex; align-items: center; gap: 8px; color: var(--pa-muted); }
  .pointask-control-status span { font-size: 9px; color: var(--pa-accent); }
  .pointask-control-status-failed span, .pointask-control-status-return_failed span { color: var(--pa-danger); }
  .pointask-control-hint, .pointask-control-error { color: var(--pa-danger); }
  .pointask-control-selection { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px; border-radius: 8px; background: var(--pa-bg-subtle); }
  .pointask-control-selection button, .pointask-control-low-frequency button { padding: 3px; color: var(--pa-muted); text-decoration: underline; }
  .pointask-control-actions { display: grid; gap: 8px; }
  .pointask-control-actions .pointask-primary { min-height: 40px; }
  .pointask-control-low-frequency { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pointask-continue-view textarea { width: 100%; min-height: 112px; resize: vertical; padding: 10px; border: 1px solid var(--pa-border); border-radius: 9px; color: inherit; background: var(--pa-bg-subtle); }
  .pointask-round-options { display: grid; gap: 8px; }
  .pointask-round-option { display: flex; align-items: flex-start; gap: 9px; padding: 9px; border: 1px solid var(--pa-border); border-radius: 9px; }
  .pointask-round-option > span { display: grid; min-width: 0; gap: 3px; }
  .pointask-round-option small { margin-left: 7px; color: var(--pa-muted); font-weight: normal; }
  .pointask-round-option.pointask-disabled { opacity: .55; }
  .pointask-control-menu { position: absolute; right: 12px; bottom: 48px; z-index: 3; display: grid; min-width: 220px; padding: 5px; border: 1px solid var(--pa-border); border-radius: 9px; background: var(--pa-bg); box-shadow: var(--pa-shadow); }
  .pointask-control-menu button { padding: 8px; border-radius: 6px; text-align: left; }
  .pointask-control-menu button:hover { background: var(--pa-hover); }
  .pointask-control-menu .pointask-danger { color: var(--pa-danger); }
  .pointask-control-menu pre { max-width: 310px; overflow: auto; margin: 5px; color: var(--pa-muted); font-size: 10px; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
`;

export const currentAnswerActionStyles = `${sharedShadowStyles}
  :host { display: block; width: 100%; margin: 8px 0 14px; }
  .pointask-current-answer-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: min(760px, 100%); margin-inline: auto; padding: 8px 10px; border: 1px solid var(--pa-border); border-radius: 9px; color: var(--pa-text); background: var(--pa-bg); box-shadow: 0 4px 14px rgb(0 0 0 / 8%); font-size: 12px; }
  .pointask-current-answer-label { display: grid; flex: 1; min-width: 90px; gap: 2px; }
  .pointask-current-answer-label span { color: var(--pa-muted); }
  .pointask-current-answer-buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
  .pointask-current-answer-buttons button { white-space: nowrap; }
  .pointask-error { flex-basis: 100%; margin: 4px 0 0; color: var(--pa-danger); }
  @media (max-width: 620px) { .pointask-current-answer-actions { align-items: stretch; flex-direction: column; } .pointask-current-answer-buttons { justify-content: flex-start; } }
`;

export const attachmentConfirmationStyles = `${sharedShadowStyles}
  :host { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items:center; padding:16px; background:rgb(0 0 0 / 16%); }
  .pointask-attachment-confirmation { width:min(480px,100%); max-height:min(560px,calc(100vh - 32px)); overflow:auto; padding:15px; border:1px solid var(--pa-border); border-radius:var(--pa-radius); color:var(--pa-text); background:var(--pa-bg); box-shadow:var(--pa-shadow); }
  h2 { margin: 0 0 12px; font-size: 17px; }
  blockquote { max-height: 260px; overflow: auto; margin: 0 0 6px; padding: 10px; border-left: 3px solid #10a37f; background: #f6f7f7; white-space: pre-wrap; overflow-wrap: anywhere; }
  output { color: #666; font-size: 12px; }
  .pointask-actions { display: flex; gap: 8px; margin-top: 14px; }
`;
