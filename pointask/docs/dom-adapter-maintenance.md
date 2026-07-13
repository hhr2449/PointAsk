# ChatGPT DOM Adapter Maintenance

All ChatGPT DOM interpretation belongs in `extension/src/adapters/`. Do not move selectors into UI, selection, storage, or bridge code.

The adapter relies on semantic `data-message-author-role`, conversation-turn test IDs, and content/block semantics. Random generated classes must never be the sole signal. Do not read React internals, cookies, private APIs, or composer state.

When ChatGPT changes:

1. Update only sanitized local fixtures first.
2. Require positive assistant identification; uncertainty returns null.
3. Test user/assistant distinction, streaming node replacement, wrapper and whitespace changes, repeated text, lazy loading, and PointAsk-owned mutations.
4. Preserve the anchor resolver's safe outcomes: resolved, pending, ambiguous, orphaned.
5. Never resolve the first low-confidence match merely to keep UI visible.
