# Manual Test Checklist

## Clean installation

- Build and load `extension/dist` as unpacked.
- Confirm manifest version 0.1.0 and only the `storage` permission.
- Open ChatGPT and verify no console errors.

## End-to-end

- Select assistant text; user messages and composer selections must be rejected.
- Create a local question; verify prompt copy requires a click.
- Open a visible target ChatGPT tab; verify PointAsk never fills or sends.
- Paste and send manually, then select only the desired answer.
- Click attach, inspect the confirmation, confirm, and return to source.
- Expand/collapse the restored card, continue one round, and attach the next answer manually.
- Refresh source and target pages; confirm cards/banner restore without duplicate hosts.
- Navigate with ChatGPT SPA links and browser back/forward; confirm unrelated conversations do not receive an attachment action.
- Replace an answer and reassociate a page only after explicit confirmation.
- Delete a round and a thread.

## Privacy and failure cases

- Deny clipboard access and verify safe fallback/error.
- Create ambiguous repeated text and verify no automatic mount.
- Clear PointAsk data and verify unrelated storage remains.
- Inspect console/network: no content logs, model APIs, private endpoints, cookies, or automatic telemetry.
