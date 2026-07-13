import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AnswerMode, RichContentBlock } from '../shared/local-thread';
import { RichContentRenderer } from './rich-content-renderer';

export const MAX_QUESTION_LENGTH = 500;

interface QuestionComposerProps {
  selectedText: string;
  submitting: boolean;
  onSubmit(question: string, answerMode: AnswerMode): void;
  onCancel(): void;
  initialQuestion?: string;
  answerMode?: AnswerMode;
  richContent?: RichContentBlock[];
}

export function QuestionComposer({ selectedText, richContent, submitting, onSubmit, onCancel, initialQuestion = '', answerMode }: QuestionComposerProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const [selectedAnswerMode, setSelectedAnswerMode] = useState<AnswerMode>(answerMode ?? 'workspace');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedQuestion = question.trim();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = () => {
    if (!submitting && trimmedQuestion) onSubmit(trimmedQuestion, selectedAnswerMode);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section className="pointask-composer" aria-label="针对选中文字追问">
      <blockquote className="pointask-quote">{richContent ? <RichContentRenderer blocks={richContent} /> : selectedText}</blockquote>
      <label className="pointask-label" htmlFor="pointask-question">你的问题</label>
      <textarea
        id="pointask-question"
        ref={textareaRef}
        value={question}
        maxLength={MAX_QUESTION_LENGTH}
        rows={3}
        disabled={submitting}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {answerMode === undefined && <fieldset className="pointask-answer-mode">
        <legend>回答位置</legend>
        <label>
          <input type="radio" name="pointask-composer-answer-mode" checked={selectedAnswerMode === 'workspace'}
            disabled={submitting} onChange={() => setSelectedAnswerMode('workspace')} />
          <span><strong>追问空间</strong><small>自动打开或复用关联的追问空间</small></span>
        </label>
        <label>
          <input type="radio" name="pointask-composer-answer-mode" checked={selectedAnswerMode === 'current_conversation'}
            disabled={submitting} onChange={() => setSelectedAnswerMode('current_conversation')} />
          <span><strong>当前对话</strong><small>直接发送到当前 ChatGPT 对话</small></span>
        </label>
      </fieldset>}
      <div className="pointask-footer">
        <output aria-live="polite">{question.length}/{MAX_QUESTION_LENGTH}</output>
        <div className="pointask-actions">
          <button type="button" className="pointask-secondary" disabled={submitting} onClick={onCancel}>取消</button>
          <button type="button" className="pointask-primary" disabled={submitting || !trimmedQuestion} onClick={submit}>
            {submitting ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
    </section>
  );
}
