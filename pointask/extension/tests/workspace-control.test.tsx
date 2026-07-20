import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { PendingAssociation } from '../src/bridge/runtime-messages';
import { WorkspaceControlCard } from '../src/components/workspace-control-card';
import { deriveWorkspaceControlState } from '../src/components/workspace-control-state';
import { defaultSelectedRoundIds, validSelectedRoundIds } from '../src/components/round-selection-state';
import { PendingThreadManager } from '../src/bridge/pending-thread-manager';
import { PendingBannerManager } from '../src/content/pending-banner-manager';
import { WebConversationBridge } from '../src/bridge/web-conversation-bridge';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { WorkspaceStore } from '../src/storage/workspace-store';
import type { PointAskWorkspace } from '../src/shared/local-thread';
import { deriveWorkspaceControlVisibility, isActiveWorkspaceThread } from '../src/components/workspace-control-visibility';

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

function workspace(): PointAskWorkspace {
  return { id: 'workspace-1', sourceConversationKey: 'https://chatgpt.com/c/source', sourceConversationUrl: 'https://chatgpt.com/c/source',
    targetConversationUrl: 'https://chatgpt.com/c/local-fixture', workspaceType: 'new_conversation', threadCount: 1,
    approximateContentLength: 20, contextState: { contextVersion: 1, unsyncedMessageCount: 0, unsyncedTurnCount: 0, status: 'fresh' },
    createdAt: timestamp, updatedAt: timestamp };
}

function workspaceRecord(id = 'thread-1', displayId = 'PA-003', status: PendingAssociation['localThread']['status'] = 'waiting_for_submission') {
  const value = record(status);
  return { ...value, pendingThread: { ...value.pendingThread, id: `pending-${id}`, threadId: id, workspaceId: 'workspace-1', displayId,
    targetConversationUrl: 'https://chatgpt.com/c/local-fixture' }, localThread: { ...value.localThread, id, displayId, workspaceId: 'workspace-1' },
  targetConversationUrl: 'https://chatgpt.com/c/local-fixture' };
}

function runtimeFor(records: PendingAssociation[]) {
  const listeners = new Set<(message: unknown) => void>();
  return { sendMessage: vi.fn().mockImplementation((message: { type: string }) => Promise.resolve(message.type === 'pointask:get-page-pending-threads'
    ? { ok: true, data: records } : { ok: true, data: records[0] })), onMessage: {
    addListener: (listener: (message: unknown) => void) => listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => listeners.delete(listener),
  } };
}

describe('Workspace control state', () => {
  it('derives active and display state from persisted round lifecycle instead of activeThreadId', () => {
    expect(isActiveWorkspaceThread(workspaceRecord())).toBe(true);
    expect(isActiveWorkspaceThread(workspaceRecord('done', 'PA-004', 'answer_attached'))).toBe(false);
    expect(deriveWorkspaceControlVisibility(true, 0, false)).toBe('collapsed_idle');
    expect(deriveWorkspaceControlVisibility(true, 1, false)).toBe('collapsed_active');
    expect(deriveWorkspaceControlVisibility(false, 1, true)).toBe('hidden');
  });
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
    expect(states.map((state) => state.primary)).toEqual(['send', undefined, 'attach_default_return', 'attach_selection_return', undefined, 'retry', 'retry_return']);
    expect(states[1]?.label).toBe('正在发送');
  });

  it('defaults round selection to every reliable unattached round and never an attached or ambiguous round', () => {
    const selected = defaultSelectedRoundIds([
      { id: 'q1', index: 1, question: '一', attached: true, latest: false, reliable: false },
      { id: 'q2', index: 2, question: '二', attached: false, latest: false, reliable: true },
      { id: 'q3', index: 3, question: '三', attached: false, latest: false, reliable: false },
      { id: 'q4', index: 4, question: '四', attached: false, latest: true, reliable: true },
      { id: 'q5', index: 5, question: '五', attached: false, latest: false, reliable: true, persistenceStatus: 'capture_failed' },
    ]);
    expect([...selected]).toEqual(['q2', 'q4']);
    expect([...validSelectedRoundIds([
      { id: 'q2', index: 2, question: '二', attached: false, latest: false, reliable: false },
      { id: 'q4', index: 4, question: '四', attached: true, latest: true, reliable: false },
    ], selected)]).toEqual([]);
  });

  it('labels single, all, and incremental attachment actions from round counts', () => {
    const value = record('answer_ready');
    const derive = (attachableRoundCount: number, totalRoundCount: number, attachedRoundCount: number) =>
      deriveWorkspaceControlState({ record: value, candidate, reliable: true, sending: false, selectionLength: 0,
        returnFailed: false, attachableRoundCount, totalRoundCount, attachedRoundCount }).primaryLabel;
    expect(derive(1, 1, 0)).toBe('附加本轮并返回');
    expect(derive(3, 3, 0)).toBe('附加全部 3 轮并返回');
    expect(derive(2, 3, 1)).toBe('附加新增 2 轮并返回');
  });

  it('creates a fresh pending and round id while preserving the stable thread id', () => {
    let id = 0; const manager = new PendingThreadManager(() => new Date(timestamp), () => `pending-${++id}`);
    const first = manager.create({ anchor: record().pendingThread.anchor, question: '第一问', generatedPrompt: 'prompt-1', promptMode: 'compact' })!;
    const next = manager.prepareNext(first.id, '第二问', 'prompt-2', 'compact', [], 'round-2')!;
    expect(next.id).not.toBe(first.id); expect(next.threadId).toBe(first.id); expect(next.roundId).toBe('round-2');
    expect(manager.get(first.id)?.id).toBe(next.id);
  });
});

