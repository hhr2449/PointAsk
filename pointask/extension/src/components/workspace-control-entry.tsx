import type { PendingAssociation } from '../bridge/runtime-messages';
import { WorkspaceControlHeader } from './workspace-control-header';

export function WorkspaceControlEntry({ records, expanded, idle, onToggle, onSwitch }: {
  records: PendingAssociation[]; expanded: boolean; idle: boolean; onToggle(): void; onSwitch(id: string): void;
}) {
  return <aside role="complementary" aria-label="PointAsk 当前局部线程"
    className={`pointask-workspace-control${expanded ? '' : ' pointask-collapsed'}`}>
    <WorkspaceControlHeader records={records} expanded={expanded} onToggle={onToggle} onSwitch={onSwitch} />
    {expanded && <div className="pointask-control-space-title">共享追问空间</div>}
    <div id="pointask-workspace-control-body" className={expanded ? 'pointask-control-view pointask-idle-view' : 'pointask-collapsed-status'}
      aria-live="polite">{idle ? '暂无活跃追问' : `${records.length} 个待处理追问，请选择线程`}</div>
  </aside>;
}
