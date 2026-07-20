# Storage

Typed PointAsk persistence lives here. Business code receives store abstractions; only `storage-driver.ts` accesses `chrome.storage.local`. Every owned key uses the `pointask:` prefix.

Schema v10 stores rich message blocks and explicit per-round identity (`roundId`, question/answer message IDs, pending ID, prompt hash, answer locator, and staging state), plus Workspace and navigation state. `LocalThreadRound` is the canonical persisted lifecycle snapshot; pending records remain submission transport metadata. `migration.ts` converts legacy message strings and message-ID-based rounds without deleting the original values before a successful write.
