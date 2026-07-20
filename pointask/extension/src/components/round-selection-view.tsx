import { isSelectableRound } from './round-selection-state';

export interface SelectableRound { id: string; index: number; question: string; attached: boolean; latest: boolean; reliable: boolean;
  stageable?: boolean; persistenceStatus?: 'not_captured' | 'staged' | 'attaching' | 'attached' | 'capture_failed'; }

export function RoundSelectionView({ rounds, selected, busy, error, onToggle, onCancel, onAttach }: {
  rounds: SelectableRound[]; selected: Set<string>; busy: boolean; error?: string;
  onToggle(id: string): void; onCancel(): void; onAttach(): void;
}) {
  const validSelectedCount = rounds.filter((round) => isSelectableRound(round) && selected.has(round.id)).length;
  return <div className="pointask-control-view"><h2>选择附加内容</h2><div className="pointask-round-options">
    {rounds.map((round) => <label key={round.id} className={!isSelectableRound(round) ? 'pointask-round-option pointask-disabled' : 'pointask-round-option'}>
      <input type="checkbox" disabled={!isSelectableRound(round) || busy} checked={round.attached || selected.has(round.id)} onChange={() => onToggle(round.id)} />
      <span><strong>第 {round.index} 轮</strong>{round.attached && <small>已附加</small>}{round.latest && <small>最新</small>}
        {!round.attached && <small>{round.persistenceStatus === 'staged' ? '已暂存' : round.persistenceStatus === 'capture_failed'
          ? '暂存失败' : '尚未暂存'}</small>}<span>{round.question}</span></span>
    </label>)}</div>
    {error && <p className="pointask-control-error" role="alert">{error}</p>}
    <div className="pointask-control-actions"><button type="button" className="pointask-secondary" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="pointask-primary" disabled={busy || validSelectedCount === 0} onClick={onAttach}>附加所选并返回</button></div>
  </div>;
}
