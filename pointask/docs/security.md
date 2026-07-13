# PointAsk Security

## Trust boundaries

- The content script runs only on `https://chatgpt.com/*`.
- The manifest requests only `storage`; tab creation and activation use the standard runtime API without broad host access.
- Runtime messages use `pointask:` types, reject unknown fields, validate nested thread schemas, require matching source/target tab IDs, and accept only HTTPS `chatgpt.com` URLs.
- `javascript:`, `file:`, HTTP, non-ChatGPT hosts, invalid IDs, expired pending records, and low-confidence anchors fail closed.
- ChatGPT-specific DOM selectors exist only in the adapter.

PointAsk does not request cookies, access private ChatGPT APIs, submit the ChatGPT composer, trigger Enter, click send, or attach answers without a user action. A user may explicitly click to fill the visible composer. Candidate recognition reads only visible message roles, prompt text hashes, fingerprints, and streaming state; full answer content is extracted only after a manual selection or an explicit whole-answer attachment click.

All injected UI is isolated in PointAsk-owned Shadow DOM. User text and code are rendered as React text nodes; LaTeX is rendered by bundled KaTeX with `trust: false` and `throwOnError: false`. ChatGPT HTML is never reused. The only direct `innerHTML` usage is a fixed extension-owned toolbar template with no interpolated data. Logs never include selected text, prompts, complete answers, URLs, or account data.
