import { useEffect, useState } from 'react';
import type { WorkspaceThreadListItem, WorkspaceThreadGroup } from './workspace-thread-list';
import { workspaceThreadGroupLabels } from './workspace-thread-list';

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function WorkspaceThreadSwitcher({ items, selectedThreadId, onSelect, onReturn, onDelete }: {
  items: WorkspaceThreadListItem[];
  selectedThreadId?: string;
  onSelect(threadId: string): void;
  onReturn(threadId: string): void;
  onDelete(threadId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.threadId === selectedThreadId);
  useEffect(() => { if (!items.some((item) => item.threadId === selectedThreadId)) setOpen(false); }, [items, selectedThreadId]);
  const groups: WorkspaceThreadGroup[] = ['needs_action', 'in_progress', 'other'];
  return <div className="pointask-thread-switcher" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
  }}>
    <button type="button" className="pointask-thread-switcher-trigger" aria-haspopup="menu" aria-expanded={open}
      aria-controls="pointask-workspace-thread-menu" onClick={() => setOpen((value) => !value)}>
      {selected?.displayId ?? '选择线程'} <span aria-hidden="true">▾</span>
    </button>
    {open && <div id="pointask-workspace-thread-menu" className="pointask-thread-switcher-menu" role="menu" aria-label="Workspace 线程">
      {groups.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        return groupItems.length ? <section key={group} className="pointask-thread-switcher-group" aria-labelledby={`pointask-thread-group-${group}`}>
          <h3 id={`pointask-thread-group-${group}`}>{workspaceThreadGroupLabels[group]}</h3>
          {groupItems.map((item) => <div key={item.threadId} className={`pointask-thread-switcher-item${item.threadId === selectedThreadId ? ' pointask-selected' : ''}`}>
            <button type="button" role="menuitem" className="pointask-thread-switcher-select" onClick={() => {
              onSelect(item.threadId); setOpen(false);
            }}>
              <span><b>{item.displayId}</b><small>{item.statusLabel}</small></span>
              <span className="pointask-thread-switcher-summary">{item.questionSummary}</span>
              <time dateTime={item.updatedAt}>{formatUpdatedAt(item.updatedAt)}</time>
            </button>
            <div className="pointask-thread-switcher-actions">
              <button type="button" onClick={() => onReturn(item.threadId)}>返回原文</button>
              <button type="button" className="pointask-danger" onClick={() => {
                if (window.confirm(`删除 ${item.displayId}？该线程的待处理和暂存内容也会删除。`)) onDelete(item.threadId);
              }}>删除线程</button>
            </div>
          </div>)}
        </section> : null;
      })}
    </div>}
  </div>;
}
