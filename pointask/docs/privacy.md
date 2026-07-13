# PointAsk Privacy

PointAsk is a local-first Chrome extension. By default, it saves only the data needed for user-initiated local follow-ups in `chrome.storage.local`:

- source text the user selects;
- limited source paragraph context and anchor metadata;
- local questions entered by the user;
- prompts generated locally by PointAsk;
- answer content the user selects and confirms, or a reliably matched whole answer the user explicitly clicks to attach;
- source and target ChatGPT URLs;
- UI settings;
- local aggregate counters that contain no conversation content.

PointAsk does not upload data to a PointAsk server, call an additional model API, read cookies, obtain passwords, automatically send questions, automatically collect answers, read an unselected complete answer before an explicit whole-answer attachment click, or automatically upload analytics. Filling the visible composer requires a click; clipboard writes are only a user-triggered fallback and PointAsk never reads existing clipboard contents.

“Clear all PointAsk data” removes only keys prefixed and owned by PointAsk. It does not clear ChatGPT data or other extensions' data.
