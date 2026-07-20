import type { WorkspaceControlDerivedState } from './workspace-control-state';

const primaryLabels = {
  send: '发送追问', retry: '重试', attach_default_return: '附加并返回',
  attach_selection_return: '附加所选内容并返回', return: '返回原文', retry_return: '重试返回',
};

export function WorkspaceStatusView({ source, question, roundNumber, state, selectionSummary, canChooseRounds, busy, error,
  onPrimary, onContinue, onChooseRounds, onClearSelection, onReturn, onMore }: {
  source: string; question: string; roundNumber: number; state: WorkspaceControlDerivedState; selectionSummary?: string; canChooseRounds: boolean;
  busy: boolean; error?: string; onPrimary(): void; onContinue(): void; onChooseRounds(): void;
  onClearSelection(): void; onReturn(): void; onMore(): void;
}) {
  return <div className="pointask-control-view">
    <section><h3>原文</h3><p className="pointask-control-summary">“{source}”</p></section>
    <section><h3>当前问题</h3><p className="pointask-control-summary">{question}</p></section>
    <div className="pointask-control-round">当前第 {roundNumber} 轮</div>
    <div className={`pointask-control-status pointask-control-status-${state.status}`} aria-live="polite">
      <span aria-hidden="true">●</span>{state.label}
    </div>
    {state.status === 'ambiguous' && <p className="pointask-control-hint">无法唯一匹配整条回答，请先选择回答内容。</p>}
    {selectionSummary && <div className="pointask-control-selection"><span>{selectionSummary}</span>
      <button type="button" onClick={onClearSelection}>清除选择</button></div>}
    {error && <p className="pointask-control-error" role="alert">{error}</p>}
    <div className="pointask-control-actions">
      {state.primary && <button type="button" className="pointask-primary" disabled={busy} onClick={onPrimary}>{state.primaryLabel ?? primaryLabels[state.primary]}</button>}
      {state.secondary === 'continue' && <button type="button" className="pointask-secondary" disabled={busy} onClick={onContinue}>继续追问</button>}
      {!state.primary || !['return', 'retry_return'].includes(state.primary) ? <button type="button" className="pointask-secondary" disabled={busy} onClick={onReturn}>返回原文</button> : null}
    </div>
    <div className="pointask-control-low-frequency">
      {canChooseRounds && <button type="button" onClick={onChooseRounds}>选择附加内容</button>}
      <button type="button" aria-haspopup="menu" onClick={onMore}>更多 …</button>
    </div>
  </div>;
}
