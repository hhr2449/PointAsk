import { useEffect, useRef } from 'react';
import katex from 'katex';
import katexCss from 'katex/dist/katex.min.css?inline';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RichContentBlock } from '../shared/local-thread';
import { normalizeRichContentBlocks } from '../shared/rich-content';

const katexAssetBase = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('assets/') : '/assets/';
export const richContentStyles = `${katexCss.replaceAll('url(/assets/', `url(${katexAssetBase}`)}
.pointask-rich-content { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; overflow-wrap: anywhere; line-height: 1.65; }
.pointask-rich-content > *, .pointask-rich-content .pointask-markdown-block,
.pointask-rich-content :where(p, ul, ol, li, blockquote, h1, h2, h3, h4, h5, h6) {
  box-sizing: border-box; max-width: 100%; min-width: 0; overflow-wrap: anywhere;
}
.pointask-rich-content .pointask-markdown-block { margin: 6px 0; }
.pointask-rich-content .pointask-markdown-block:first-child { margin-top: 0; }
.pointask-rich-content .pointask-markdown-block:last-child { margin-bottom: 0; }
.pointask-rich-content :where(h1, h2, h3, h4, h5, h6) { margin: .8em 0 .35em; line-height: 1.3; }
.pointask-rich-content h1 { font-size: 1.45em; } .pointask-rich-content h2 { font-size: 1.3em; } .pointask-rich-content h3 { font-size: 1.15em; }
.pointask-rich-content :where(p, ul, ol, blockquote) { margin: .55em 0; }
.pointask-rich-content :where(ul, ol) { width: 100%; padding-left: 1.5em; }
.pointask-rich-content li + li { margin-top: .2em; }
.pointask-rich-content li > p { margin: .2em 0; }
.pointask-rich-content li::marker { color: var(--pa-text, currentColor); }
.pointask-rich-content strong,
.pointask-rich-content b { font-size: inherit; line-height: inherit; font-family: inherit; letter-spacing: inherit; font-weight: 600; }
.pointask-rich-content :is(strong, b) span { font-size: inherit; line-height: inherit; font-family: inherit; letter-spacing: inherit; font-weight: inherit; }
.pointask-rich-content :where(em, i) { font-style: italic; }
.pointask-rich-content hr { height: 1px; margin: 1em 0; border: 0; background: var(--pa-border, #d0d7de); }
.pointask-rich-content input[type="checkbox"] { margin: 0 .45em 0 0; vertical-align: -.08em; accent-color: var(--pa-accent, #10a37f); }
.pointask-rich-content blockquote { padding: .15em .7em; border-left: 2px solid var(--pa-border, #9aa0a6); color: var(--pa-muted, #666); }
.pointask-rich-content a { color: var(--pa-accent, #0969da); text-decoration: underline; }
.pointask-rich-content .pointask-table-scroll { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; overflow-x: auto; margin: .65em 0; }
.pointask-rich-content table { width: max-content; min-width: min(100%, 360px); border-collapse: collapse; }
.pointask-rich-content :where(th, td) { padding: 5px 8px; border: 1px solid var(--pa-border, #d0d7de); text-align: left; }
.pointask-rich-content th { background: var(--pa-bg-subtle, #f3f4f6); }
.pointask-rich-content code { max-width: 100%; overflow-wrap: anywhere; border-radius: 5px; padding: .12em .3em; background: var(--pa-bg-subtle, #eff1f3); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: .875em; }
.pointask-rich-content .pointask-inline-math { display: inline-block; max-width: 100%; vertical-align: middle; }
.pointask-rich-content .pointask-block-math { display: block; max-width: 100%; overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
.pointask-rich-content .katex, .pointask-rich-content .katex * { white-space: nowrap; }
.pointask-rich-content pre { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; margin: .75em 0; padding: 12px 14px; border: 1px solid var(--pa-border, #dedee3); border-radius: 8px; color: var(--pa-text, #202123); background: var(--pa-bg-subtle, #f7f7f8); direction: ltr; text-align: left; white-space: pre; tab-size: 4; }
.pointask-rich-content pre code { display: block; min-width: max-content; padding: 0; color: inherit; background: transparent; font-size: .875em; line-height: 1.55; white-space: pre; overflow-wrap: normal; }
.pointask-rich-content del { color: #656d76; }
`;

const markdownComponents: Components = {
  a: ({ children, href, ...props }) => href
    ? <a {...props} href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    : <span className="pointask-markdown-unsafe-link">{children}</span>,
  img: ({ alt }) => <span className="pointask-markdown-image-alt">[图片：{alt || '未命名'}]</span>,
};

const inlineMarkdownComponents: Components = {
  ...markdownComponents,
  p: ({ children }) => <>{children}</>,
};

function safeMarkdownUrl(url: string): string {
  const transformed = defaultUrlTransform(url);
  if (!transformed) return '';
  if (transformed.startsWith('#') || transformed.startsWith('/')) return transformed;
  try {
    const parsed = new URL(transformed, 'https://chatgpt.com/');
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? transformed : '';
  } catch { return ''; }
}

function hasBlockMarkdown(value: string): boolean {
  return /(^|\n)\s*(?:#{1,6}\s|```|~~~|>|[-+*]\s|\d+[.)]\s|\|.+\|)|\n\s*\n/.test(value);
}

function MarkdownText({ value }: { value: string }) {
  const block = hasBlockMarkdown(value);
  const content = <ReactMarkdown remarkPlugins={[remarkGfm]} components={block ? markdownComponents : inlineMarkdownComponents}
    skipHtml urlTransform={safeMarkdownUrl}>{value}</ReactMarkdown>;
  return block ? <div className="pointask-markdown-block">{content}</div> : <span className="pointask-markdown-inline">{content}</span>;
}

function InlineMarkdownText({ value }: { value: string }) {
  if (!['[', ']', '*', '_', '~', '`'].some((marker) => value.includes(marker))) return <>{value}</>;
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineMarkdownComponents} skipHtml urlTransform={safeMarkdownUrl}>{value}</ReactMarkdown>;
}

function MathBlock({ latex, displayMode }: { latex: string; displayMode: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    katex.render(latex, ref.current, { displayMode, throwOnError: false, trust: false, strict: 'ignore' });
  }, [latex, displayMode]);
  return <span ref={ref} className={displayMode ? 'pointask-block-math' : 'pointask-inline-math'} />;
}

