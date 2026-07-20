import { useEffect, useState } from 'react';
import type { PendingAssociation } from '../bridge/runtime-messages';
import { ContinueQuestionView } from './continue-question-view';
import { RoundSelectionView, type SelectableRound } from './round-selection-view';
import { defaultSelectedRoundIds, isSelectableRound, validSelectedRoundIds } from './round-selection-state';
import { WorkspaceControlHeader } from './workspace-control-header';
import { WorkspaceStatusView } from './workspace-status-view';
import type { WorkspaceControlDerivedState } from './workspace-control-state';

type View = 'status' | 'continue' | 'rounds';
export interface ContinueWorkspaceResult { ok: boolean; captureFailed?: boolean; error?: string; }

export function WorkspaceControlCard({ record, records, rounds, state, expanded, busy, error, selectionSummary,
  onToggleExpanded, onSwitch, onPrimary, onReturn, onContinue, onAttachRounds, onClearSelection,
  onAttachOnly, onUnlink, onCopyPrompt, debugInfo }: {
  record: PendingAssociation; records: PendingAssociation[]; rounds: SelectableRound[]; state: WorkspaceControlDerivedState; expanded: boolean;
  busy: boolean; error?: string; selectionSummary?: string; onToggleExpanded(): void; onSwitch(id: string): void;
  onPrimary(): void; onReturn(): void; onContinue(question: string, skipCapture?: boolean): Promise<boolean | ContinueWorkspaceResult>;
  onAttachRounds(ids: string[]): Promise<boolean>;
  onClearSelection(): void; onAttachOnly(): void; onUnlink(): void; onCopyPrompt(): void; debugInfo?: string;
}) {
  const [view, setView] = useState<View>('status');
  const [question, setQuestion] = useState('');
  const [continueError, setContinueError] = useState<string>();
  const [captureFailed, setCaptureFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelectedRoundIds(rounds));
  useEffect(() => {
    setView('status');
    setSelected(new Set());
    setQuestion('');
    setContinueError(undefined);
    setCaptureFailed(false);
  }, [record.localThread.id]);
  useEffect(() => {
    if (view !== 'rounds') return;
    setSelected((current) => {
      const next = validSelectedRoundIds(rounds, current);
      return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
    });
  }, [rounds, view]);
  const validSelected = validSelectedRoundIds(rounds, selected);

  if (!expanded) return <aside role="complementary" aria-label="PointAsk 当前局部线程" className="pointask-workspace-control pointask-collapsed">
    <WorkspaceControlHeader record={record} records={records} expanded={false} onToggle={onToggleExpanded} onSwitch={onSwitch} />
    <div className="pointask-collapsed-status" aria-live="polite">{state.label}</div>
  </aside>;

  return <aside role="complementary" aria-label="PointAsk 当前局部线程" className="pointask-workspace-control">
    <WorkspaceControlHeader record={record} records={records} expanded onToggle={onToggleExpanded} onSwitch={onSwitch} />
    <div className="pointask-control-space-title">共享追问空间</div>
    <div id="pointask-workspace-control-body" className="pointask-control-body">
      {view === 'continue' ? <ContinueQuestionView displayId={record.localThread.displayId} roundNumber={rounds.length} value={question}
        sending={busy} captureFailed={captureFailed} error={continueError} onChange={setQuestion}
        onCancel={() => { setView('status'); setContinueError(undefined); setCaptureFailed(false); }}
        onSend={() => void onContinue(question, false).then((result) => { const value = typeof result === 'boolean' ? { ok: result } : result;
          if (value.ok) { setQuestion(''); setView('status'); setCaptureFailed(false); } else {
            setCaptureFailed(Boolean(value.captureFailed)); setContinueError(value.error ?? '发送失败，请重试；输入内容已保留。');
          } })}
        onSkipCapture={() => void onContinue(question, true).then((result) => { const value = typeof result === 'boolean' ? { ok: result } : result;
          if (value.ok) { setQuestion(''); setView('status'); setCaptureFailed(false); }
          else setContinueError(value.error ?? '发送失败，请重试；输入内容已保留。');
        })} />
        : view === 'rounds' ? <RoundSelectionView rounds={rounds} selected={validSelected} busy={busy} error={error}
          onToggle={(id) => setSelected((current) => { const round = rounds.find((item) => item.id === id);
            if (!round || !isSelectableRound(round)) return validSelectedRoundIds(rounds, current);
            const next = validSelectedRoundIds(rounds, current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
          onCancel={() => setView('status')} onAttach={() => void onAttachRounds([...validSelected])
            .then((ok) => { if (ok) setView('status'); })} />
          : <WorkspaceStatusView source={record.pendingThread.anchor.selectedText} question={record.pendingThread.question} roundNumber={rounds.length} state={state}
            selectionSummary={selectionSummary} canChooseRounds={rounds.some((round) => !round.attached)} busy={busy} error={error} onPrimary={onPrimary}
            onContinue={() => setView('continue')} onChooseRounds={() => { setSelected(defaultSelectedRoundIds(rounds)); setView('rounds'); }}
            onClearSelection={onClearSelection} onReturn={onReturn} onMore={() => setMenuOpen((open) => !open)} />}
      {menuOpen && <div className="pointask-control-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onAttachOnly(); }}>仅附加，不返回</button>
        <button type="button" role="menuitem" className="pointask-danger" onClick={() => { setMenuOpen(false); if (window.confirm('取消当前页面关联？已保存的线程和 Workspace 不会被删除。')) onUnlink(); }}>取消关联</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCopyPrompt(); }}>复制当前追问提示词</button>
        {debugInfo && <pre>{debugInfo}</pre>}
      </div>}
    </div>
  </aside>;
}