describe('Workspace control visibility recovery', () => {
  it('shows an active card and preserves a user collapse across state changes and page reopen', async () => {
    const driver = new MemoryStorageDriver(); const store = new WorkspaceStore(driver); await store.upsert(workspace());
    const active = workspaceRecord(); const runtime = runtimeFor([active]);
    const first = new PendingBannerManager(new WebConversationBridge(runtime), new ClipboardManager(undefined, () => false), undefined, undefined, store);
    await act(async () => first.start());
    let host = document.querySelector<HTMLElement>('pointask-pending-thread-banner')!;
    expect(host.shadowRoot?.textContent).toContain('PA-003');
    await act(() => (host.shadowRoot?.querySelector('.pointask-control-toggle') as HTMLButtonElement).click());
    expect(host.shadowRoot?.querySelector('.pointask-workspace-control')?.classList.contains('pointask-collapsed')).toBe(true);
    await act(() => first.applyRecord({ ...active, localThread: { ...active.localThread, status: 'answer_ready' } }));
    expect(host.shadowRoot?.querySelector('.pointask-workspace-control')?.classList.contains('pointask-collapsed')).toBe(true);
    await act(() => first.stop());

    const reopened = new PendingBannerManager(new WebConversationBridge(runtime), new ClipboardManager(undefined, () => false), undefined, undefined, store);
    await act(async () => reopened.start()); host = document.querySelector('pointask-pending-thread-banner')!;
    expect(host.shadowRoot?.querySelector('.pointask-workspace-control')?.classList.contains('pointask-collapsed')).toBe(true);
    expect((await store.get('workspace-1'))?.controlCardState).toMatchObject({ collapsed: true, activeThreadId: 'thread-1' });
    await act(() => reopened.stop());
  });

  it('keeps a compact idle entry on a Workspace and hides the control elsewhere', async () => {
    const driver = new MemoryStorageDriver(); const store = new WorkspaceStore(driver); await store.upsert(workspace());
    const idle = new PendingBannerManager(new WebConversationBridge(runtimeFor([])), new ClipboardManager(undefined, () => false), undefined, undefined, store);
    await act(async () => idle.start());
    let host = document.querySelector<HTMLElement>('pointask-pending-thread-banner')!;
    expect(host.style.display).toBe('block'); expect(host.shadowRoot?.textContent).toContain('暂无活跃追问');
    expect(host.shadowRoot?.querySelector('.pointask-workspace-control')?.classList.contains('pointask-collapsed')).toBe(true);
    await act(() => idle.stop());

    const hidden = new PendingBannerManager(new WebConversationBridge(runtimeFor([])), new ClipboardManager(undefined, () => false));
    await act(async () => hidden.start()); host = document.querySelector<HTMLElement>('pointask-pending-thread-banner')!;
    expect(host.style.display).toBe('none'); await act(() => hidden.stop());
  });

  it('revalidates an invalid hint, restores a unique active thread, and does not guess among multiple threads', async () => {
    const driver = new MemoryStorageDriver(); const store = new WorkspaceStore(driver); await store.upsert({ ...workspace(), controlCardState: {
      collapsed: true, activeThreadId: 'missing-thread', hasAutoExpanded: true, updatedAt: timestamp,
    } });
    const only = workspaceRecord('thread-2', 'PA-004');
    const unique = new PendingBannerManager(new WebConversationBridge(runtimeFor([only])), new ClipboardManager(undefined, () => false), undefined, undefined, store);
    await act(async () => unique.start());
    expect(document.querySelector('pointask-pending-thread-banner')?.shadowRoot?.textContent).toContain('PA-004');
    expect((await store.get('workspace-1'))?.controlCardState?.activeThreadId).toBe('thread-2');
    await act(() => unique.stop());

    await store.updateControlCardState('workspace-1', { collapsed: true, activeThreadId: 'missing-again', hasAutoExpanded: true, updatedAt: timestamp });
    const values = [workspaceRecord('thread-2', 'PA-004'), workspaceRecord('thread-3', 'PA-005')];
    const multiple = new PendingBannerManager(new WebConversationBridge(runtimeFor(values)), new ClipboardManager(undefined, () => false), undefined, undefined, store);
    await act(async () => multiple.start()); const shadow = document.querySelector('pointask-pending-thread-banner')?.shadowRoot;
    expect(shadow?.textContent).toContain('2 个待处理追问，请选择线程');
    expect((shadow?.querySelector('select') as HTMLSelectElement).value).toBe('');
    expect((await store.get('workspace-1'))?.controlCardState?.activeThreadId).toBeUndefined();
    await act(() => multiple.stop());
  });

  it('switches to idle after completion and does not duplicate the host during DOM redraw', async () => {
    const driver = new MemoryStorageDriver(); const store = new WorkspaceStore(driver); await store.upsert(workspace());
    const active = workspaceRecord(); const manager = new PendingBannerManager(new WebConversationBridge(runtimeFor([active])),
      new ClipboardManager(undefined, () => false), undefined, undefined, store);
    await act(async () => manager.start());
    document.body.append(document.createElement('div'));
    expect(document.querySelectorAll('pointask-pending-thread-banner')).toHaveLength(1);
    await act(() => manager.applyRecord({ ...active, associationStatus: 'completed', localThread: { ...active.localThread, status: 'answer_attached' } }));
    const shadow = document.querySelector('pointask-pending-thread-banner')?.shadowRoot;
    expect(shadow?.textContent).toContain('暂无活跃追问');
    expect(shadow?.querySelector('.pointask-workspace-control')?.classList.contains('pointask-collapsed')).toBe(true);
    await act(() => manager.stop());
  });
});

