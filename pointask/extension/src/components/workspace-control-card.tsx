import { useEffect, useMemo, useState } from 'react';
import type { PendingAssociation } from '../bridge/runtime-messages';
import { richPlainText } from '../shared/rich-content';
import { ContinueQuestionView } from './continue-question-view';
import { RoundSelectionView, type SelectableRound } from './round-selection-view';
import { defaultSelectedRoundIds } from './round-selection-state';
import { WorkspaceControlHeader } from './workspace-control-header';
import { WorkspaceStatusView } from './workspace-status-view';
import type { WorkspaceControlDerivedState } from './workspace-control-state';

type View = 'status' | 'continue' | 'rounds';

export function WorkspaceControlCard({ record, records, state, expanded, busy, error, selectionSummary,
  onToggleExpanded, onSwitch, onPrimary, onReturn, onContinue, onAttachRounds, onClearSelection,
  onAttachOnly, onUnlink, onCopyPrompt, debugInfo }: {
  record: PendingAssociation; records: PendingAssociation[]; state: WorkspaceControlDerivedState; expanded: boolean;
  busy: boolean; error?: string; selectionSummary?: string; onToggleExpanded(): void; onSwitch(id: string): void;
  onPrimary(): void; onReturn(): void; onContinue(question: string): Promise<boolean>; onAttachRounds(ids: string[]): Promise<boolean>;
  onClearSelection(): void; onAttachOnly(): void; onUnlink(): void; onCopyPrompt(): void; debugInfo?: string;
}) {
  const [view, setView] = useState<View>('status');
  const [question, setQuestion] = useState('');
  const [continueError, setContinueError] = useState<string>();
  const [menuOpen, setMenuOpen] = useState(false);
  const rounds = useMemo<SelectableRound[]>(() => {
    const result: SelectableRound[] = [];
    for (const message of record.localThread.messages) {
      if (message.role === 'user') result.push({ id: message.id, index: result.length + 1, question: richPlainText(message.content), attached: false, latest: false });
      else if (result.length) result[result.length - 1]!.attached = true;
    }
    if (result.length) result[result.length - 1]!.latest = true;
    return result;
  }, [record.localThread.messages]);
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelectedRoundIds(rounds));
  useEffect(() => {
    setView('status');
    setSelected(new Set());
    setQuestion('');
    setContinueError(undefined);
  }, [record.localThread.id]);

  if (!expanded) return <aside role="complementary" aria-label="PointAsk 当前局部线程" className="pointask-workspace-control pointask-collapsed">
    <WorkspaceControlHeader record={record} records={records} expanded={false} onToggle={onToggleExpanded} onSwitch={onSwitch} />
    <div className="pointask-collapsed-status" aria-live="polite">{state.label}</div>
  </aside>;

  return <aside role="complementary" aria-label="PointAsk 当前局部线程" className="pointask-workspace-control">
    <WorkspaceControlHeader record={record} records={records} expanded onToggle={onToggleExpanded} onSwitch={onSwitch} />
    <div className="pointask-control-space-title">共享追问空间</div>
    <div id="pointask-workspace-control-body" className="pointask-control-body">
      {view === 'continue' ? <ContinueQuestionView displayId={record.localThread.displayId} roundNumber={rounds.length} value={question}
        sending={busy} error={continueError} onChange={setQuestion} onCancel={() => { setView('status'); setContinueError(undefined); }}
        onSend={() => void onContinue(question).then((ok) => { if (ok) { setQuestion(''); setView('status'); } else setContinueError('发送失败，请重试；输入内容已保留。'); })} />
        : view === 'rounds' ? <RoundSelectionView rounds={rounds} selected={selected} busy={busy} error={error}
          onToggle={(id) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
          onCancel={() => setView('status')} onAttach={() => void onAttachRounds([...selected]).then((ok) => { if (ok) setView('status'); })} />
          : <WorkspaceStatusView source={record.pendingThread.anchor.selectedText} question={record.pendingThread.question} state={state}
            selectionSummary={selectionSummary} canChooseRounds={rounds.length >= 2} busy={busy} error={error} onPrimary={onPrimary}
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
