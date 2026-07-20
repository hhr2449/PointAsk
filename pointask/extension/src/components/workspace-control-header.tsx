import type { PendingAssociation } from '../bridge/runtime-messages';

export function WorkspaceControlHeader({ record, records, expanded, onToggle, onSwitch }: {
  record?: PendingAssociation; records: PendingAssociation[]; expanded: boolean;
  onToggle(): void; onSwitch(id: string): void;
}) {
  const switchable = records.length > 1 || !record && records.length > 0;
  return <header className="pointask-control-header">
    <div className={`pointask-control-brand${record || records.length ? ' pointask-has-thread' : ''}`}><strong>PointAsk</strong>{switchable ? <select aria-label="切换 PointAsk 线程"
      value={record?.pendingThread.id ?? ''} onChange={(event) => event.target.value && onSwitch(event.target.value)}>
      {!record && <option value="">选择追问</option>}
      {records.map((item) => <option key={item.pendingThread.id} value={item.pendingThread.id}>{item.localThread.displayId}</option>)}
    </select> : record ? <span>{record.localThread.displayId}</span> : null}</div>
    <button type="button" className="pointask-control-toggle" aria-expanded={expanded} aria-controls="pointask-workspace-control-body"
      onClick={onToggle}>{expanded ? '收起' : '›'}</button>
  </header>;
}
