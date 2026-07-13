# PointAsk Agent Guidelines

## Product and safety boundaries

PointAsk is a Chrome extension that lets a user ask a follow-up about text they explicitly select in a ChatGPT response, then manually attach a selected answer near the source text. Local follow-up threads must remain separate from the original conversation.

- Every capture, submission, and attachment starts with an explicit user action.
- Do not use OpenAI APIs, other model APIs, API keys, or model SDKs.
- Do not implement a backend, accounts, cloud sync, or external persistence.
- Do not access ChatGPT private APIs.
- Do not read ChatGPT cookies, login tokens, or account authentication data.
- Do not inject, submit, or automatically send a question.
- Do not automatically scrape, monitor, or capture complete answers.
- Only content that the user explicitly selects and attaches may be saved.
- When ChatGPT DOM behavior is uncertain, fail safely instead of operating on the wrong page element.

## Architecture rules

- All ChatGPT DOM adaptation belongs in `extension/src/adapters/`.
- UI code must not use ChatGPT-specific selectors directly.
- Every extension-owned DOM class, id, data attribute, and custom element name uses the `pointask-` prefix.
- Every storage key uses the `pointask:` prefix.
- Every runtime message type and custom event type uses the `pointask:` prefix.
- Injected interfaces must be isolated with Shadow DOM.
- Business components must not call `chrome.storage` directly; use a storage interface.
- Business components must not call `chrome.runtime.sendMessage` directly; use a dedicated messaging interface.

## Development discipline

- Do not implement later phases early.
- Keep changes limited to the requested stage.
- Run the smallest relevant lint, test, and build checks after changes.
- Never claim a command was run unless it actually was.
- Do not create Git commits automatically.

