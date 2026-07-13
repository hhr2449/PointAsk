import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { RichContentBlock } from '../shared/local-thread';
import { RichContentRenderer } from './rich-content-renderer';

export const MAX_QUESTION_LENGTH = 500;

interface QuestionComposerProps {
  selectedText: string;
  submitting: boolean;
  onSubmit(question: string): void;
  onCancel(): void;
  initialQuestion?: string;
  richContent?: RichContentBlock[];
}

export function QuestionComposer({ selectedText, richContent, submitting, onSubmit, onCancel, initialQuestion = '' }: QuestionComposerProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedQuestion = question.trim();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = () => {
    if (!submitting && trimmedQuestion) onSubmit(trimmedQuestion);
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
