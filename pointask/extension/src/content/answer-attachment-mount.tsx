import { createRoot, type Root } from 'react-dom/client';
import type { PendingAssociation } from '../bridge/runtime-messages';
import type { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { AnswerAttachmentConfirmation, MAX_ATTACHED_ANSWER_LENGTH } from '../components/answer-attachment-confirmation';
import { attachmentConfirmationStyles } from './shadow-styles';
import type { SelectionData } from './selection-manager';
import { richContentStyles } from '../components/rich-content-renderer';
import type { OperationAuthorizer } from './operation-authorizer';
import { applyPointAskTheme } from './theme';

export class AnswerAttachmentMount {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  private submitting = false;
  private error: string | undefined;

  constructor(private readonly bridge: WebConversationBridge, private readonly authorizer?: OperationAuthorizer) {}

  open(
    data: SelectionData,
    association: PendingAssociation,
    onAttached: (record: PendingAssociation) => void,
    onCancel: () => void,
  ): boolean {
    if (!data.selectedText || data.selectedText.length > MAX_ATTACHED_ANSWER_LENGTH) return false;
    if (this.authorizer) {
      void this.authorizer.authorize().then(async (allowed) => {
        if (!allowed) { onCancel(); return; }
        try { onAttached(await this.attach(data, association)); }
        catch (error) { this.showFeedback(error instanceof Error ? error.message : '操作失败，请重试'); }
      });
      return true;
    }
    this.close();
    this.error = undefined;
    const host = document.createElement('pointask-answer-attachment-confirmation');
    host.dataset.pointaskOwned = 'true';
    applyPointAskTheme(host);
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
            const record = await this.attach(data, association, replacing);
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

  private async attach(data: SelectionData, association: PendingAssociation, expectedReplacing?: boolean): Promise<PendingAssociation> {
    const pageRecords = await this.bridge.getPagePendingThreads();
    const current = (Array.isArray(pageRecords) ? pageRecords : []).find((record) => record.pendingThread.id === association.pendingThread.id) ?? association;
    const replacing = current.localThread.messages.at(-1)?.role === 'assistant';
    if (expectedReplacing !== undefined && replacing !== expectedReplacing) throw new Error('线程状态刚刚发生变化，请重新选择回答。');
    return this.bridge.attachAnswer(association.pendingThread.id, data.selectedText, replacing, window.location.href, data.richSelection?.blocks, {
      conversationUrl: window.location.href, conversationKey: data.conversationKey, messageFingerprint: data.messageFingerprint,
      selectedText: data.selectedText, prefixText: data.textAnchor?.prefixText, suffixText: data.textAnchor?.suffixText,
    });
  }

  private showFeedback(message: string): void {
    const host = document.createElement('pointask-operation-feedback'); host.dataset.pointaskOwned = 'true';
    Object.assign(host.style, { position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px', padding: '10px 14px', borderRadius: '9px', background: '#fff', boxShadow: '0 8px 24px #0003' });
    host.textContent = message || '操作失败，请重试'; document.documentElement.append(host); setTimeout(() => host.remove(), 3_000);
  }
}
