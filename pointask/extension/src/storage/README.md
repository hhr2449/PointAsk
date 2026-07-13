# Storage

Typed PointAsk persistence lives here. Business code receives store abstractions; only `storage-driver.ts` accesses `chrome.storage.local`. Every owned key uses the `pointask:` prefix.

Schema v4 stores rich message blocks, per-thread pending metadata, current-conversation scroll behavior, the optional dedicated-tab close setting, Workspaces, and one short-lived pending answer navigation. `migration.ts` converts legacy message strings to text blocks without deleting the original values before a successful write.
