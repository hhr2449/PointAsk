# PointAsk Privacy

PointAsk is a local-first Chrome extension. By default, it saves only the data needed for user-initiated local follow-ups in `chrome.storage.local`:

- source text the user selects;
- limited source paragraph context and anchor metadata;
- local questions entered by the user;
- prompts generated locally by PointAsk;
- answer content the user selects and confirms, or a reliably matched whole answer the user explicitly clicks to attach;
- a completed Workspace answer temporarily staged only when the user clicks “继续追问”; this local temporary copy is deleted after the round is successfully attached;
- source and target ChatGPT URLs;
- UI settings;
- local aggregate counters that contain no conversation content.

PointAsk does not upload data to a PointAsk server, call an additional model API, read cookies, obtain passwords, automatically send questions, stage answers on page load or in background activity, or automatically upload analytics. A complete Workspace answer is read and staged only after the user clicks “继续追问”. Filling the visible composer requires a click; clipboard writes are only a user-triggered fallback and PointAsk never reads existing clipboard contents.

“Clear all PointAsk data” removes all PointAsk-owned keys, including any temporarily staged answers. It does not clear ChatGPT data or other extensions' data.
