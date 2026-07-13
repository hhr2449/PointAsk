import type { PendingAssociation } from '../bridge/runtime-messages';
import type { RichContentBlock } from '../shared/local-thread';
import { RichContentRenderer } from './rich-content-renderer';

export const MAX_ATTACHED_ANSWER_LENGTH = 8_000;

interface AnswerAttachmentConfirmationProps {
  selectedText: string;
  richContent?: RichContentBlock[];
  association: PendingAssociation;
  submitting: boolean;
  error?: string;
  onConfirm(): void;
  onCancel(): void;
}

export function AnswerAttachmentConfirmation({
  selectedText, richContent, association, submitting, error, onConfirm, onCancel,
}: AnswerAttachmentConfirmationProps) {
  const replacing = association.localThread.messages.at(-1)?.role === 'assistant';
  const valid = selectedText.length > 0 && selectedText.length <= MAX_ATTACHED_ANSWER_LENGTH;
  return (
    <section className="pointask-attachment-confirmation" aria-label="确认附加 PointAsk 回答">
      <h2>{replacing ? '替换已附加的回答？' : '将以下内容附加到 PointAsk？'}</h2>
      <blockquote>{richContent ? <RichContentRenderer blocks={richContent} /> : selectedText}</blockquote>
      <output aria-live="polite">{selectedText.length}/{MAX_ATTACHED_ANSWER_LENGTH}</output>
      <p><strong>对应线程：</strong>{association.localThread.displayId}</p>
      <p><strong>对应问题：</strong>{association.pendingThread.question}</p>
      {error && <p className="pointask-error" role="alert">附加失败：{error}</p>}
      <div className="pointask-actions">
        <button type="button" className="pointask-primary" disabled={!valid || submitting} onClick={onConfirm}>
          {submitting ? '附加中…' : replacing ? '确认替换' : '确认附加'}
        </button>
        <button type="button" className="pointask-secondary" disabled={submitting} onClick={onCancel}>取消</button>
      </div>
    </section>
  );
}
