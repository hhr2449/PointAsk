import { useMemo, useState } from 'react';
import type { PointAskWorkspace, WorkspaceContextMessage } from '../shared/local-thread';
import { selectWorkspaceContextMessages, type WorkspaceUpdateRange } from '../shared/workspace-context-selection';

interface Props {
  workspace: PointAskWorkspace;
  messages: WorkspaceContextMessage[];
  onCancel(): void;
  onSubmit(messages: WorkspaceContextMessage[], label: string): void;
  onUseSelectionOnly(): void;
  onCreateWorkspace(): void;
}

export function WorkspaceContextUpdater({ workspace, messages, onCancel, onSubmit, onUseSelectionOnly, onCreateWorkspace }: Props) {
  const markerIndex = messages.findIndex((message) => message.fingerprint === workspace.contextState.lastSyncedMessageFingerprint);
  const uncertain = markerIndex < 0;
  const [range, setRange] = useState<WorkspaceUpdateRange>(uncertain ? 'manual' : 'since_snapshot');
  const [selected, setSelected] = useState(() => new Set<string>());
  const candidates = useMemo(() => selectWorkspaceContextMessages(range, messages, markerIndex, selected), [messages, markerIndex, range, selected]);
  return <div className="pointask-modal-backdrop" role="presentation">
    <section className="pointask-modal" role="dialog" aria-modal="true" aria-labelledby="pointask-context-title">
      <h2 id="pointask-context-title">更新共享追问空间上下文</h2>
      <p>选择要带入快照的主对话消息。PointAsk 只会生成待发送内容，不会自动提交。</p>
      {uncertain && <p className="pointask-warning">无法确认上次同步位置，请手动选择更新范围。</p>}
      <label><input type="radio" name="pointask-context-range" checked={range === 'since_snapshot'} disabled={uncertain}
        onChange={() => setRange('since_snapshot')} /> 上次快照后的全部新增消息</label>
      <label><input type="radio" name="pointask-context-range" checked={range === 'recent_two_turns'} onChange={() => setRange('recent_two_turns')} /> 最近 2 轮</label>
      <label><input type="radio" name="pointask-context-range" checked={range === 'manual'} onChange={() => setRange('manual')} /> 手动选择消息范围</label>
      <p className="pointask-context-range-status" role="status">
        {range === 'since_snapshot' && candidates.length === 0
          ? '快照后没有检测到新增消息。最近 2 轮和手动选择可能包含已经同步过的历史消息。'
          : `当前范围包含 ${candidates.length} 条消息。`}
      </p>
      {range === 'manual' && <div className="pointask-context-message-list">
        {messages.map((message) => <label key={message.fingerprint}>
          <input type="checkbox" checked={selected.has(message.fingerprint)} onChange={(event) => setSelected((previous) => {
            const next = new Set(previous); if (event.target.checked) next.add(message.fingerprint); else next.delete(message.fingerprint); return next;
          })} /> <b>{message.role === 'user' ? '用户' : 'AI'}</b>：{message.content.slice(0, 120)}{message.content.length > 120 ? '…' : ''}
        </label>)}
      </div>}
      <div className="pointask-card-actions">
        <button type="button" className="pointask-primary" disabled={!candidates.length}
          onClick={() => onSubmit(candidates, range === 'since_snapshot' ? '上次快照后的新增消息' : range === 'recent_two_turns' ? '最近 2 轮' : '手动选择范围')}>准备上下文更新</button>
        <button type="button" onClick={onCancel}>取消</button>
      </div>
      {uncertain && <div className="pointask-card-actions">
        <button type="button" onClick={onUseSelectionOnly}>仅使用当前选区追问</button>
        <button type="button" onClick={onCreateWorkspace}>创建新的共享追问空间</button>
      </div>}
    </section>
  </div>;
}
