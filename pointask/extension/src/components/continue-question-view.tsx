import { useEffect, useRef, type KeyboardEvent } from 'react';

export function ContinueQuestionView({ displayId, roundNumber, value, sending, captureFailed, error, onChange, onCancel, onSend, onSkipCapture }: {
  displayId: string; roundNumber: number; value: string; sending: boolean; captureFailed: boolean; error?: string;
  onChange(value: string): void; onCancel(): void; onSend(): void; onSkipCapture(): void;
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
    {sending && <p aria-live="polite">当前回答暂存中</p>}
    {error && <p className="pointask-control-error" role="alert">{error}</p>}
    <div className="pointask-control-actions"><button type="button" className="pointask-secondary" disabled={sending} onClick={onCancel}>取消</button>
      {captureFailed && <button type="button" className="pointask-secondary" disabled={!value.trim() || sending} onClick={onSkipCapture}>继续但不暂存</button>}
      <button type="button" className="pointask-primary" disabled={!value.trim() || sending} onClick={onSend}>{sending ? '正在处理' : captureFailed ? '重试暂存' : '发送追问'}</button></div>
  </div>;
}