describe('Workspace control card', () => {
  it('expands/collapses with complementary semantics and renders only the state action', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const toggle = vi.fn();
    const value = record('answer_ready'); const state = deriveWorkspaceControlState({ record: value, candidate, reliable: true, sending: false, selectionLength: 0, returnFailed: false });
    await act(() => root.render(<WorkspaceControlCard record={value} records={[value]} rounds={[{ id: 'q1', index: 1, question: '问题', attached: false, latest: true, reliable: true }]} state={state} expanded busy={false}
      onToggleExpanded={toggle} onSwitch={vi.fn()} onPrimary={vi.fn()} onReturn={vi.fn()} onContinue={vi.fn().mockResolvedValue(true)}
      onAttachRounds={vi.fn().mockResolvedValue(true)} onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    expect(container.querySelector('aside')?.getAttribute('role')).toBe('complementary');
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect([...container.querySelectorAll('button')].filter((button) => button.classList.contains('pointask-primary')).map((button) => button.textContent))
      .toEqual(['附加本轮并返回']);
    await act(() => (container.querySelector('.pointask-control-toggle') as HTMLButtonElement).click()); expect(toggle).toHaveBeenCalledOnce();
    await act(() => root.unmount());
  });

  it('supports Enter submit, Shift+Enter newline intent, Escape cancel, and preserves failed input', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const onContinue = vi.fn().mockResolvedValue(false);
    const value = record('answer_attached'); const state = deriveWorkspaceControlState({ record: value, reliable: false, sending: false, selectionLength: 0, returnFailed: false });
    await act(() => root.render(<WorkspaceControlCard record={value} records={[value]} rounds={[{ id: 'q1', index: 1, question: '问题', attached: true, latest: true, reliable: false }]} state={state} expanded busy={false}
      onToggleExpanded={vi.fn()} onSwitch={vi.fn()} onPrimary={vi.fn()} onReturn={vi.fn()} onContinue={onContinue}
      onAttachRounds={vi.fn().mockResolvedValue(true)} onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    const continueButton = [...container.querySelectorAll('button')].find((button) => button.textContent === '继续追问')!;
    await act(() => continueButton.click()); const textarea = container.querySelector('textarea')!;
    await act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; setter.call(textarea, '保留的问题'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onContinue).toHaveBeenCalledWith('保留的问题', false); expect(container.querySelector('textarea')?.value).toBe('保留的问题');
    expect(container.textContent).toContain('输入内容已保留');
    await act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('textarea')).toBeNull(); await act(() => root.unmount());
  });

  it('keeps the continue draft when the same thread advances to a new pending round', async () => {
    const container = document.createElement('div'); const root = createRoot(container);
    const first = record('answer_attached');
    const state = deriveWorkspaceControlState({ record: first, reliable: false, sending: false, selectionLength: 0, returnFailed: false });
    const props = { records: [first], rounds: [{ id: 'q1', index: 1, question: '问题', attached: true, latest: true, reliable: false }], state, expanded: true, busy: false, onToggleExpanded: vi.fn(), onSwitch: vi.fn(), onPrimary: vi.fn(),
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
    await act(() => root.render(<WorkspaceControlCard record={next} {...props} records={[next]} rounds={[...props.rounds,
      { id: 'q2', index: 2, question: '继续', attached: false, latest: true, reliable: false }]} />));
    expect(container.querySelector('textarea')?.value).toBe('不能丢失的继续追问');
    await act(() => root.unmount());
  });

  it('keeps the draft and offers retry staging or continue without staging after capture failure', async () => {
    const container = document.createElement('div'); const root = createRoot(container);
    const value = record('answer_ready');
    const state = deriveWorkspaceControlState({ record: value, candidate, reliable: true, sending: false, selectionLength: 0,
      returnFailed: false, canContinue: true });
    const onContinue = vi.fn().mockResolvedValueOnce({ ok: false, captureFailed: true, error: '当前回答暂存失败' }).mockResolvedValue({ ok: true });
    await act(() => root.render(<WorkspaceControlCard record={value} records={[value]} rounds={[{ id: 'q1', index: 1, question: '问题',
      attached: false, latest: true, reliable: false, persistenceStatus: 'capture_failed' }]} state={state} expanded busy={false}
      onToggleExpanded={vi.fn()} onSwitch={vi.fn()} onPrimary={vi.fn()} onReturn={vi.fn()} onContinue={onContinue}
      onAttachRounds={vi.fn().mockResolvedValue(true)} onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    await act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '继续追问')!.click());
    const textarea = container.querySelector('textarea')!;
    await act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '保留输入'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '发送追问')!.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('当前回答暂存失败');
    expect(container.textContent).toContain('重试暂存');
    expect(container.textContent).toContain('继续但不暂存');
    expect(container.querySelector('textarea')?.value).toBe('保留输入');
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '继续但不暂存')!.click(); await Promise.resolve(); });
    expect(onContinue).toHaveBeenLastCalledWith('保留输入', true);
    expect(container.querySelector('textarea')).toBeNull();
    await act(() => root.unmount());
  });

  it('switches active threads explicitly without mixing actions', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const onSwitch = vi.fn();
    const first = record(); const second = { ...record(), pendingThread: { ...record().pendingThread, id: 'pending-2' },
      localThread: { ...record().localThread, id: 'thread-2', displayId: 'PA-004' } };
    const state = deriveWorkspaceControlState({ record: first, reliable: false, sending: false, selectionLength: 0, returnFailed: false });
    await act(() => root.render(<WorkspaceControlCard record={first} records={[first, second]} rounds={[{ id: 'q1', index: 1, question: '问题', attached: false, latest: true, reliable: false }]} state={state} expanded busy={false}
      onToggleExpanded={vi.fn()} onSwitch={onSwitch} onPrimary={vi.fn()} onReturn={vi.fn()} onContinue={vi.fn().mockResolvedValue(true)}
      onAttachRounds={vi.fn().mockResolvedValue(true)} onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    const select = container.querySelector('select')!;
    await act(() => { select.value = 'pending-2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onSwitch).toHaveBeenCalledWith('pending-2'); await act(() => root.unmount());
  });

  it('selects all reliable rounds by default and allows excluding one round', async () => {
    const container = document.createElement('div'); const root = createRoot(container);
    const value = record('answer_ready');
    const state = deriveWorkspaceControlState({ record: value, candidate, reliable: true, sending: false, selectionLength: 0,
      returnFailed: false, attachableRoundCount: 2, totalRoundCount: 3, attachedRoundCount: 1 });
    const onAttachRounds = vi.fn().mockResolvedValue(true);
    await act(() => root.render(<WorkspaceControlCard record={value} records={[value]} rounds={[
      { id: 'q1', index: 1, question: '已附加', attached: true, latest: false, reliable: false },
      { id: 'q2', index: 2, question: '第二问', attached: false, latest: false, reliable: true },
      { id: 'q3', index: 3, question: '第三问', attached: false, latest: true, reliable: true },
    ]} state={state} expanded busy={false} onToggleExpanded={vi.fn()} onSwitch={vi.fn()} onPrimary={vi.fn()}
      onReturn={vi.fn()} onContinue={vi.fn().mockResolvedValue(true)} onAttachRounds={onAttachRounds}
      onClearSelection={vi.fn()} onAttachOnly={vi.fn()} onUnlink={vi.fn()} onCopyPrompt={vi.fn()} />));
    await act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '选择附加内容')!.click());
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes.map((checkbox) => [checkbox.disabled, checkbox.checked])).toEqual([[true, true], [false, true], [false, true]]);
    await act(() => checkboxes[1]!.click());
    await act(async () => {
      [...container.querySelectorAll('button')].find((button) => button.textContent === '附加所选并返回')!.click();
      await Promise.resolve();
    });
    expect(onAttachRounds).toHaveBeenCalledWith(['q3']);
    await act(() => root.unmount());
  });

  it('removes a selected round when it becomes unavailable and does not revive stale selection state', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const value = record('answer_ready');
    const state = deriveWorkspaceControlState({ record: value, candidate, reliable: true, sending: false, selectionLength: 0,
      returnFailed: false, attachableRoundCount: 1, totalRoundCount: 2, attachedRoundCount: 0 });
    const onAttachRounds = vi.fn().mockResolvedValue(true);
    const props = { record: value, records: [value], state, expanded: true, busy: false, onToggleExpanded: vi.fn(), onSwitch: vi.fn(),
      onPrimary: vi.fn(), onReturn: vi.fn(), onContinue: vi.fn().mockResolvedValue(true), onAttachRounds, onClearSelection: vi.fn(),
      onAttachOnly: vi.fn(), onUnlink: vi.fn(), onCopyPrompt: vi.fn() };
    const reliableRounds = [
      { id: 'q1', index: 1, question: '第一问', attached: false, latest: false, reliable: false },
      { id: 'q2', index: 2, question: '第二问', attached: false, latest: true, reliable: true },
    ];
    await act(() => root.render(<WorkspaceControlCard {...props} rounds={reliableRounds} />));
    await act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '选择附加内容')!.click());
    expect((container.querySelector('.pointask-primary') as HTMLButtonElement).disabled).toBe(false);
    const unavailableRounds = reliableRounds.map((round) => round.id === 'q2' ? { ...round, reliable: false } : round);
    await act(() => root.render(<WorkspaceControlCard {...props} rounds={unavailableRounds} />));
    expect((container.querySelector('.pointask-primary') as HTMLButtonElement).disabled).toBe(true);
    await act(() => root.render(<WorkspaceControlCard {...props} rounds={reliableRounds} />));
    expect((container.querySelector('.pointask-primary') as HTMLButtonElement).disabled).toBe(true);
    expect(onAttachRounds).not.toHaveBeenCalled();
    await act(() => root.unmount());
  });

  it('keeps the latest selected when it changes from stageable to staged', async () => {
    const container = document.createElement('div'); const root = createRoot(container); const value = record('answer_ready');
    const state = deriveWorkspaceControlState({ record: value, candidate, reliable: true, sending: false, selectionLength: 0,
      returnFailed: false, attachableRoundCount: 1, stagedRoundCount: 0, totalRoundCount: 2, attachedRoundCount: 0 });
    const onAttachRounds = vi.fn().mockResolvedValue(true);
    const props = { record: value, records: [value], state, expanded: true, busy: false, onToggleExpanded: vi.fn(), onSwitch: vi.fn(),
      onPrimary: vi.fn(), onReturn: vi.fn(), onContinue: vi.fn().mockResolvedValue(true), onAttachRounds, onClearSelection: vi.fn(),
      onAttachOnly: vi.fn(), onUnlink: vi.fn(), onCopyPrompt: vi.fn() };
    const before = [
      { id: 'q1', index: 1, question: '第一问', attached: false, latest: false, reliable: false },
      { id: 'q2', index: 2, question: '第二问', attached: false, latest: true, reliable: false, stageable: true,
        persistenceStatus: 'not_captured' as const },
    ];
    await act(() => root.render(<WorkspaceControlCard {...props} rounds={before} />));
    await act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '选择附加内容')!.click());
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][1]?.checked).toBe(true);
    const after = before.map((round) => round.id === 'q2' ? { ...round, reliable: true, stageable: false,
      persistenceStatus: 'staged' as const } : round);
    await act(() => root.render(<WorkspaceControlCard {...props} rounds={after} />));
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '附加所选并返回')!.click();
      await Promise.resolve(); });
    expect(onAttachRounds).toHaveBeenCalledWith(['q2']);
    await act(() => root.unmount());
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
