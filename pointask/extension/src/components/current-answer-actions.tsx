interface CurrentAnswerActionsProps {
  displayId: string;
  streaming: boolean;
  reliable: boolean;
  attaching: boolean;
  error?: string;
  onAttachAndReturn(): void;
  onReturn(): void;
  onSelectPartial(): void;
}

export function CurrentAnswerActions({
  displayId, streaming, reliable, attaching, error, onAttachAndReturn, onReturn, onSelectPartial,
}: CurrentAnswerActionsProps) {
  return <section className="pointask-current-answer-actions" aria-label={`${displayId} 回答操作`}>
    <div className="pointask-current-answer-label">
      <strong>{displayId}</strong>
      <span>{streaming ? '回答生成中' : reliable ? '回答已生成' : '请确认需要附加的回答范围'}</span>
    </div>
    <div className="pointask-current-answer-buttons">
      {reliable && <button type="button" className="pointask-primary" disabled={streaming || attaching} onClick={onAttachAndReturn}>
        {attaching ? '正在附加…' : `附加并返回 ${displayId}`}
      </button>}
      <button type="button" className="pointask-secondary" disabled={attaching} onClick={onReturn}>仅返回原文</button>
      <button type="button" className="pointask-secondary" disabled={attaching} onClick={onSelectPartial}>框选部分附加</button>
    </div>
    {error && <p className="pointask-error" role="alert">{error}</p>}
  </section>;
}
