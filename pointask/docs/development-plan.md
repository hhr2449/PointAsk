# PointAsk Development Plan

## Stage 0 — foundation

Create documentation and a minimal Manifest V3 project using TypeScript, React, Vite, Vitest, and ESLint. Provide a content script, service worker, build pipeline, and development-only startup log. Do not implement product behavior.

## Later stages

Later work may introduce the adapter and selection boundary, Shadow DOM interaction UI, prompt and clipboard flow, pending-thread navigation, manual answer attachment, local persistence and anchoring, and lifecycle polish. Each stage must preserve explicit user control, local-only storage, adapter isolation, and safe failure.

Stage 0 intentionally contains no selection handling, question input, prompt generation, clipboard access, tab creation, answer attachment, or storage logic.

