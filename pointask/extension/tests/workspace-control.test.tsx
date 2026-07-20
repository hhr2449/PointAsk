import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { PendingAssociation } from '../src/bridge/runtime-messages';
import { WorkspaceControlCard } from '../src/components/workspace-control-card';
import { deriveWorkspaceControlState } from '../src/components/workspace-control-state';
import { defaultSelectedRoundIds } from '../src/components/round-selection-state';
import { PendingThreadManager } from '../src/bridge/pending-thread-manager';
import { PendingBannerManager } from '../src/content/pending-banner-manager';
import { WebConversationBridge } from '../src/bridge/web-conversation-bridge';
import { ClipboardManager } from '../src/bridge/clipboard-manager';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const timestamp = '2026-07-20T00:00:00.000Z';
function record(status: PendingAssociation['localThread']['status'] = 'waiting_for_submission'): PendingAssociation {
  const anchor = { pageUrl: 'https://chatgpt.com/c/source', sourcePageUrl: 'https://chatgpt.com/c/source', conversationKey: 'https://chatgpt.com/c/source',
    messageFingerprint: 'source-message', assistantMessageHash: 'source-message', selectedText: '静态作用域看函数定义', prefixText: '', suffixText: '',
    paragraphText: '静态作用域看函数定义', paragraphHash: 'hash', startOffset: 0, endOffset: 10, schemaVersion: 1, createdAt: timestamp };
  return { pendingThread: { id: 'pending-1', threadId: 'thread-1', roundId: 'q1', sourcePageUrl: anchor.sourcePageUrl,
    sourceConversationKey: anchor.conversationKey, sourceMessageFingerprint: anchor.messageFingerprint, anchor, question: '为什么不使用调用者变量？',
    generatedPrompt: 'prompt', promptMode: 'compact', status: status === 'failed' ? 'failed' : status === 'answer_attached' ? 'answer_attached' : 'waiting_for_submission',
    createdAt: timestamp, updatedAt: timestamp, displayId: 'PA-003', answerMode: 'workspace', promptHash: 'prompt-hash' },
  localThread: { id: 'thread-1', displayId: 'PA-003', answerMode: 'workspace', anchor, sourcePageUrl: anchor.sourcePageUrl,
    sourceConversationKey: anchor.conversationKey, sourceMessageFingerprint: anchor.messageFingerprint,
    messages: [{ id: 'q1', role: 'user', content: [{ type: 'text', content: '为什么不使用调用者变量？' }], attachedManually: false, createdAt: timestamp }],
    status, createdAt: timestamp, updatedAt: timestamp }, sourceTabId: 1, targetTabId: 2, targetConversationUrl: 'https://chatgpt.com/c/workspace',
  associationStatus: 'associated', createdAt: timestamp, updatedAt: timestamp };
}

const candidate = { element: document.createElement('article'), fingerprint: 'answer', streaming: false };

describe('Workspace control state', () => {
  it('maps each state to at most one primary action and does not duplicate sending text', () => {
    const states = [
      deriveWorkspaceControlState({ record: record(), reliable: false, sending: false, selectionLength: 0, returnFailed: false }),
      deriveWorkspaceControlState({ record: record(), reliable: false, sending: true, selectionLength: 0, returnFailed: false }),
      deriveWorkspaceControlState({ record: record('answer_ready'), candidate, reliable: true, sending: false, selectionLength: 0, returnFailed: false }),
      deriveWorkspaceControlState({ record: record('answer_ready'), candidate, reliable: true, sending: false, selectionLength: 12, returnFailed: false }),
      deriveWorkspaceControlState({ record: record('answer_ready'), candidate, reliable: false, sending: false, selectionLength: 0, returnFailed: false }),
      deriveWorkspaceControlState({ record: record('failed'), reliable: false, sending: false, selectionLength: 0, returnFailed: false }),
      deriveWorkspaceControlState({ record: record('answer_attached'), reliable: false, sending: false, selectionLength: 0, returnFailed: true }),
    ];
    expect(states.map((state) => state.primary)).toEqual(['send', undefined, 'attach_latest_return', 'attach_selection_return', undefined, 'retry', 'retry_return']);
    expect(states[1]?.label).toBe('正在发送');
  });

  it('defaults round selection to the latest unattached round and never an attached round', () => {
    const selected = defaultSelectedRoundIds([
      { id: 'q1', index: 1, question: '一', attached: true, latest: false },
      { id: 'q2', index: 2, question: '二', attached: false, latest: true },
    ]);
    expect([...selected]).toEqual(['q2']);
  });

  it('creates a fresh pending and round id while preserving the stable thread id', () => {
    let id = 0; const manager = new PendingThreadManager(() => new Date(timestamp), () => `pending-${++id}`);
    const first = manager.create({ anchor: record().pendingThread.anchor, question: '第一问', generatedPrompt: 'prompt-1', promptMode: 'compact' })!;
    const next = manager.prepareNext(first.id, '第二问', 'prompt-2', 'compact', [], 'round-2')!;
    expect(next.id).not.toBe(first.id); expect(next.threadId).toBe(first.id); expect(next.roundId).toBe('round-2');
    expect(manager.get(first.id)?.id).toBe(next.id);
  });
});

