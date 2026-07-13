import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptAdapter } from '../src/adapters/chatgpt-adapter';
import type { SiteAdapter } from '../src/adapters/site-adapter';
import { MAX_SELECTION_LENGTH, readSelection, SelectionManager } from '../src/content/selection-manager';
import { chatGptFixture } from './fixtures/chatgpt';

function text(id: string): Text {
  const node = document.getElementById(id)?.firstChild;
  if (!(node instanceof Text)) throw new Error(`Missing text fixture: ${id}`);
  return node;
}

function rangeBetween(start: Text, startOffset: number, end = start, endOffset = end.data.length): Range {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  return range;
}

function fakeSelection(range: Range | null, selectedText?: string): Selection {
  return {
    rangeCount: range ? 1 : 0,
    isCollapsed: !range || range.collapsed,
    getRangeAt: () => range as Range,
    toString: () => selectedText ?? range?.toString() ?? '',
  } as unknown as Selection;
}

describe('ChatGPT selection boundary', () => {
  const adapter = new ChatGptAdapter();

  beforeAll(() => {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(10, 20, 80, 18),
    });
  });

  beforeEach(() => {
    document.body.innerHTML = chatGptFixture;
  });

  it('rejects an empty selection', () => {
    expect(readSelection(adapter, fakeSelection(null))).toBeNull();
  });

  it('rejects ordinary page text', () => {
    const range = rangeBetween(text('ordinary'), 0);
    expect(readSelection(adapter, fakeSelection(range))).toBeNull();
  });

  it('rejects a user message', () => {
    const range = rangeBetween(text('user-text'), 0);
    expect(readSelection(adapter, fakeSelection(range))).toBeNull();
  });

  it('accepts a selection inside one assistant paragraph', () => {
    const range = rangeBetween(text('assistant-first'), 3, text('assistant-first'), 11);
    const result = readSelection(adapter, fakeSelection(range));

    expect(result?.selectedText).toBe('脱敏回答，包含一');
    expect(result?.paragraphText).toBe('第一段脱敏回答，包含一个可供选择的事实。');
    expect(result?.assistantMessageText).toBeUndefined();
    expect(result?.conversationKey).toBe('https://chatgpt.com/c/local-fixture');
    expect(result?.sourcePageUrl).toBe(window.location.href);
  });

  it('rejects editable content', () => {
    const range = rangeBetween(text('editable'), 0);
    expect(readSelection(adapter, fakeSelection(range))).toBeNull();
  });

  it('rejects an input control selection', () => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('composer') as HTMLTextAreaElement);
    expect(readSelection(adapter, fakeSelection(range, '脱敏输入内容'))).toBeNull();
  });

  it('rejects PointAsk shadow UI', () => {
    const host = document.createElement('pointask-test-ui');
    host.dataset.pointaskOwned = 'true';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p id="pointask-copy">PointAsk 内容</p>';
    document.body.append(host);
    const node = shadow.getElementById('pointask-copy')?.firstChild as Text;
    const range = rangeBetween(node, 0);
    expect(readSelection(adapter, fakeSelection(range))).toBeNull();
  });

  it('rejects a selection across assistant messages', () => {
    const range = rangeBetween(text('assistant-first'), 0, text('assistant-other'), 3);
    expect(readSelection(adapter, fakeSelection(range))).toBeNull();
  });

  it('accepts a selection across adjacent block paragraphs in one assistant message', () => {
    const range = rangeBetween(text('assistant-first'), 0, text('assistant-second'), 3);
    const result = readSelection(adapter, fakeSelection(range));
    expect(result?.selectedText).toContain('第一段脱敏回答');
    expect(result?.selectedText).toContain('第二段');
    expect(result?.paragraphText).toContain('第一段脱敏回答');
    expect(result?.paragraphText).toContain('第二段脱敏回答');
  });

  it('rejects overlong selected text before message extraction', () => {
    const range = rangeBetween(text('assistant-first'), 0);
    expect(readSelection(adapter, fakeSelection(range, '字'.repeat(MAX_SELECTION_LENGTH + 1)))).toBeNull();
  });

  it('fails closed when the adapter cannot identify a message', () => {
    const range = rangeBetween(text('assistant-first'), 0);
    const uncertainAdapter = { ...adapter, isSupportedPage: () => true, findAssistantMessage: () => null } as unknown as SiteAdapter;
    expect(readSelection(uncertainAdapter, fakeSelection(range))).toBeNull();
  });
});

describe('ChatGptAdapter', () => {
  beforeEach(() => {
    document.body.innerHTML = chatGptFixture;
  });

  it('creates the same fingerprint for the same normalized message text', () => {
    const adapter = new ChatGptAdapter();
    const first = document.querySelector('[data-testid="conversation-turn-2"]') as HTMLElement;
    const clone = first.cloneNode(true) as HTMLElement;
    clone.querySelector('p')?.prepend('  ');
    expect(adapter.getMessageFingerprint(first)).toBe(adapter.getMessageFingerprint(clone));
  });

  it('does not depend on the conversation turn HTML tag name', () => {
    document.body.innerHTML = `
      <div data-testid="conversation-turn-tag-change">
        <div data-message-author-role="assistant"><div class="markdown"><p id="tag-change">脱敏回答</p></div></div>
      </div>`;
    const adapter = new ChatGptAdapter();
    expect(adapter.findAssistantMessage(document.getElementById('tag-change') as HTMLElement)?.tagName).toBe('DIV');
  });

  it('debounces page mutations and ignores PointAsk-owned insertions', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const stop = new ChatGptAdapter().observePageChanges(callback);
    document.body.append(document.createElement('div'), document.createElement('div'));
    await vi.runAllTimersAsync();
    expect(callback).toHaveBeenCalledTimes(1);

    const owned = document.createElement('pointask-test');
    owned.dataset.pointaskOwned = 'true';
    document.body.append(owned);
    await vi.runAllTimersAsync();
    expect(callback).toHaveBeenCalledTimes(1);
    stop();
    vi.useRealTimers();
  });

  it('does not register SelectionManager listeners or observers twice', () => {
    const adapter = new ChatGptAdapter();
    const observe = vi.spyOn(adapter, 'observePageChanges').mockReturnValue(vi.fn());
    const manager = new SelectionManager(adapter, vi.fn());
    manager.start();
    manager.start();
    expect(observe).toHaveBeenCalledTimes(1);
    manager.stop();
  });
});
