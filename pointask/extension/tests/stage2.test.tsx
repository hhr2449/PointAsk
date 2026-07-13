import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_QUESTION_LENGTH } from '../src/components/question-composer';
import { QuestionComposerMount } from '../src/content/question-composer-mount';
import type { SelectionData } from '../src/content/selection-manager';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function selectionData(anchorElement = document.getElementById('anchor') as HTMLElement): SelectionData {
  return {
    selectedText: '脱敏选中文字',
    paragraphText: '包含脱敏选中文字的段落。',
    assistantMessageText: '脱敏回答全文。',
    messageFingerprint: 'fnv1a-test0001',
    conversationKey: 'https://chatgpt.com/c/local-fixture',
    sourcePageUrl: 'https://chatgpt.com/c/local-fixture',
    rangeRect: new DOMRect(10, 10, 100, 20),
    anchorElement,
    sourceMessageElement: anchorElement,
  };
}

function composerElements() {
  const host = document.querySelector('pointask-question-composer');
  const shadow = host?.shadowRoot;
  return {
    host,
    textarea: shadow?.querySelector('textarea') as HTMLTextAreaElement | null,
    send: [...(shadow?.querySelectorAll('button') ?? [])].find((button) => button.textContent === '发送') as HTMLButtonElement | undefined,
  };
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('question composer', () => {
  beforeEach(() => {
    document.body.innerHTML = '<p id="anchor">脱敏段落</p>';
  });

  it('opens, quotes the selection, focuses textarea and shows the character limit', async () => {
    const mount = new QuestionComposerMount();
    await act(() => mount.open({ data: selectionData(), onSubmit: vi.fn(), onCancel: vi.fn() }));
    const { host, textarea } = composerElements();
    expect(host?.shadowRoot?.textContent).toContain('脱敏选中文字');
    expect(host?.shadowRoot?.textContent).toContain(`0/${MAX_QUESTION_LENGTH}`);
    expect(host?.shadowRoot?.activeElement).toBe(textarea);
    await act(() => mount.close());
  });

  it('cancels with Escape', async () => {
    const onCancel = vi.fn();
    const mount = new QuestionComposerMount();
    await act(() => mount.open({ data: selectionData(), onSubmit: vi.fn(), onCancel }));
    await act(() => composerElements().textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(composerElements().host).toBeNull();
  });

  it('does not submit an empty question', async () => {
    const onSubmit = vi.fn();
    const mount = new QuestionComposerMount();
    await act(() => mount.open({ data: selectionData(), onSubmit, onCancel: vi.fn() }));
    expect(composerElements().send?.disabled).toBe(true);
    await act(async () => {
      composerElements().textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(() => mount.close());
  });

  it('submits with Enter', async () => {
    const onSubmit = vi.fn();
    const mount = new QuestionComposerMount();
    await act(() => mount.open({ data: selectionData(), onSubmit, onCancel: vi.fn() }));
    await act(() => setTextarea(composerElements().textarea as HTMLTextAreaElement, '为什么？'));
    await act(async () => {
      composerElements().textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledWith('为什么？', 'workspace');
  });

  it('submits to the answer location selected before the send click', async () => {
    const onSubmit = vi.fn();
    const mount = new QuestionComposerMount();
    await act(() => mount.open({ data: selectionData(), onSubmit, onCancel: vi.fn() }));
    const shadow = composerElements().host?.shadowRoot;
    const currentConversation = shadow?.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1];
    await act(() => currentConversation?.click());
    await act(() => setTextarea(composerElements().textarea as HTMLTextAreaElement, '发到当前对话'));
    await act(async () => { composerElements().send?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(onSubmit).toHaveBeenCalledWith('发到当前对话', 'current_conversation');
  });

  it('keeps the composer open on Shift+Enter', async () => {
    const onSubmit = vi.fn();
    const mount = new QuestionComposerMount();
    await act(() => mount.open({ data: selectionData(), onSubmit, onCancel: vi.fn() }));
    await act(() => setTextarea(composerElements().textarea as HTMLTextAreaElement, '第一行'));
    await act(() => composerElements().textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(composerElements().host).not.toBeNull();
    await act(() => mount.close());
  });
});
