# PointAsk

PointAsk is a Chrome extension for asking focused follow-up questions about text selected in a ChatGPT answer. The question composer lets the user choose the current conversation or a shared follow-up Workspace; its explicit “发送” click creates and submits exactly one pending prompt to that destination. Answer attachment remains a separate user action.

PointAsk requires no API key and no backend. Its intended application data is stored locally with `chrome.storage.local`. In a shared follow-up Workspace, clicking “继续追问” temporarily saves the current completed answer locally so it can still be attached if ChatGPT later unloads the older DOM. A successfully attached copy is removed immediately; an answer skipped during partial attachment may remain locally for up to 30 days so the user can explicitly attach it later, then expires automatically.

## Development

Requirements: a current Node.js LTS release, npm, and Google Chrome.

```sh
cd extension
npm install
npm run dev
npm run lint
npm run test
npm run build
```

`npm run dev` rebuilds the extension when source files change. Production output is written to `extension/dist/`.
The automated suite includes Workspace staging, restart restoration, staged attachment cleanup, return failure, and PointAsk-owned data clearing boundaries.

To load the unpacked extension:

1. Run `npm run build` from `extension/`.
2. Open `chrome://extensions` in Chrome.
3. Enable Developer mode.
4. Choose **Load unpacked** and select `extension/dist/`.
5. Open a page under `https://chatgpt.com/`.

## Current stage

PointAsk supports three user-selected answer locations: a shared per-conversation follow-up Workspace, the current ChatGPT conversation, or a dedicated branch/conversation. Text, code, and LaTeX selections are stored as safe structured blocks. Matching answers may be attached whole only after an explicit click; uncertain matches still require a manual selection.

Threads and Workspaces survive page refreshes and tab replacement. Conversation URLs and thread IDs are stable identity; browser tab IDs are reconstructed when pages reopen. Dedicated answer tabs are retained by default and may optionally be closed only after attachment, return to source, and confirmation that the target tab is no longer active.

## User-control boundary

PointAsk never sends or stages an answer on page load, restoration, timers, or background activity. The explicitly labelled send button is the confirmation for exactly one pending prompt. Clicking “继续追问” is the explicit action that stages the current Workspace answer locally before sending the next round; it does not attach that answer to the source card. Prompt hashes, thread IDs, and round IDs prevent repeated work. PointAsk never calls a model API, uses a private ChatGPT endpoint, reads authentication data, or attaches an answer without a distinct user click.

## Structure

- `docs/`: product, architecture, delivery plan, and privacy boundaries.
- `extension/manifest.json`: source extension manifest.
- `extension/src/adapters/`: all ChatGPT DOM-specific integration.
- `extension/src/background/`: service worker entry point.
- `extension/src/content/`: content script entry point.
- `extension/src/bridge/`: runtime messaging abstractions.
- `extension/src/components/`: React UI components.
- `extension/src/storage/`: local persistence abstractions.
- `extension/src/shared/`: shared types and utilities.
- `extension/src/styles/`: extension-owned styles.
- `extension/tests/`: automated tests.

## Privacy

The product is designed to process only user-selected source text, its paragraph context, the user's local question, the generated prompt, answers explicitly staged by clicking “继续追问”, retained after an explicit partial-attachment action, or explicitly selected for attachment, and relevant ChatGPT page URLs. Staged answers remain only in `chrome.storage.local` until attached, expired, their PointAsk thread is deleted, or all PointAsk data is cleared. Answers skipped during partial attachment are retained for at most 30 days and are never included in later default attachment. PointAsk does not process cookies, passwords, tokens, general browsing history, or background-collected answers, and it does not send data to an external server. See [docs/privacy-boundaries.md](docs/privacy-boundaries.md).
