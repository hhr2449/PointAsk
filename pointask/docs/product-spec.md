# PointAsk Product Specification

## Goal and target users

PointAsk serves people who use ChatGPT for long or structured conversations and want to investigate a small claim, phrase, or paragraph without derailing the main thread. The current ChatGPT workflow makes a local clarification easy to lose, mix into the primary context, or manage manually across chats.

## Core scenario

A user selects a word, sentence, or short passage in an AI response and chooses “针对这里追问”. PointAsk prepares a contextual follow-up prompt. The user sends it in a new ChatGPT chat or a branch they create, then explicitly selects the answer and attaches it to the originating point. The attached local thread can later be expanded, collapsed, continued, restored after refresh, or deleted.

## MVP capabilities

- Select text inside a ChatGPT AI response.
- Show “针对这里追问”.
- Accept a local question.
- Generate a contextual local follow-up prompt.
- Copy that prompt to the clipboard.
- Create a pending thread.
- Open a new ChatGPT tab, or allow the user to create a branch manually.
- On the target page, remind the user to paste and send.
- Attach answer text only after the user selects it and explicitly requests attachment.
- Show the saved answer as a collapsible thread on the source page.
- Continue a local follow-up thread.
- Restore threads after refresh.
- Delete a thread.

## End-to-end user flow

1. The user selects text in a ChatGPT AI response.
2. PointAsk offers a local follow-up action.
3. The user enters a question.
4. PointAsk builds and copies a prompt and records a pending thread locally.
5. The user opens a new chat or manually creates a branch.
6. The user pastes and sends the prompt.
7. After ChatGPT responds, the user selects only the desired answer content.
8. The user chooses “附加到 PointAsk”.
9. PointAsk stores the attached text locally.
10. The source page restores and displays the collapsible local thread near its anchor.

## Isolation and user control

Local threads are PointAsk records and do not become messages in the original ChatGPT conversation. PointAsk may prepare and copy text, but the user must choose the destination and submit it. PointAsk never assumes that a generated response is ready to save: only an explicit selection followed by an attach action is accepted.

## Not in the MVP

The MVP does not include model API calls, a backend, user accounts, cloud sync, private ChatGPT API access, cookie or authentication access, automatic send actions, hidden-tab automation, automatic answer extraction, complete-conversation capture, or cross-browser support.

## Acceptance criteria

- The extension operates only on `https://chatgpt.com/*`.
- Every prompt submission and answer attachment requires a clear user action.
- A local follow-up does not add a message to the source conversation.
- Only explicitly selected answer content is stored.
- Threads persist locally across a source-page refresh and can be deleted.
- No API key, backend, account, private API, cookie, or authentication access is required.
- DOM uncertainty results in a safe no-op with no accidental page interaction.