describe('Workspace control card', () => {
  it('expands/collapses with complementary semantics and renders only the state action', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const toggle = vi.fn();
    const value = record('answer_ready'); const state = deriveWorkspaceControlState({ record: value, candidate, reliable: true, sending: false, selectionLength: 0, returnFailed: false });
    await act(() => root.render(<WorkspaceControlCard record={value} records={[value]} state={state} expanded busy={false}
      onToggleExpanded={toggle} onSwitch={vi.fn()} onPrimary={vi.fn()} onReturn={vi.fn()} onContinue={vi.fn().mockResolvedValue(true)}
      onAttachRounds={vi.fn().mockResolvedValue(true)} onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    expect(container.querySelector('aside')?.getAttribute('role')).toBe('complementary');
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect([...container.querySelectorAll('button')].filter((button) => button.classList.contains('pointask-primary')).map((button) => button.textContent))
      .toEqual(['附加最新回答并返回']);
    await act(() => (container.querySelector('.pointask-control-toggle') as HTMLButtonElement).click()); expect(toggle).toHaveBeenCalledOnce();
    await act(() => root.unmount());
  });

  it('supports Enter submit, Shift+Enter newline intent, Escape cancel, and preserves failed input', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const onContinue = vi.fn().mockResolvedValue(false);
    const value = record('answer_attached'); const state = deriveWorkspaceControlState({ record: value, reliable: false, sending: false, selectionLength: 0, returnFailed: false });
    await act(() => root.render(<WorkspaceControlCard record={value} records={[value]} state={state} expanded busy={false}
      onToggleExpanded={vi.fn()} onSwitch={vi.fn()} onPrimary={vi.fn()} onReturn={vi.fn()} onContinue={onContinue}
      onAttachRounds={vi.fn().mockResolvedValue(true)} onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    const continueButton = [...container.querySelectorAll('button')].find((button) => button.textContent === '继续追问')!;
    await act(() => continueButton.click()); const textarea = container.querySelector('textarea')!;
    await act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; setter.call(textarea, '保留的问题'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onContinue).toHaveBeenCalledWith('保留的问题'); expect(container.querySelector('textarea')?.value).toBe('保留的问题');
    expect(container.textContent).toContain('输入内容已保留');
    await act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('textarea')).toBeNull(); await act(() => root.unmount());
  });

  it('keeps the continue draft when the same thread advances to a new pending round', async () => {
    const container = document.createElement('div'); const root = createRoot(container);
    const first = record('answer_attached');
    const state = deriveWorkspaceControlState({ record: first, reliable: false, sending: false, selectionLength: 0, returnFailed: false });
    const props = { records: [first], state, expanded: true, busy: false, onToggleExpanded: vi.fn(), onSwitch: vi.fn(), onPrimary: vi.fn(),
      onReturn: vi.fn(), onContinue: vi.fn().mockResolvedValue(false), onAttachRounds: vi.fn().mockResolvedValue(true), onClearSelection: vi.fn(),
      onAttachOnly: vi.fn(), onUnlink: vi.fn(), onCopyPrompt: vi.fn() };
    await act(() => root.render(<WorkspaceControlCard record={first} {...props} />));
    await act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '继续追问')!.click());
    const textarea = container.querySelector('textarea')!;
    await act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '不能丢失的继续追问'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    const next = { ...first, pendingThread: { ...first.pendingThread, id: 'pending-2', roundId: 'q2' },
      localThread: { ...first.localThread, messages: [...first.localThread.messages, {
        id: 'a1', role: 'assistant' as const, content: [{ type: 'text' as const, content: '第一轮回答' }], attachedManually: true, createdAt: timestamp,
      }] } };
    await act(() => root.render(<WorkspaceControlCard record={next} {...props} records={[next]} />));
    expect(container.querySelector('textarea')?.value).toBe('不能丢失的继续追问');
    await act(() => root.unmount());
  });

  it('switches active threads explicitly without mixing actions', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const onSwitch = vi.fn();
    const first = record(); const second = { ...record(), pendingThread: { ...record().pendingThread, id: 'pending-2' },
      localThread: { ...record().localThread, id: 'thread-2', displayId: 'PA-004' } };
    const state = deriveWorkspaceControlState({ record: first, reliable: false, sending: false, selectionLength: 0, returnFailed: false });
    await act(() => root.render(<WorkspaceControlCard record={first} records={[first, second]} state={state} expanded busy={false}
      onToggleExpanded={vi.fn()} onSwitch={onSwitch} onPrimary={vi.fn()} onReturn={vi.fn()} onContinue={vi.fn().mockResolvedValue(true)}
      onAttachRounds={vi.fn().mockResolvedValue(true)} onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    const select = container.querySelector('select')!;
    await act(() => { select.value = 'pending-2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onSwitch).toHaveBeenCalledWith('pending-2'); await act(() => root.unmount());
  });

  it('retries only return after an attachment has already succeeded', async () => {
    const attached = record('answer_attached');
    const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: '返回失败' });
    const manager = new PendingBannerManager(new WebConversationBridge({ sendMessage }), new ClipboardManager(undefined, () => false));
    await act(() => manager.applyRecord(attached));
    const internal = manager as unknown as { returnFailedIds: Set<string>; runWorkspacePrimary(id: string): Promise<void> };
    internal.returnFailedIds.add(attached.pendingThread.id);
    await act(async () => internal.runWorkspacePrimary(attached.pendingThread.id));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'pointask:pending-thread-updated', pendingThreadId: attached.pendingThread.id, action: 'return-source' });
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'pointask:attach-answer' }));
    await act(() => manager.stop());
  });
});
