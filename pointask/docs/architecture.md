# PointAsk Architecture

## Components

- **Content script:** coordinates page-local capabilities and mounts extension UI. It depends on abstractions rather than ChatGPT selectors or Chrome persistence calls.
- **Service worker:** coordinates cross-tab runtime messages and extension lifecycle work.
- **ChatGPT site adapter:** the sole owner of ChatGPT-specific DOM selectors and page-shape interpretation. It lives under `extension/src/adapters/` and fails safely when expected structures are absent.
- **Selection manager:** validates a user-initiated selection and turns adapter output into page-neutral selection data.
- **Shadow DOM UI:** hosts PointAsk React interfaces in an isolated extension-owned tree. All extension DOM names use the `pointask-` prefix.
- **Mount manager:** creates, reuses, relocates, and removes Shadow DOM mount points without leaking UI selectors into the site adapter.
- **Prompt builder:** converts selected source context plus a local question into text the user can submit.
- **Clipboard manager:** copies generated text only as part of a user-initiated flow and reports success or failure.
- **Pending thread manager:** tracks a follow-up between prompt creation and manual answer attachment.
- **Web conversation bridge:** persists prompts and coordinates visible ChatGPT tabs. Composer filling is delegated to the adapter and occurs only on an explicit button click; sending is never automated.
- **Rich-content extractor/renderer:** treats KaTeX, MathML, and code as atomic selection nodes, stores typed blocks, and renders LaTeX with bundled KaTeX inside each PointAsk Shadow Root.
- **Answer navigation manager:** stores a short-lived locator, opens or activates the visible conversation, resolves the assistant fingerprint, scrolls, highlights, and clears the locator.
- **Manual answer attachment:** accepts answer text only from an explicit user selection and attach action.
- **Thread store:** hides `chrome.storage.local` behind a typed interface and enforces `pointask:` keys.
- **Anchor resolver:** records and later resolves a resilient source location, safely declining to mount if confidence is insufficient.
- **Runtime messaging bridge:** hides `chrome.runtime.sendMessage` from business components and enforces `pointask:` message types.
- **Versioned storage layer:** `ThreadStore`, `PendingStore`, `SettingsStore`, and `MetricsStore` are the only local persistence interfaces. They use `pointask:*` keys and schema migration.
- **SPA lifecycle manager:** debounces DOM and visible-URL changes, retries pending anchors, removes stale mounts, and remounts extension hosts removed by page rendering.
- **Workspace store:** owns the single active auxiliary Workspace for each source conversation. Workspace lifecycle is independent from individual local-thread deletion.
- **Workspace context snapshot:** stores only a version, last synced message fingerprint, progress counters, and an explicitly prepared update. Page observation may refresh counters, but it never copies new main-conversation content into the Workspace. Content is collected only after the user opens the update picker, filled only after another click, and versioned only after the user confirms manual sending.
- **Answer-mode selector:** chooses `workspace`, `current_conversation`, or `dedicated_branch` after question composition and before prompt routing.

## Source-to-target data flow

```text
Source page: user selects text
  -> create local question
  -> generate prompt
  -> save pending thread
  -> persist prompt and open/activate the chosen visible page
Target page: user clicks fill and manually sends
  -> candidate recognition uses prompt hash plus message order, without reading answer content
  -> user selects part, or explicitly clicks to extract and attach the uniquely matched whole answer
  -> save local thread
Source page: restore and display thread
```

The source tab creates the pending record and supplies its identifier through the runtime messaging layer. The service worker may route PointAsk-owned state between tabs, but it does not read conversation content. The target tab displays guidance and accepts only the user's explicit selection. After attachment, the thread store becomes the shared local source of truth; the source tab can receive a `pointask:` runtime notification or restore from storage on navigation.

## Dependency boundaries

UI components receive storage and messaging capabilities through interfaces. They never call `chrome.storage` or `chrome.runtime.sendMessage` directly. Site-specific DOM knowledge never leaves the adapter layer. Injected UI is always rendered inside Shadow DOM. No component calls a model API, private ChatGPT endpoint, or automated send/extraction facility.

## Persistence and anchor recovery

Local threads, pending prompts, settings, schema version, and privacy-safe counters are stored under `pointask:*` keys in `chrome.storage.local`. Reads pass through version migration and invalid records are discarded safely. Clearing data removes only these owned keys.

New anchors contain the visible page/conversation URL, assistant fingerprint/hash, paragraph hash, selected text, prefix/suffix, offsets, block index, node path, schema version, and creation time. Recovery narrows by conversation and message identity, then scores paragraph and surrounding context. Equal or low-confidence candidates are never mounted automatically; the resolver returns `pending`, `ambiguous`, or `orphaned` instead.

The service worker remains the authority for tab association and validates every runtime payload. Persistent thread data is the recovery source after service-worker suspension; tab IDs are ephemeral routing hints and may be rebound when a visible page has the same stable source or target conversation. A completed attachment remains persisted but is excluded from target-banner recovery until the user explicitly undoes it.

All thread, pending, Workspace, and migration read-modify-write paths use storage locks. Startup migration does not rewrite a schema that is already current, preventing an initializing context from replacing newer persisted state with an earlier snapshot.

`LocalMessage.content` is a versioned `RichContentBlock[]`. Legacy strings migrate to a single text block. Assistant messages may carry an optional `AnswerSourceLocator`; pending cross-page navigation is stored under a PointAsk-owned key so a service-worker restart cannot lose the requested destination.

## Answer locations and ownership

`LocalThread` always belongs to one source conversation and receives a monotonic `PA-NNN` display ID scoped to that conversation. Its `answerMode` controls routing:

- `workspace`: the thread references the source conversation's single `PointAskWorkspace`; multiple PA threads reuse its target URL but keep isolated message histories and pending IDs.
- `current_conversation`: the source URL is the target and no new tab is opened. The UI warns that the follow-up becomes part of the main ChatGPT history.
- `dedicated_branch`: the thread owns a dedicated target URL and never joins a Workspace automatically.

Prompt generation receives only one LocalThread's messages. Workspace prompts carry the display ID and explicitly prohibit continuing other PA threads. Workspace replacement updates references without deleting threads; deleting one thread only decrements Workspace metadata.

Ordinary Workspace follow-ups include the current `CTX-NNN` snapshot version but never include messages detected after the saved synchronization fingerprint. An outdated or uncertain snapshot remains usable. A manual context update is persisted on the Workspace, routed independently from PA pending-answer records, and removed atomically when the user confirms it was sent; this prevents the same update ID from being applied twice.
