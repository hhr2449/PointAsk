import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { RichContentBlock } from '../shared/local-thread';
import { RichContentRenderer } from './rich-content-renderer';

export function CollapsibleQuestionText({ blocks, expanded, onToggle, label }: {
  blocks: RichContentBlock[]; expanded: boolean; onToggle(): void; label: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = `pointask-question-${useId().replace(/:/g, '')}`;
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    if (expanded) return;
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setOverflowing(content.scrollHeight > content.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(content);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [blocks, expanded]);

  return <div className="pointask-round-question" aria-label={label}>
    <div ref={contentRef} id={contentId} className={`pointask-round-question-content pointask-question-text ${expanded
      ? 'pointask-question-text-expanded' : 'pointask-question-text-collapsed'}`}>
      <RichContentRenderer blocks={blocks} />
    </div>
    {overflowing && <button type="button" className="pointask-question-toggle" aria-expanded={expanded}
      aria-controls={contentId} onClick={onToggle}>{expanded ? '收起' : '展开'}</button>}
  </div>;
}
