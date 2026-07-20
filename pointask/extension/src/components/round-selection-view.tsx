import { isSelectableRound } from './round-selection-state';

export interface SelectableRound { id: string; index: number; question: string; attached: boolean; latest: boolean; reliable: boolean;
  stageable?: boolean; persistenceStatus?: 'not_captured' | 'staged' | 'attaching' | 'attached' | 'capture_failed';
  attachmentStatus?: 'available' | 'skipped_retained' | 'skipped_expired' | 'attached'; }

export function RoundSelectionView({ rounds, selected, busy, error, onToggle, onCancel, onAttach }: {
  rounds: SelectableRound[]; selected: Set<string>; busy: boolean; error?: string;
  onToggle(id: string): void; onCancel(): void; onAttach(): void;
}) {
  const validSelectedCount = rounds.filter((round) => isSelectableRound(round) && selected.has(round.id)).length;
  const groups = [
    { key: 'available', label: '本次新增', rounds: rounds.filter((round) => (round.attachmentStatus ?? (round.attached ? 'attached' : 'available')) === 'available') },
    { key: 'retained', label: '之前跳过', rounds: rounds.filter((round) => round.attachmentStatus === 'skipped_retained') },
    { key: 'expired', label: '已过期', rounds: rounds.filter((round) => round.attachmentStatus === 'skipped_expired') },
    { key: 'attached', label: '已附加', rounds: rounds.filter((round) => round.attached || round.attachmentStatus === 'attached') },
  ].filter((group) => group.rounds.length);
  return <div className="pointask-control-view"><h2>选择附加内容</h2><div className="pointask-round-options">
    {groups.map((group) => <section key={group.key} className="pointask-round-group"><h3>{group.label}</h3>{group.rounds.map((round) => <label key={round.id} className={!isSelectableRound(round) ? 'pointask-round-option pointask-disabled' : 'pointask-round-option'}>
      <input type="checkbox" disabled={!isSelectableRound(round) || busy} checked={round.attached || selected.has(round.id)} onChange={() => onToggle(round.id)} />
      <span><strong>第 {round.index} 轮</strong>{round.attached && <small>已附加</small>}{round.latest && <small>最新</small>}
        {!round.attached && <small>{round.attachmentStatus === 'skipped_expired' ? '暂存内容已过期' : round.attachmentStatus === 'skipped_retained'
          ? '之前跳过' : round.persistenceStatus === 'staged' ? '已暂存' : round.persistenceStatus === 'capture_failed'
          ? '暂存失败' : '尚未暂存'}</small>}<span>{round.question}</span></span>
    </label>)}</section>)}</div>
    {error && <p className="pointask-control-error" role="alert">{error}</p>}
    <div className="pointask-control-actions"><button type="button" className="pointask-secondary" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="pointask-primary" disabled={busy || validSelectedCount === 0} onClick={onAttach}>附加所选并返回</button></div>
  </div>;
}
