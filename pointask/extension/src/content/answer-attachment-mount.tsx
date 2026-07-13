import { createRoot, type Root } from 'react-dom/client';
import type { PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { AnswerAttachmentConfirmation, MAX_ATTACHED_ANSWER_LENGTH } from '../components/answer-attachment-confirmation';
import { attachmentConfirmationStyles } from './shadow-styles';
import type { SelectionData } from './selection-manager';
import { richContentStyles } from '../components/rich-content-renderer';

export class AnswerAttachmentMount {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  private submitting = false;
  private error: string | undefined;

  constructor(private readonly bridge: WebConversationBridge) {}

  open(
    data: SelectionData,
    association: PendingAssociation,
    onAttached: (record: PendingAssociation) => void,
    onCancel: () => void,
  ): boolean {
    if (!data.selectedText || data.selectedText.length > MAX_ATTACHED_ANSWER_LENGTH) return false;
    this.close();
    this.error = undefined;
    const host = document.createElement('pointask-answer-attachment-confirmation');
    host.dataset.pointaskOwned = 'true';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${attachmentConfirmationStyles}\n${richContentStyles}`;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    document.documentElement.append(host);
    this.host = host;
    this.root = createRoot(mount);

    const replacing = association.localThread.messages.at(-1)?.role === 'assistant';
    const render = () => this.root?.render(
      <AnswerAttachmentConfirmation
        selectedText={data.selectedText}
        richContent={data.richSelection?.blocks}
        association={association}
        submitting={this.submitting}
        error={this.error}
        onCancel={() => {
          if (this.submitting) return;
          this.close();
          onCancel();
        }}
        onConfirm={async () => {
          if (this.submitting) return;
          this.submitting = true;
          render();
          try {
            const pageRecords = await this.bridge.getPagePendingThreads();
            const current = (Array.isArray(pageRecords) ? pageRecords : []).find((record) => record.pendingThread.id === association.pendingThread.id) ?? association;
            const latestReplacing = current.localThread.messages.at(-1)?.role === 'assistant';
            if (latestReplacing !== replacing) throw new Error('线程状态刚刚发生变化，请关闭后重新选择回答。');
            const record = await this.bridge.attachAnswer(
              association.pendingThread.id,
              data.selectedText,
              latestReplacing,
              window.location.href,
              data.richSelection?.blocks,
              {
                conversationUrl: window.location.href,
                conversationKey: data.conversationKey,
                messageFingerprint: data.messageFingerprint,
                selectedText: data.selectedText,
                prefixText: data.textAnchor?.prefixText,
                suffixText: data.textAnchor?.suffixText,
              },
            );
            this.close();
            onAttached(record);
          } catch (error) {
            this.submitting = false;
            this.error = error instanceof Error ? error.message : '无法保存所选回答';
            render();
          }
        }}
      />,
    );
    render();
    return true;
  }

  close(): void {
    this.root?.unmount();
    this.root = null;
    this.host?.remove();
    this.host = null;
    this.submitting = false;
    this.error = undefined;
  }
}
