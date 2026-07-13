import { act } from 'react';
import type { Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardManager } from '../src/bridge/clipboard-manager';
import { PendingThreadManager } from '../src/bridge/pending-thread-manager';
import { buildPrompt } from '../src/bridge/prompt-builder';
import { InlineThreadManager } from '../src/content/inline-thread-manager';
import type { SelectionData } from '../src/content/selection-manager';
import type { LocalThread, TextAnchor } from '../src/shared/local-thread';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const anchor: TextAnchor = {
  pageUrl: 'https://chatgpt.com/c/local-fixture', prefixText: '', suffixText: '', paragraphHash: 'hash-paragraph',
  assistantMessageHash: 'hash-message', startOffset: 0, endOffset: 4, schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z',
  selectedText: '局部事实',
  paragraphText: '这是包含局部事实的脱敏段落。',
  messageFingerprint: 'fnv1a-stage3',
  conversationKey: 'https://chatgpt.com/c/local-fixture',
  sourcePageUrl: 'https://chatgpt.com/c/local-fixture',
};

function selectionData(): SelectionData {
  return {
    ...anchor,
    assistantMessageText: '这是一条完整但脱敏的 assistant 回答。',
    rangeRect: new DOMRect(10, 20, 80, 18),
    anchorElement: document.getElementById('anchor') as HTMLElement,
    sourceMessageElement: document.getElementById('anchor') as HTMLElement,
  };
}

describe('prompt builder', () => {
  it('builds a stable compact prompt without the complete assistant message', () => {
    const input = { ...anchor, userQuestion: '这个结论为什么成立？', assistantMessageText: '不应出现的全文', mode: 'compact' as const };
    const first = buildPrompt(input);
    expect(first).toBe(buildPrompt(input));
    expect(first).toContain('“局部事实”');
    expect(first).toContain('这个结论为什么成立？');
    expect(first).not.toContain('不应出现的全文');
  });

  it('adds the current assistant message only in contextual mode', () => {
    const prompt = buildPrompt({
      ...anchor,
      userQuestion: '请说明依据。',
      assistantMessageText: '当前回答的脱敏完整上下文',
      mode: 'contextual',
    });
    expect(prompt).toContain('当前 AI 回答的相关上下文');
    expect(prompt).toContain('当前回答的脱敏完整上下文');
  });

  it('omits empty fields and headings', () => {
    const prompt = buildPrompt({ selectedText: '', paragraphText: ' ', userQuestion: '问题', mode: 'compact' });
    expect(prompt).not.toContain('选中的内容：');
    expect(prompt).not.toContain('选中内容所在段落：');
    expect(prompt).not.toContain('当前 AI 回答的相关上下文');
    expect(prompt).toContain('我的问题：\n问题');
  });

  it('truncates long source context but preserves the complete user question', () => {
    const question = `请解释：${'问'.repeat(700)}`;
    const prompt = buildPrompt({
      selectedText: '选'.repeat(3_000),
      paragraphText: '段'.repeat(6_000),
      assistantMessageText: '文'.repeat(13_000),
      userQuestion: question,
      mode: 'contextual',
    });
    expect(prompt.match(/已截断/g)?.length).toBe(3);
    expect(prompt).toContain(question);
    expect(prompt.length).toBeLessThan(20_000);
  });

  it('includes necessary local multi-turn history', () => {
    const prompt = buildPrompt({
      ...anchor,
      userQuestion: '那第二点呢？',
      previousLocalMessages: [
        { id: 'm1', role: 'user', content: [{ type: 'text', content: '先解释第一点。' }], attachedManually: false, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: [{ type: 'text', content: '第一点的局部回答。' }], attachedManually: true, createdAt: '2026-01-01T00:01:00.000Z' },
      ],
      mode: 'compact',
    });
    expect(prompt).toContain('以下是这个局部线程此前的必要内容');
    expect(prompt).toContain('用户：先解释第一点。');
    expect(prompt).toContain('局部回答：第一点的局部回答。');
  });

  it('does not recursively nest an earlier generated prompt', () => {
    const priorPrompt = buildPrompt({ ...anchor, userQuestion: '第一问', mode: 'compact' });
    const prompt = buildPrompt({
      ...anchor,
      userQuestion: '第二问',
      previousLocalMessages: [{ id: 'm1', role: 'user', content: [{ type: 'text', content: priorPrompt }], attachedManually: false, createdAt: '2026-01-01T00:00:00.000Z' }],
      mode: 'compact',
    });
    expect(prompt.split('我正在阅读一段 AI 回答').length - 1).toBe(1);
    expect(prompt).not.toContain('以下是这个局部线程此前的必要内容');
  });
});

