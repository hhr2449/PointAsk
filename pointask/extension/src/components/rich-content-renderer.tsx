import { useEffect, useRef } from 'react';
import katex from 'katex';
import katexCss from 'katex/dist/katex.min.css?inline';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RichContentBlock } from '../shared/local-thread';

const katexAssetBase = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('assets/') : '/assets/';
export const richContentStyles = `${katexCss.replaceAll('url(/assets/', `url(${katexAssetBase}`)}
.pointask-rich-content { max-width: 100%; overflow-wrap: anywhere; line-height: 1.55; }
.pointask-rich-content .pointask-markdown-block { margin: 6px 0; }
.pointask-rich-content .pointask-markdown-block:first-child { margin-top: 0; }
.pointask-rich-content .pointask-markdown-block:last-child { margin-bottom: 0; }
.pointask-rich-content :where(h1, h2, h3, h4, h5, h6) { margin: .8em 0 .35em; line-height: 1.3; }
.pointask-rich-content h1 { font-size: 1.45em; } .pointask-rich-content h2 { font-size: 1.3em; } .pointask-rich-content h3 { font-size: 1.15em; }
.pointask-rich-content :where(p, ul, ol, blockquote) { margin: .55em 0; }
.pointask-rich-content :where(ul, ol) { padding-left: 1.5em; }
.pointask-rich-content li + li { margin-top: .2em; }
.pointask-rich-content blockquote { padding: .2em .75em; border-left: 3px solid #9aa0a6; color: #555; }
.pointask-rich-content a { color: #0969da; text-decoration: underline; }
.pointask-rich-content table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.pointask-rich-content :where(th, td) { padding: 6px 9px; border: 1px solid #d0d7de; text-align: left; }
.pointask-rich-content th { background: #f3f4f6; }
.pointask-rich-content code { border-radius: 4px; padding: .12em .3em; background: #eff1f3; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .92em; }
.pointask-rich-content .pointask-inline-math { display: inline-block; max-width: 100%; vertical-align: middle; }
.pointask-rich-content .pointask-block-math { display: block; max-width: 100%; overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
.pointask-rich-content .katex, .pointask-rich-content .katex * { white-space: nowrap; }
.pointask-rich-content pre { max-width: 100%; overflow: auto; margin: .65em 0; padding: 10px 12px; border-radius: 8px; color: #e6edf3; background: #161b22; white-space: pre; }
.pointask-rich-content pre code { padding: 0; color: inherit; background: transparent; white-space: pre; }
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

function MathBlock({ latex, displayMode }: { latex: string; displayMode: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    katex.render(latex, ref.current, { displayMode, throwOnError: false, trust: false, strict: 'ignore' });
  }, [latex, displayMode]);
  return <span ref={ref} className={displayMode ? 'pointask-block-math' : 'pointask-inline-math'} />;
}

export function RichContentRenderer({ blocks }: { blocks: RichContentBlock[] }) {
  return <div className="pointask-rich-content">
    {blocks.map((block, index) => {
      if (block.type === 'line_break') return <br key={index} />;
      if (block.type === 'text') return <MarkdownText key={index} value={block.content} />;
      if (block.type === 'code') return <pre key={index}><code data-language={block.language}>{block.content}</code></pre>;
      return <MathBlock key={index} latex={block.latex} displayMode={block.type === 'block_math'} />;
    })}
  </div>;
}
