import { WorkspaceControlHeader } from './workspace-control-header';
import type { WorkspaceThreadListItem } from './workspace-thread-list';

export function WorkspaceControlEntry({ threads, selectedThreadId, expanded, idle, onToggle, onSwitch, onReturnThread, onDeleteThread }: {
  threads: WorkspaceThreadListItem[]; selectedThreadId?: string; expanded: boolean; idle: boolean; onToggle(): void;
  onSwitch(threadId: string): void; onReturnThread(threadId: string): void; onDeleteThread(threadId: string): void;
}) {
  return <aside role="complementary" aria-label="PointAsk 当前局部线程"
    className={`pointask-workspace-control${expanded ? '' : ' pointask-collapsed'}`}>
    <WorkspaceControlHeader threads={threads} selectedThreadId={selectedThreadId} expanded={expanded} onToggle={onToggle}
      onSwitch={onSwitch} onReturnThread={onReturnThread} onDeleteThread={onDeleteThread} />
    {expanded && <div className="pointask-control-space-title">共享追问空间</div>}
    <div id="pointask-workspace-control-body" className={expanded ? 'pointask-control-view pointask-idle-view' : 'pointask-collapsed-status'}
      aria-live="polite">{idle ? '暂无活跃追问' : `${threads.length} 个待处理追问，请选择线程`}</div>
  </aside>;
}
