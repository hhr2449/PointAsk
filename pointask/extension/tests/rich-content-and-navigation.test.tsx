import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChatGptAdapter } from '../src/adapters/chatgpt-adapter';
import { extractLatex, extractRichContent } from '../src/adapters/rich-content-extractor';
import { RichContentRenderer, richContentStyles } from '../src/components/rich-content-renderer';
import { ViewAnchorController } from '../src/content/view-anchor-controller';
import { migrateStorage } from '../src/storage/migration';
import { STORAGE_KEYS } from '../src/storage/storage-schema';
import { stableTextHash } from '../src/shared/text-utils';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { NavigationStore } from '../src/storage/navigation-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function range(start: Node, startOffset: number, end: Node, endOffset: number): Range {
  const result = document.createRange(); result.setStart(start, startOffset); result.setEnd(end, endOffset); return result;
}

describe('rich ChatGPT content', () => {
  it('extracts text plus an atomic ending formula using TeX annotation', () => {
    document.body.innerHTML = '<p id="p">能量 <span class="katex"><span>零散视觉字符</span><math><semantics><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span></p>';
    const paragraph = document.getElementById('p')!;
    const text = paragraph.firstChild!;
    const annotation = paragraph.querySelector('annotation')!.firstChild!;
    const rich = extractRichContent(range(text, 0, annotation, 2));
    expect(rich.blocks).toEqual([{ type: 'text', content: '能量 ' }, { type: 'inline_math', latex: 'E=mc^2' }]);
    expect(rich.plainText).toContain('E=mc^2');
  });

  it('supports a starting formula, block formula, code, and extraction fallbacks', () => {
    document.body.innerHTML = '<div id="root"><span class="katex" data-latex="x+1" aria-label="wrong"><span>x</span></span> 后文<div class="katex-display"><span class="katex"><math><annotation encoding="application/x-tex">\\int_0^1 x dx</annotation></math></span></div><pre><code class="language-ts">const x = 1;</code></pre></div>';
    const root = document.getElementById('root')!; const selection = document.createRange(); selection.selectNodeContents(root);
    const rich = extractRichContent(selection);
    expect(rich.blocks).toContainEqual({ type: 'inline_math', latex: 'x+1' });
    expect(rich.blocks).toContainEqual({ type: 'block_math', latex: '\\int_0^1 x dx' });
    expect(rich.blocks).toContainEqual({ type: 'code', content: 'const x = 1;', language: 'ts' });
    expect(extractLatex(root.querySelector('.katex')!)).toBe('x+1');
  });

  it('renders KaTeX inside an isolated root without column-breaking styles', async () => {
    const host = document.createElement('pointask-test-rich'); const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = richContentStyles; const mount = document.createElement('div'); shadow.append(style, mount); document.body.append(host);
    const root = createRoot(mount);
    await act(() => root.render(<RichContentRenderer blocks={[{ type: 'inline_math', latex: 'x^2' }, { type: 'block_math', latex: '\\sum_i i' }]} />));
    expect(shadow.querySelectorAll('.katex')).toHaveLength(2);
    expect(style.textContent).not.toContain('span { display: block');
    expect(style.textContent).toContain('white-space: nowrap');
    await act(() => root.unmount());
  });

  it('renders safe Markdown including fenced code, lists, emphasis, quotes, and tables', async () => {
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const markdown = '# 标题\n\n- **粗体项目**\n- `行内代码`\n\n> 引用\n\n```ts\nconst value = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    await act(() => root.render(<RichContentRenderer blocks={[{ type: 'text', content: markdown }]} />));
    expect(container.querySelector('h1')?.textContent).toBe('标题');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('粗体项目');
    expect(container.querySelector('blockquote')?.textContent).toContain('引用');
    expect(container.querySelector('pre code')?.textContent).toContain('const value = 1;');
    expect(container.querySelector('table')).not.toBeNull();
    await act(() => root.unmount());
  });

  it('does not execute raw HTML, javascript links, or load Markdown images', async () => {
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    await act(() => root.render(<RichContentRenderer blocks={[
      { type: 'text', content: '<script>globalThis.pointaskUnsafe = true</script>' },
      { type: 'text', content: '[危险](javascript:alert(1)) ![远程图](https://example.com/tracker.png)' },
    ]} />));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('[图片：远程图]');
    await act(() => root.unmount());
  });
});

describe('explicit composer fill and candidate matching', () => {
  it('changes the composer only after the explicit fill call and never sends', () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">发送</button>';
    const send = vi.spyOn(document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!, 'click');
    const adapter = new ChatGptAdapter();
    expect(document.getElementById('prompt-textarea')?.textContent).toBe('');
    expect(adapter.fillComposer('用户主动填入的提示词')).toBe(true);
    expect(document.getElementById('prompt-textarea')?.textContent).toBe('用户主动填入的提示词');
    expect(send).not.toHaveBeenCalled();
  });

  it('returns only the assistant immediately following the matching prompt', () => {
    document.body.innerHTML = '<article data-testid="conversation-turn-1"><div data-message-author-role="user"><div class="markdown">提示词</div></div></article><article data-testid="conversation-turn-2"><div data-message-author-role="assistant"><div class="markdown"><p>回答</p></div></div></article>';
    const adapter = new ChatGptAdapter();
    const extractWhole = vi.spyOn(adapter, 'getMessageRichContent');
    const candidate = adapter.findCandidateAnswer('fnv1a-6c1d43f5', []);
    expect(candidate).toBeNull();
    expect(adapter.findCandidateAnswer(stableTextHash('提示词'), [])?.fingerprint).toBeTruthy();
    expect(extractWhole).not.toHaveBeenCalled();
  });
});

