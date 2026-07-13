import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AnswerMode } from '../shared/local-thread';

interface Props { onConfirm(mode: AnswerMode): void; onBack(): void; onCancel(): void; }
const modes: Array<{ value: AnswerMode; title: string; detail: string; recommended?: boolean }> = [
  { value: 'workspace', title: '共享追问空间', detail: '同一原始对话的多个局部问题复用一个辅助会话。', recommended: true },
  { value: 'current_conversation', title: '当前对话', detail: '追问和回答会进入主聊天记录，并影响后续上下文。' },
  { value: 'dedicated_branch', title: '独立分支', detail: '为这个局部线程单独关联一个 ChatGPT 会话。' },
];
export function AnswerModeSelector({ onConfirm, onBack, onCancel }: Props) {
  const [mode, setMode] = useState<AnswerMode>('workspace');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key === 'Enter') { event.preventDefault(); onConfirm(mode); }
  };
  return <section className="pointask-mode-selector" aria-label="选择回答位置" onKeyDown={keyDown}>
    <h2>选择回答位置</h2>
    <div role="radiogroup">
      {modes.map((item, index) => <label className="pointask-mode" key={item.value}>
        <input ref={index === 0 ? first : undefined} type="radio" name="pointask-answer-mode" value={item.value}
          checked={mode === item.value} onChange={() => setMode(item.value)} />
        <span><strong>{item.title}{item.recommended ? '（默认、推荐）' : ''}</strong><small>{item.detail}</small></span>
      </label>)}
    </div>
    <div className="pointask-actions">
      <button type="button" className="pointask-primary" onClick={() => onConfirm(mode)}>继续</button>
      <button type="button" className="pointask-secondary" onClick={onBack}>返回修改问题</button>
      <button type="button" className="pointask-secondary" onClick={onCancel}>取消</button>
    </div>
  </section>;
}