describe('clipboard manager', () => {
  it('reports Clipboard API success without reading existing clipboard data', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const manager = new ClipboardManager({ writeText }, vi.fn());
    await expect(manager.copy('脱敏提示词')).resolves.toEqual({ success: true, method: 'clipboard-api' });
    expect(writeText).toHaveBeenCalledWith('脱敏提示词');
  });

  it('reports failure when permission and fallback copy both fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const fallback = vi.fn().mockReturnValue(false);
    const manager = new ClipboardManager({ writeText }, fallback);
    const result = await manager.copy('脱敏提示词');
    expect(result.success).toBe(false);
    expect(result.error).toContain('拒绝');
    expect(fallback).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea[data-pointask-owned="true"]')).toBeNull();
  });
});

describe('pending thread manager', () => {
  it('creates and deletes a submitted pending thread', () => {
    const now = new Date('2026-07-12T00:00:00.000Z');
    const manager = new PendingThreadManager(() => now, () => 'pointask-pending-test');
    const pending = manager.create({ anchor, question: '局部问题', generatedPrompt: '生成提示词', promptMode: 'compact' });
    expect(pending).toMatchObject({
      id: 'pointask-pending-test',
      status: 'prompt_ready',
      sourceConversationKey: anchor.conversationKey,
      sourceMessageFingerprint: anchor.messageFingerprint,
      createdAt: now.toISOString(),
    });
    expect(manager.delete('pointask-pending-test')).toBe(true);
    expect(manager.get('pointask-pending-test')).toBeNull();
  });

  it('does not save an unsubmitted empty draft', () => {
    const manager = new PendingThreadManager();
    expect(manager.create({ anchor, question: '  ', generatedPrompt: '提示词', promptMode: 'compact' })).toBeNull();
    expect(manager.create({ anchor, question: '问题', generatedPrompt: ' ', promptMode: 'compact' })).toBeNull();
    expect(manager.list()).toHaveLength(0);
  });
});

describe('pending thread card flow', () => {
  beforeEach(() => {
    document.body.innerHTML = '<p id="anchor">脱敏段落</p>';
  });

  it('creates prompt-ready UI, copies on click, then waits for an answer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const pending = new PendingThreadManager(undefined, () => 'pointask-pending-ui');
    const manager = new InlineThreadManager(pending, new ClipboardManager({ writeText }, vi.fn()));
    let id: string | null = null;
    await act(async () => { id = await manager.create(selectionData(), '为什么?', 'dedicated_branch'); });
    expect(id).toBe('pointask-pending-ui');
    const threadId = id;
    if (!threadId) throw new Error('Expected a pending thread ID');
    await act(() => manager.toggle(threadId));
    expect(manager.getThread(threadId)?.status).toBe('prompt_ready');
    expect(manager.getHost(threadId)?.shadowRoot?.textContent).toContain('等待你填入并手动发送');

    await act(async () => { await manager.copy(threadId); });
    expect(writeText).toHaveBeenCalledOnce();
    expect(manager.getHost(threadId)?.shadowRoot?.textContent).toContain('备用：复制提示词');

    await act(() => manager.next(threadId));
    expect(manager.getThread(threadId)?.status).toBe('waiting_for_answer');
    expect(pending.get(threadId)?.status).toBe('waiting_for_answer');
    expect(manager.getHost(threadId)?.shadowRoot?.textContent).toContain('正在等待 ChatGPT 回答');
  });

  it('deletes pending data, unmounts its React root, and removes its host', () => {
    const unmount = vi.fn();
    const fakeRoot = { render: vi.fn(), unmount } as unknown as Root;
    const pending = new PendingThreadManager(undefined, () => 'pointask-pending-delete');
    const manager = new InlineThreadManager(pending, new ClipboardManager(undefined, () => false), undefined, () => fakeRoot);
    const thread: LocalThread = {
      displayId: 'PA-001', answerMode: 'dedicated_branch',
      id: 'pointask-pending-delete',
      anchor,
      sourcePageUrl: anchor.sourcePageUrl,
      sourceConversationKey: anchor.conversationKey,
      sourceMessageFingerprint: anchor.messageFingerprint,
      messages: [{ id: 'q1', role: 'user', content: [{ type: 'text', content: '问题' }], attachedManually: false, createdAt: '2026-01-01T00:00:00.000Z' }],
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    pending.create({ anchor, question: '问题', generatedPrompt: '提示词', promptMode: 'compact' });
    manager.mount(thread, selectionData().anchorElement);
    const host = manager.getHost(thread.id);
    manager.delete(thread.id);
    expect(unmount).toHaveBeenCalledOnce();
    expect(host?.isConnected).toBe(false);
    expect(pending.get(thread.id)).toBeNull();
  });
});
