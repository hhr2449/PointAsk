import { createRoot, type Root } from 'react-dom/client';
import { QuestionComposer } from '../components/question-composer';
import { composerStyles } from './shadow-styles';
import type { SelectionData } from './selection-manager';
import type { AnswerMode } from '../shared/local-thread';
import { richContentStyles } from '../components/rich-content-renderer';
import { applyPointAskTheme } from './theme';

interface OpenComposerOptions {
  data: SelectionData;
  onSubmit(question: string, answerMode: AnswerMode): void | Promise<void>;
  onCancel(): void;
  initialQuestion?: string;
  answerMode?: AnswerMode;
}

export class QuestionComposerMount {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  private submitting = false;

  open({ data, onSubmit, onCancel, initialQuestion, answerMode }: OpenComposerOptions): void {
    this.close();
    const host = document.createElement('pointask-question-composer');
    host.dataset.pointaskOwned = 'true';
    applyPointAskTheme(host, data.anchorElement);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${composerStyles}\n${richContentStyles}`;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    document.documentElement.append(host);
    const pageStyle = getComputedStyle(document.body);
    const surface = pageStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'Canvas' : pageStyle.backgroundColor;
    host.style.setProperty('--pointask-surface', surface);
    host.style.setProperty('--pointask-text', pageStyle.color || 'CanvasText');
    this.host = host;
    this.root = createRoot(mount);
    this.position(data.rangeRect);

    const render = () => this.root?.render(
      <QuestionComposer
        selectedText={data.selectedText}
        richContent={data.richSelection?.blocks}
        submitting={this.submitting}
        initialQuestion={initialQuestion}
        answerMode={answerMode}
        onCancel={() => {
          if (this.submitting) return;
          this.close();
          onCancel();
        }}
        onSubmit={async (question, selectedAnswerMode) => {
          if (this.submitting) return;
          this.submitting = true;
          render();
          try {
            await onSubmit(question, selectedAnswerMode);
          } finally {
            this.close();
          }
        }}
      />,
    );
    render();
  }

  close(): void {
    this.root?.unmount();
    this.root = null;
    this.host?.remove();
    this.host = null;
    this.submitting = false;
  }

  private position(rect: DOMRect): void {
    if (!this.host) return;
    const width = Math.min(420, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, rect.bottom + 10), Math.max(8, window.innerHeight - 390));
    this.host.style.left = `${left}px`;
    this.host.style.top = `${top}px`;
  }
}
