# PointAsk

PointAsk is a Chrome extension for asking focused follow-up questions about text selected in a ChatGPT answer. It routes a locally generated prompt to the chosen ChatGPT page; only after the user clicks “fill composer” does it modify the composer, and the user remains responsible for sending and attaching the answer.

PointAsk requires no API key and no backend. Its intended application data is stored locally with `chrome.storage.local`.

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

PointAsk never sends a ChatGPT message, calls a model API, uses a private ChatGPT endpoint, reads authentication data, or automatically captures an answer. Filling the visible composer and attaching a reliably matched whole answer each require a separate explicit user click.

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

The product is designed to process only user-selected source text, its paragraph context, the user's local question, the generated prompt, a user-selected attached answer, and relevant ChatGPT page URLs. It does not process cookies, passwords, tokens, general browsing history, unselected page content, or automatically collected answers, and it does not send data to an external server. See [docs/privacy-boundaries.md](docs/privacy-boundaries.md).