describe('view anchor and migration', () => {
  it('locates an exact answer, refuses ambiguous text, and restores pending navigation from storage', async () => {
    document.body.innerHTML = '<article data-testid="conversation-turn-a"><div data-message-author-role="assistant"><div class="markdown">重复回答</div></div></article><article data-testid="conversation-turn-b"><div data-message-author-role="assistant"><div class="markdown">重复回答</div></div></article>';
    const adapter = new ChatGptAdapter(); const exact = adapter.getMessageFingerprint(document.querySelector('article') as HTMLElement);
    expect(adapter.resolveAnswerSource({ conversationUrl: 'https://chatgpt.com/c/a', conversationKey: 'https://chatgpt.com/c/a', messageFingerprint: exact })).toBe(document.querySelector('article'));
    expect(adapter.resolveAnswerSource({ conversationUrl: 'https://chatgpt.com/c/a', conversationKey: 'https://chatgpt.com/c/a', messageFingerprint: 'missing', selectedText: '重复回答' })).toBeNull();
    const store = new NavigationStore(new MemoryStorageDriver());
    const pending = { id: 'nav', threadId: 'thread', locator: { conversationUrl: 'https://chatgpt.com/c/a', conversationKey: 'https://chatgpt.com/c/a', messageFingerprint: exact }, createdAt: new Date().toISOString() };
    await store.set(pending); expect(await store.get()).toEqual(pending); await store.clear('nav'); expect(await store.get()).toBeNull();
  });

  it('restores relative viewport position and releases after user scrolling', () => {
    vi.useFakeTimers(); const element = document.createElement('div'); document.body.append(element);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 180 } as DOMRect);
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const controller = new ViewAnchorController();
    controller.start(element, { sourceMessageFingerprint: 'm', blockFingerprint: 'b', viewportOffsetTop: 80, scrollY: 0, capturedAt: new Date().toISOString() });
    expect(scrollBy).toHaveBeenCalledWith({ top: 100, behavior: 'auto' });
    window.dispatchEvent(new WheelEvent('wheel')); document.body.append(document.createElement('div')); vi.runAllTimers();
    expect(scrollBy).toHaveBeenCalledTimes(1); controller.stop(); vi.useRealTimers();
  });

  it('corrects the actual inner ChatGPT scroll container instead of window', () => {
    vi.useFakeTimers(); const container = document.createElement('div'); const element = document.createElement('div'); container.append(element); document.body.append(container);
    Object.defineProperties(container, { scrollHeight: { value: 1000 }, clientHeight: { value: 300 } });
    container.style.overflowY = 'auto'; vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 160 } as DOMRect);
    const scrollBy = vi.fn(); Object.defineProperty(container, 'scrollBy', { value: scrollBy });
    const controller = new ViewAnchorController(); controller.start(element, { sourceMessageFingerprint: 'm', blockFingerprint: 'b', viewportOffsetTop: 60, scrollY: 0, capturedAt: new Date().toISOString() }, container);
    expect(scrollBy).toHaveBeenCalledWith({ top: 100, behavior: 'auto' }); controller.stop(); vi.useRealTimers();
  });

  it('migrates legacy message strings to rich blocks idempotently', () => {
    const legacy = { id: 't', displayId: 'PA-001', answerMode: 'dedicated_branch', anchor: { pageUrl: 'https://chatgpt.com/c/a', sourcePageUrl: 'https://chatgpt.com/c/a', conversationKey: 'https://chatgpt.com/c/a', messageFingerprint: 'm', assistantMessageHash: 'm', selectedText: '选区', prefixText: '', suffixText: '', paragraphText: '段落', paragraphHash: 'p', startOffset: 0, endOffset: 2, schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }, sourcePageUrl: 'https://chatgpt.com/c/a', sourceConversationKey: 'https://chatgpt.com/c/a', sourceMessageFingerprint: 'm', messages: [{ id: 'q', role: 'user', content: '旧问题', attachedManually: false, createdAt: '2026-01-01T00:00:00.000Z' }], status: 'waiting_for_answer', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const first = migrateStorage({ [STORAGE_KEYS.threads]: [legacy] });
    expect(first.threads[0]?.messages[0]?.content).toEqual([{ type: 'text', content: '旧问题' }]);
    expect(migrateStorage({ [STORAGE_KEYS.threads]: first.threads })).toEqual(first);
  });
});
