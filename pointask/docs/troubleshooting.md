# Troubleshooting

- **No toolbar:** confirm the selection is inside one assistant paragraph, not a user message, input, cross-message range, or PointAsk UI.
- **No attachment action:** confirm the target page shows an active PointAsk pending banner and has not navigated to an unrelated conversation.
- **Copy failed:** allow clipboard access or copy again from a direct button click.
- **Card missing after refresh:** wait for the answer DOM to load. Ambiguous and low-confidence anchors intentionally remain unmounted.
- **Duplicate/old code error:** rebuild, reload the extension at `chrome://extensions`, close old ChatGPT tabs, and reopen them.
- **Reset:** use Extension options → Clear all PointAsk data. This does not clear ChatGPT or other extension data.
