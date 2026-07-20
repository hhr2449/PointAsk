import { useEffect, useRef, type KeyboardEvent } from 'react';

export function ContinueQuestionView({ displayId, roundNumber, value, sending, error, onChange, onCancel, onSend }: {
  displayId: string; roundNumber: number; value: string; sending: boolean; error?: string;
  onChange(value: string): void; onCancel(): void; onSend(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (value.trim() && !sending) onSend(); }
  };
  return <div className="pointask-control-view pointask-continue-view">
    <h2>继续 {displayId}</h2><p>将基于第 {roundNumber} 轮回答继续追问</p>
    <textarea ref={input} aria-label="继续追问内容" value={value} disabled={sending} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
    {error && <p className="pointask-control-error" role="alert">{error}</p>}
    <div className="pointask-control-actions"><button type="button" className="pointask-secondary" disabled={sending} onClick={onCancel}>取消</button>
      <button type="button" className="pointask-primary" disabled={!value.trim() || sending} onClick={onSend}>{sending ? '正在发送' : '发送追问'}</button></div>
  </div>;
}

