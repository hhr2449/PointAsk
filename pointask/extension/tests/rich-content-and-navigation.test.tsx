import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChatGptAdapter } from '../src/adapters/chatgpt-adapter';
import { extractLatex, extractRichContent } from '../src/adapters/rich-content-extractor';
import { RichContentRenderer, richContentStyles } from '../src/components/rich-content-renderer';
import { ViewAnchorController } from '../src/content/view-anchor-controller';
import { migrateStorage } from '../src/storage/migration';
import { normalizeRichContentBlocks } from '../src/shared/rich-content';
import { STORAGE_KEYS } from '../src/storage/storage-schema';
import { stableTextHash } from '../src/shared/text-utils';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { NavigationStore } from '../src/storage/navigation-store';
import { applyPointAskTheme } from '../src/content/theme';
import { threadStyles } from '../src/content/shadow-styles';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function range(start: Node, startOffset: number, end: Node, endOffset: number): Range {
  const result = document.createRange(); result.setStart(start, startOffset); result.setEnd(end, endOffset); return result;
}

describe('rich ChatGPT content', () => {
  it('derives a dark semantic theme from the nearby ChatGPT surface', () => {
    const reference = document.createElement('div'); reference.style.backgroundColor = 'rgb(32, 33, 35)'; reference.style.fontFamily = 'Arial';
    const host = document.createElement('pointask-theme-test'); document.body.append(reference, host); applyPointAskTheme(host, reference);
    expect(host.dataset.pointaskTheme).toBe('dark'); expect(host.style.getPropertyValue('--pointask-font')).toContain('Arial');
  });
  it('extracts text plus an atomic ending formula using TeX annotation', () => {
    document.body.innerHTML = '<p id="p">能量 <span class="katex"><span>零散视觉字符</span><math><semantics><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span></p>';
    const paragraph = document.getElementById('p')!;
    const text = paragraph.firstChild!;
    const annotation = paragraph.querySelector('annotation')!.firstChild!;
    const rich = extractRichContent(range(text, 0, annotation, 2));
    expect(rich.blocks).toEqual([{ type: 'paragraph', children: [{ type: 'text', content: '能量 ' }, { type: 'inline_math', latex: 'E=mc^2' }] }]);
    expect(rich.plainText).toContain('E=mc^2');
  });

  it('supports a starting formula, block formula, code, and extraction fallbacks', () => {
    document.body.innerHTML = '<div id="root"><span class="katex" data-latex="x+1" aria-label="wrong"><span>x</span></span> 后文<div class="katex-display"><span class="katex"><math><annotation encoding="application/x-tex">\\int_0^1 x dx</annotation></math></span></div><pre><code class="language-ts">const x = 1;</code></pre></div>';
    const root = document.getElementById('root')!; const selection = document.createRange(); selection.selectNodeContents(root);
    const rich = extractRichContent(selection);
    expect(rich.blocks[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'inline_math', latex: 'x+1' }, { type: 'text', content: ' 后文' }] });
    expect(rich.blocks).toContainEqual({ type: 'block_math', latex: '\\int_0^1 x dx' });
    expect(rich.blocks).toContainEqual({ type: 'code_block', content: 'const x = 1;', language: 'ts' });
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
    expect(richContentStyles).not.toContain('#0d0d0d');
    expect(richContentStyles).toContain('background: var(--pa-bg-subtle');
    await act(() => root.unmount());
  });

  it('keeps rendered ChatGPT emphasis in RichContent and cards', async () => {
    document.body.innerHTML = '<p id="formatted">普通 <strong>粗体 <em>粗斜体</em></strong> 和 <del>删除内容</del> <code>代码</code></p>';
    const selection = document.createRange(); selection.selectNodeContents(document.getElementById('formatted')!);
    const rich = extractRichContent(selection);
    expect(rich.blocks).toEqual([{ type: 'paragraph', children: [
      { type: 'text', content: '普通 ' },
      { type: 'strong', children: [
        { type: 'text', content: '粗体 ' },
        { type: 'emphasis', children: [{ type: 'text', content: '粗斜体' }] },
      ] },
      { type: 'text', content: ' 和 ' },
      { type: 'strikethrough', children: [{ type: 'text', content: '删除内容' }] },
      { type: 'text', content: ' ' },
      { type: 'inline_code', content: '代码' },
    ] }]);
    const container = document.createElement('div'); const root = createRoot(container);
    await act(() => root.render(<RichContentRenderer blocks={rich.blocks} />));
    expect(container.querySelector('strong')?.textContent).toBe('粗体 粗斜体');
    expect(container.querySelector('strong')?.tagName).toBe('STRONG');
    expect(container.querySelector('strong em')?.textContent).toBe('粗斜体');
    expect(container.querySelector('del')?.textContent).toBe('删除内容');
    expect(container.querySelector('p')?.textContent).toBe('普通 粗体 粗斜体 和 删除内容 代码');
    expect(richContentStyles).toContain('.pointask-rich-content strong,');
    expect(richContentStyles).toContain('font-size: inherit; line-height: inherit; font-family: inherit; letter-spacing: inherit; font-weight: 600;');
    expect(richContentStyles).toContain('.pointask-rich-content :is(strong, b) span');
    expect(threadStyles).toContain('.pointask-message > strong { font-size: 12px; }');
    expect(threadStyles).toContain('.pointask-selection > strong { font-size: 12px; }');
    expect(threadStyles).toContain('.pointask-round-question { padding: 10px 11px; border-radius: 10px; background: var(--pa-bg-subtle); }');
    expect(threadStyles).toContain('.pointask-round-answer-label::before { content: "◦";');
    expect(threadStyles).not.toContain('.pointask-message strong { font-size: 12px; }');
    expect(threadStyles).not.toContain('.pointask-selection strong { font-size: 12px; }');
    await act(() => root.unmount());
  });

  it('does not execute raw HTML, javascript links, or load Markdown images', async () => {
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    await act(() => root.render(<RichContentRenderer blocks={[
      { type: 'paragraph', children: [{ type: 'text', content: '<script>globalThis.pointaskUnsafe = true</script>' }] },
      { type: 'paragraph', children: [{ type: 'text', content: '[危险](javascript:alert(1)) ![远程图](https://example.com/tracker.png)' }] },
    ]} />));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('[图片：远程图]');
    await act(() => root.unmount());
  });

  it('preserves ordered lists, blockquotes, inline code, punctuation, and multiline code blocks', async () => {
    document.body.innerHTML = `<div id="structured"><p>令 <code>x</code>；再令 <code>x=2</code>。</p>
      <ol start="2"><li><p>第二项</p></li><li><p>第三项</p></li></ol>
      <blockquote><p>引用内容</p></blockquote><pre><code class="language-ts">if (x) {\n  run();\n}</code></pre></div>`;
    const rich = new ChatGptAdapter().getRichSelection((() => { const value = document.createRange(); value.selectNodeContents(document.getElementById('structured')!); return value; })());
    expect(rich.blocks[0]).toEqual({ type: 'paragraph', children: [
      { type: 'text', content: '令 ' }, { type: 'inline_code', content: 'x' }, { type: 'text', content: '；再令 ' },
      { type: 'inline_code', content: 'x=2' }, { type: 'text', content: '。' },
    ] });
    expect(rich.blocks[1]).toMatchObject({ type: 'ordered_list', start: 2, items: [{ type: 'list_item' }, { type: 'list_item' }] });
    expect(rich.blocks[2]).toMatchObject({ type: 'blockquote' });
    expect(rich.blocks[3]).toEqual({ type: 'code_block', content: 'if (x) {\n  run();\n}', language: 'ts' });
    const container = document.createElement('div'); const root = createRoot(container);
    await act(() => root.render(<RichContentRenderer blocks={rich.blocks} />));
    expect(container.querySelector('ol')?.start).toBe(2); expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('blockquote')?.textContent).toContain('引用内容');
    expect(container.querySelector('p')?.textContent).toBe('令 x；再令 x=2。');
    expect(container.querySelector('pre code')?.textContent).toBe('if (x) {\n  run();\n}');
    await act(() => root.unmount());
  });

  it('preserves structure for partial list, inline-code, and code-block selections', () => {
    document.body.innerHTML = `<div id="partial"><ol start="4"><li><p>第一项</p></li><li><p id="chosen">第二项中间文字</p></li></ol>
      <p id="inline">值为 <code id="inline-code">alphaBeta</code>。</p>
      <pre><code id="lines" class="language-js">lineOne();\n  lineTwo();\nlineThree();</code></pre></div>`;
    const chosen = document.getElementById('chosen')!.firstChild!;
    const listRich = extractRichContent(range(chosen, 2, chosen, 6));
    expect(listRich.blocks).toEqual([{ type: 'ordered_list', start: 5, items: [{ type: 'list_item', children: [
      { type: 'paragraph', children: [{ type: 'text', content: '项中间文' }] },
    ] }] }]);

    const inline = document.getElementById('inline-code')!.firstChild!;
    expect(extractRichContent(range(inline, 2, inline, 7)).blocks).toEqual([{ type: 'paragraph', children: [
      { type: 'inline_code', content: 'phaBe' },
    ] }]);

    const lines = document.getElementById('lines')!.firstChild as Text;
    const codeRich = extractRichContent(range(lines, lines.data.indexOf('  lineTwo'), lines, lines.data.indexOf('lineThree') - 1));
    expect(codeRich.blocks).toEqual([{ type: 'code_block', content: '  lineTwo();', language: 'js' }]);
  });

  it('preserves mixed text, lists, partial code, and paragraph content across blocks', () => {
    document.body.innerHTML = `<div id="mixed"><p id="intro">普通文字开始</p><ul><li><p>列表内容</p></li></ul>
      <pre><code id="mixed-code">  first();\n  second();</code></pre><p id="tail">结尾文字</p></div>`;
    const intro = document.getElementById('intro')!.firstChild!;
    const tail = document.getElementById('tail')!.firstChild!;
    const rich = extractRichContent(range(intro, 2, tail, 2));
    expect(rich.blocks.map((block) => block.type)).toEqual(['paragraph', 'unordered_list', 'code_block', 'paragraph']);
    expect(rich.blocks[2]).toEqual({ type: 'code_block', content: '  first();\n  second();' });
    expect(rich.plainText).toContain('文字开始');
    expect(rich.plainText).toContain('列表内容');
    expect(rich.plainText).toContain('结尾');

    const code = document.getElementById('mixed-code')!.firstChild as Text;
    const fromCode = extractRichContent(range(code, 2, tail, 2));
    expect(fromCode.blocks.map((block) => block.type)).toEqual(['code_block', 'paragraph']);
    expect(fromCode.blocks[0]).toEqual({ type: 'code_block', content: 'first();\n  second();' });
  });

  it('cleans consecutive and edge line breaks while preserving formula/list structure', () => {
    const normalized = normalizeRichContentBlocks([
      { type: 'line_break' }, { type: 'line_break' },
      { type: 'paragraph', children: [{ type: 'text', content: '公式 ' }, { type: 'inline_math', latex: 'x^2' }, { type: 'line_break' }, { type: 'line_break' }] },
      { type: 'unordered_list', items: [{ type: 'list_item', children: [{ type: 'block_math', latex: '\\sum_i i' }] }] },
      { type: 'line_break' }, { type: 'line_break' },
    ]);
    expect(normalized).toEqual([
      { type: 'paragraph', children: [{ type: 'text', content: '公式 ' }, { type: 'inline_math', latex: 'x^2' }] },
      { type: 'unordered_list', items: [{ type: 'list_item', children: [{ type: 'block_math', latex: '\\sum_i i' }] }] },
    ]);
  });

  it('preserves rendered ChatGPT headings and tables instead of flattening them into text', async () => {
    document.body.innerHTML = '<div id="document"><h2>结果</h2><table><thead><tr><th>变量</th><th>值</th></tr></thead><tbody><tr><td><code>x</code></td><td>2</td></tr></tbody></table></div>';
    const selection = document.createRange(); selection.selectNodeContents(document.getElementById('document')!);
    const rich = extractRichContent(selection);
    expect(rich.blocks[0]).toMatchObject({ type: 'heading', level: 2 });
    expect(rich.blocks[1]).toMatchObject({ type: 'table', rows: [{ type: 'table_row' }, { type: 'table_row' }] });
    const container = document.createElement('div'); const root = createRoot(container);
    await act(() => root.render(<RichContentRenderer blocks={rich.blocks} />));
    expect(container.querySelector('h2')?.textContent).toBe('结果');
    expect(container.querySelectorAll('table tr')).toHaveLength(2);
    expect(container.querySelector('tbody td code')?.textContent).toBe('x');
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

  it('fills a hydrated contenteditable composer through its native editing path', () => {
    document.body.innerHTML = '<div id="prompt-textarea" class="ProseMirror" contenteditable="true"><p>旧草稿</p></div><button data-testid="send-button">发送</button>';
    const execCommand = vi.fn((_command: string, _showUi: boolean, value: string) => {
      document.getElementById('prompt-textarea')!.textContent = value;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const send = vi.spyOn(document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!, 'click');
    expect(new ChatGptAdapter().fillComposer('共享空间继续追问')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '共享空间继续追问');
    expect(document.getElementById('prompt-textarea')?.textContent).toBe('共享空间继续追问');
    expect(send).not.toHaveBeenCalled();
    delete (document as { execCommand?: unknown }).execCommand;
  });

  it('submits only when the explicit submit operation is invoked and refuses a disabled button', () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">发送</button>';
    const adapter = new ChatGptAdapter(); const button = document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!;
    const click = vi.spyOn(button, 'click'); adapter.fillComposer('明确点击后发送');
    expect(click).not.toHaveBeenCalled(); expect(adapter.canSubmitComposer()).toBe(true);
    expect(adapter.submitComposer()).toBe(true); expect(click).toHaveBeenCalledOnce();
    button.disabled = true; expect(adapter.submitComposer()).toBe(false); expect(click).toHaveBeenCalledOnce();
  });

  it('confirms submission only from an exact rendered user turn', () => {
    const prompt = '[PointAsk 局部线程：PA-009]\n\n我的问题：\n确认发送了吗？';
    const promptHash = stableTextHash(prompt);
    document.body.innerHTML = `<article data-testid="conversation-turn-user-proof"><div data-message-author-role="user"><div class="markdown"><p>${prompt}</p><button>复制</button></div></div></article>`;
    const adapter = new ChatGptAdapter();
    expect(adapter.hasSubmittedPrompt(promptHash)).toBe(true);
    expect(adapter.hasSubmittedPrompt(stableTextHash('另一个问题'))).toBe(false);
  });

  it('waits for composer readiness from DOM changes instead of assuming a delay is enough', async () => {
    document.body.innerHTML = '';
    const adapter = new ChatGptAdapter();
    const composerReady = adapter.waitForComposerReady(1_000);
    const composer = document.createElement('div'); composer.id = 'prompt-textarea'; composer.contentEditable = 'true';
    document.body.append(composer);
    expect(await composerReady).toBe(true);

    const submitReady = adapter.waitForSubmitReady(1_000);
    const button = document.createElement('button'); button.dataset.testid = 'send-button'; button.disabled = true; document.body.append(button);
    button.disabled = false;
    expect(await submitReady).toBe(true);
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

  it('matches a normalized user prompt across harmless tool turns and ignores user action controls', () => {
    const prompt = '[PointAsk：PA-001]\n\n我的局部问题：\n为什么？';
    document.body.innerHTML = `<article data-testid="conversation-turn-user"><div data-message-author-role="user">
      <div data-message-content>${prompt}</div><button>编辑</button></div></article>
      <article data-testid="conversation-turn-tool"><div data-tool-status>工具状态</div></article>
      <article data-testid="conversation-turn-answer"><div data-message-author-role="assistant"><div class="markdown">对应回答</div></div></article>`;
    const adapter = new ChatGptAdapter();
    const candidate = adapter.findCandidateAnswer(stableTextHash(prompt), []);
    expect(candidate?.element.getAttribute('data-testid')).toBe('conversation-turn-answer');
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

  it('migrates round persistence state and preserves valid staged rich content idempotently', () => {
    const base = { id: 'staged', displayId: 'PA-002', answerMode: 'workspace', anchor: { pageUrl: 'https://chatgpt.com/c/a',
      sourcePageUrl: 'https://chatgpt.com/c/a', conversationKey: 'https://chatgpt.com/c/a', messageFingerprint: 'm2', assistantMessageHash: 'm2',
      selectedText: '选区', prefixText: '', suffixText: '', paragraphText: '段落', paragraphHash: 'p2', startOffset: 0, endOffset: 2,
      schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }, sourcePageUrl: 'https://chatgpt.com/c/a',
      sourceConversationKey: 'https://chatgpt.com/c/a', sourceMessageFingerprint: 'm2', targetConversationUrl: 'https://chatgpt.com/c/workspace',
      messages: [{ id: 'q1', role: 'user', content: [{ type: 'text', content: '问题' }], attachedManually: false, createdAt: '2026-01-01T00:00:00.000Z' }],
      rounds: [{ id: 'q1', pendingId: 'pending-q1', promptHash: 'hash-q1', assistantFingerprintsBefore: [], status: 'answer_ready',
        persistenceStatus: 'staged', stagedAnswer: [{ type: 'text', content: '暂存回答' }], answerSource: {
          conversationUrl: 'https://chatgpt.com/c/workspace', conversationKey: 'https://chatgpt.com/c/workspace', messageFingerprint: 'a1' },
        capturedAt: '2026-01-01T00:01:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' }],
      status: 'answer_ready', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' };
    const first = migrateStorage({ [STORAGE_KEYS.threads]: [base] });
    expect(first.threads[0]?.rounds?.[0]).toMatchObject({ persistenceStatus: 'staged', stagedAnswer: [{ type: 'text', content: '暂存回答' }] });
    expect(migrateStorage({ [STORAGE_KEYS.threads]: first.threads })).toEqual(first);
  });
});
