import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChatGptAdapter } from '../src/adapters/chatgpt-adapter';
import { PendingAssociationCoordinator } from '../src/background/pending-association-coordinator';
import { buildPrompt } from '../src/bridge/prompt-builder';
import { QuestionComposerMount } from '../src/content/question-composer-mount';
import { readSelection } from '../src/content/selection-manager';
import type { LocalThread } from '../src/shared/local-thread';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { ThreadStore } from '../src/storage/thread-store';
import { chatGptFixture } from './fixtures/chatgpt';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function selectText(node: Text, start: number, end: number, capture = true) {
  const range = document.createRange();
  range.setStart(node, start); range.setEnd(node, end);
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(10, 20, 80, 18) });
  return readSelection(new ChatGptAdapter(), {
    rangeCount: 1, isCollapsed: false, getRangeAt: () => range, toString: () => range.toString(),
  } as unknown as Selection, capture);
}

describe('sanitized local end-to-end flow', () => {
  it('creates, associates, manually attaches, persists, restores, and deletes a thread', async () => {
    document.body.innerHTML = chatGptFixture;
    const sourceNode = document.getElementById('assistant-first')?.firstChild as Text;
    const selection = selectText(sourceNode, 3, 10);
    if (!selection?.textAnchor) throw new Error('Expected source anchor');

    let question = '';
    const composer = new QuestionComposerMount();
    await act(() => composer.open({ data: selection, onCancel: vi.fn(), onSubmit: (value) => { question = value; } }));
    const textarea = document.querySelector('pointask-question-composer')?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(() => { setter?.call(textarea, '为什么成立？'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve(); });
    expect(question).toBe('为什么成立？');

    const prompt = buildPrompt({
      selectedText: selection.selectedText, paragraphText: selection.paragraphText,
      userQuestion: question, mode: 'compact',
    });
    const pending = {
      id: 'pointask-e2e', sourcePageUrl: selection.sourcePageUrl, sourceConversationKey: selection.conversationKey,
      sourceMessageFingerprint: selection.messageFingerprint, anchor: selection.textAnchor, question,
      generatedPrompt: prompt, promptMode: 'compact' as const, status: 'waiting_for_answer' as const,
      displayId: 'PA-001', answerMode: 'dedicated_branch' as const,
      createdAt: selection.textAnchor.createdAt, updatedAt: selection.textAnchor.createdAt,
    };
    const coordinator = new PendingAssociationCoordinator(() => new Date('2026-07-12T01:00:00.000Z'));
    coordinator.create(pending, 1);
    coordinator.markTargetOpened(pending.id, 2, 'https://chatgpt.com/c/e2e-target');
    coordinator.associate(pending.id, 2, 'https://chatgpt.com/c/e2e-target');

    const targetNode = document.getElementById('assistant-other')?.firstChild as Text;
    const answerSelection = selectText(targetNode, 0, targetNode.data.length, false);
    if (!answerSelection) throw new Error('Expected target answer selection');
    const attached = coordinator.attachAnswer(pending.id, 2, answerSelection.selectedText, 'https://chatgpt.com/c/e2e-target', false);
    expect(attached?.localThread.messages.at(-1)).toMatchObject({ role: 'assistant', attachedManually: true });

    const driver = new MemoryStorageDriver();
    const store = new ThreadStore(driver);
    await store.upsert(attached?.localThread as LocalThread);
    expect((await store.get(pending.id))?.messages.at(-1)?.content).toEqual([{ type: 'text', content: answerSelection.selectedText }]);
    await store.delete(pending.id);
    expect(await store.get(pending.id)).toBeNull();
  });
});