function RenderBlocks({ blocks, inline = false }: { blocks: RichContentBlock[]; inline?: boolean }) {
  return blocks.map((block, index) => {
    if (block.type === 'line_break') return <br key={index} />;
    if (block.type === 'text') return inline ? <InlineMarkdownText key={index} value={block.content} /> : <MarkdownText key={index} value={block.content} />;
    if (block.type === 'strong') return <strong key={index}><RenderBlocks blocks={block.children} inline /></strong>;
    if (block.type === 'emphasis') return <em key={index}><RenderBlocks blocks={block.children} inline /></em>;
    if (block.type === 'strikethrough') return <del key={index}><RenderBlocks blocks={block.children} inline /></del>;
    if (block.type === 'inline_code') return <code className="pointask-inline-code" key={index}>{block.content}</code>;
    if (block.type === 'code' || block.type === 'code_block') return <pre key={index}><code data-language={block.language}>{block.content}</code></pre>;
    if (block.type === 'inline_math' || block.type === 'block_math') return <MathBlock key={index} latex={block.latex} displayMode={block.type === 'block_math'} />;
    if (block.type === 'paragraph') return <p key={index}><RenderBlocks blocks={block.children} inline /></p>;
    if (block.type === 'heading') {
      if (block.level === 1) return <h1 key={index}><RenderBlocks blocks={block.children} inline /></h1>;
      if (block.level === 2) return <h2 key={index}><RenderBlocks blocks={block.children} inline /></h2>;
      if (block.level === 3) return <h3 key={index}><RenderBlocks blocks={block.children} inline /></h3>;
      if (block.level === 4) return <h4 key={index}><RenderBlocks blocks={block.children} inline /></h4>;
      if (block.level === 5) return <h5 key={index}><RenderBlocks blocks={block.children} inline /></h5>;
      return <h6 key={index}><RenderBlocks blocks={block.children} inline /></h6>;
    }
    if (block.type === 'blockquote') return <blockquote key={index}><RenderBlocks blocks={block.children} /></blockquote>;
    if (block.type === 'list_item') return <li key={index}><RenderBlocks blocks={block.children} /></li>;
    if (block.type === 'ordered_list') return <ol key={index} start={block.start}><RenderBlocks blocks={block.items} /></ol>;
    if (block.type === 'table') return <div className="pointask-table-scroll" key={index}><table><tbody><RenderBlocks blocks={block.rows} /></tbody></table></div>;
    if (block.type === 'table_row') return <tr key={index}><RenderBlocks blocks={block.cells} /></tr>;
    if (block.type === 'table_cell') return block.header
      ? <th key={index}><RenderBlocks blocks={block.children} inline /></th>
      : <td key={index}><RenderBlocks blocks={block.children} inline /></td>;
    return <ul key={index}><RenderBlocks blocks={block.items} /></ul>;
  });
}

export function RichContentRenderer({ blocks }: { blocks: RichContentBlock[] }) {
  return <div className="pointask-rich-content"><RenderBlocks blocks={normalizeRichContentBlocks(blocks)} /></div>;
}
