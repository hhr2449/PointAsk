import type { WorkspaceThreadListItem } from './workspace-thread-list';
import { WorkspaceThreadSwitcher } from './workspace-thread-switcher';

export function WorkspaceControlHeader({ selectedThreadId, threads, expanded, onToggle, onSwitch, onReturnThread, onDeleteThread }: {
  selectedThreadId?: string; threads?: WorkspaceThreadListItem[]; expanded: boolean;
  onToggle(): void; onSwitch(threadId: string): void; onReturnThread?(threadId: string): void; onDeleteThread?(threadId: string): void;
}) {
  const availableThreads = threads ?? [];
  return <header className="pointask-control-header">
    <div className={`pointask-control-brand${availableThreads.length ? ' pointask-has-thread' : ''}`}><strong>PointAsk</strong>
      {availableThreads.length > 0 && <WorkspaceThreadSwitcher items={availableThreads} selectedThreadId={selectedThreadId} onSelect={onSwitch}
        onReturn={onReturnThread ?? (() => undefined)} onDelete={onDeleteThread ?? (() => undefined)} />}
    </div>
    <button type="button" className="pointask-control-toggle" aria-expanded={expanded} aria-controls="pointask-workspace-control-body"
      onClick={onToggle}>{expanded ? '收起' : '›'}</button>
  </header>;
}
