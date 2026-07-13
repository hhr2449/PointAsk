import type { PendingThread } from './pending-thread-manager';
import { isPendingAssociationUpdate, type PendingAssociation, type PointAskRuntimeMessage } from './runtime-messages';
import type { AnswerSourceLocator, RichContentBlock } from '../shared/local-thread';
import type { PendingNavigation } from '../storage/navigation-store';
import { isExtensionContextInvalidated } from '../storage/storage-driver';

interface RuntimeMessenger {
  sendMessage(message: PointAskRuntimeMessage): Promise<unknown>;
  onMessage?: {
    addListener(callback: (message: unknown) => void): void;
    removeListener(callback: (message: unknown) => void): void;
  };
}

export class WebConversationBridge {
  constructor(private readonly runtime: RuntimeMessenger = chrome.runtime) {}

  async savePendingThread(pendingThread: PendingThread, localThread?: import('../shared/local-thread').LocalThread): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:create-pending-thread', pendingThread, localThread });
  }

  async openTargetChat(pendingThreadId: string): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:open-target-chat', pendingThreadId });
  }
  async openWorkspaceContextUpdate(workspaceId: string): Promise<void> {
    await this.send({ type: 'pointask:open-workspace-context-update', workspaceId });
  }

  async prepareManualBranch(pendingThreadId: string): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:pending-thread-updated', pendingThreadId, action: 'manual-branch' });
  }

  async associateCurrentPage(
    pendingThreadId: string,
    targetUrl = window.location.href,
    confirmReassociation = false,
  ): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:associate-target-page', pendingThreadId, targetUrl, confirmReassociation });
  }

  async cancel(pendingThreadId: string): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:cancel-pending-thread', pendingThreadId });
  }

  async attachAnswer(
    pendingThreadId: string,
    selectedText: string,
    replace: boolean,
    targetUrl = window.location.href,
    richContent?: RichContentBlock[],
    answerSource?: AnswerSourceLocator,
  ): Promise<PendingAssociation> {
    return this.send({
      type: 'pointask:attach-answer',
      pendingThreadId,
      selectedText,
      richContent,
      answerSource,
      targetUrl,
      replace,
    });
  }

  async returnToSource(pendingThreadId: string): Promise<void> {
    await this.send({ type: 'pointask:pending-thread-updated', pendingThreadId, action: 'return-source' });
  }

  async openAnswerPage(pendingThreadId: string): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:open-answer-page', pendingThreadId });
  }

  async updateLocalThread(pendingThread: PendingThread, localThread: import('../shared/local-thread').LocalThread): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:update-local-thread', pendingThread, localThread });
  }

  async unlinkTargetPage(pendingThreadId: string): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:unlink-target-page', pendingThreadId });
  }

  async getPagePendingThreads(currentUrl = window.location.href): Promise<PendingAssociation[]> {
    return this.send({ type: 'pointask:get-page-pending-threads', currentUrl });
  }

  async getSourceThreads(conversationKey: string): Promise<PendingAssociation[]> {
    return this.send({ type: 'pointask:get-source-threads', conversationKey });
  }

  async navigateToAnswer(threadId: string, locator: AnswerSourceLocator): Promise<PendingNavigation> {
    return this.send({ type: 'pointask:navigate-to-answer', threadId, locator });
  }
  async getPendingNavigation(currentUrl = window.location.href): Promise<PendingNavigation | null> {
    return this.send({ type: 'pointask:get-pending-navigation', currentUrl });
  }
  async completeNavigation(navigationId: string): Promise<void> {
    await this.send({ type: 'pointask:complete-navigation', navigationId });
  }
  async undoAttachment(pendingThreadId: string): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:undo-attachment', pendingThreadId });
  }
  async updateCandidateState(pendingThreadId: string, fingerprint: string, streaming: boolean): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:candidate-answer-state', pendingThreadId, fingerprint, streaming });
  }
  async reservePromptSubmission(pendingThreadId: string, promptHash: string, targetUrl = window.location.href): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:reserve-prompt-submission', pendingThreadId, promptHash, targetUrl });
  }

  onPendingUpdated(callback: (record: PendingAssociation) => void): () => void {
    const listener = (message: unknown) => {
      if (isPendingAssociationUpdate(message)) callback(message.record);
    };
    this.runtime.onMessage?.addListener(listener);
    return () => this.runtime.onMessage?.removeListener(listener);
  }

  onNavigationReady(callback: () => void): () => void {
    const listener = (message: unknown) => {
      if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'pointask:navigation-ready') callback();
    };
    this.runtime.onMessage?.addListener(listener);
    return () => this.runtime.onMessage?.removeListener(listener);
  }

  private async send<T>(message: PointAskRuntimeMessage): Promise<T> {
    let response: { ok?: boolean; data?: T; error?: string } | undefined;
    try { response = await this.runtime.sendMessage(message) as typeof response; }
    catch (error) {
      if (isExtensionContextInvalidated(error)) throw new Error('扩展已更新，请刷新当前页面后继续。');
      throw error;
    }
    if (!response?.ok) {
      const internal = response?.error || '';
      const friendly = /another source tab|cannot be updated from this tab|source tab|associated.*unavailable|cannot be associated/i.test(internal)
        ? '当前页面关联已失效，请重新关联后继续。'
        : internal && /[\u3400-\u9fff]/.test(internal) ? internal : '操作失败，请重试。';
      throw new Error(friendly);
    }
    return response.data as T;
  }
}
