import type { PendingThread } from './pending-thread-manager';
import { isPendingAssociationUpdate, type PendingAssociation, type PointAskRuntimeMessage } from './runtime-messages';
import type { AnswerSourceLocator, RichContentBlock } from '../shared/local-thread';
import type { AttachedRoundPayload } from './runtime-messages';
import type { PendingNavigation, PendingThreadReturn } from '../storage/navigation-store';
import { isExtensionContextInvalidated } from '../storage/storage-driver';

interface RuntimeMessenger {
  sendMessage(message: PointAskRuntimeMessage): Promise<unknown>;
  onMessage?: {
    addListener(callback: (message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown): void;
    removeListener(callback: (message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown): void;
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
  async openOrAutoSendWorkspace(
    pendingThreadId: string, promptHash: string, attemptId: string,
  ): Promise<{ record: PendingAssociation; autoSent: boolean }> {
    return this.send({ type: 'pointask:open-or-auto-send-workspace', pendingThreadId, promptHash, attemptId });
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

  async attachRounds(pendingThreadId: string, rounds: AttachedRoundPayload[], targetUrl = window.location.href): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:attach-rounds', pendingThreadId, rounds, targetUrl });
  }

  async stageRoundAnswer(pendingThreadId: string, roundId: string, promptHash: string, options: {
    captureFailed: boolean; richContent?: RichContentBlock[]; answerSource?: AnswerSourceLocator; targetUrl?: string;
  }): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:stage-round-answer', pendingThreadId, roundId, promptHash,
      targetUrl: options.targetUrl ?? window.location.href, captureFailed: options.captureFailed,
      richContent: options.richContent, answerSource: options.answerSource });
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
  async getPendingThreadReturn(currentUrl = window.location.href): Promise<PendingThreadReturn | null> {
    return this.send({ type: 'pointask:get-pending-thread-return', currentUrl });
  }
  onThreadReturnReady(callback: () => void): () => void {
    const listener = (message: unknown) => {
      if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'pointask:thread-return-ready') callback();
    };
    this.runtime.onMessage?.addListener(listener);
    return () => this.runtime.onMessage?.removeListener(listener);
  }
  onThreadReturnProbe(callback: (threadId: string, roundId?: string) => boolean): () => void {
    const listener = (message: unknown, _sender?: unknown, sendResponse?: (response: unknown) => void) => {
      if (!message || typeof message !== 'object') return false;
      const value = message as { type?: unknown; threadId?: unknown; roundId?: unknown };
      if (value.type !== 'pointask:probe-thread-return' || typeof value.threadId !== 'string') return false;
      sendResponse?.({ ready: callback(value.threadId, typeof value.roundId === 'string' ? value.roundId : undefined) });
      return true;
    };
    this.runtime.onMessage?.addListener(listener);
    return () => this.runtime.onMessage?.removeListener(listener);
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
  async releasePromptSubmission(pendingThreadId: string, promptHash: string): Promise<PendingAssociation> {
    return this.send({ type: 'pointask:release-prompt-submission', pendingThreadId, promptHash });
  }
  onPendingUpdated(callback: (record: PendingAssociation) => void): () => void {
    const listener = (message: unknown) => {
      if (isPendingAssociationUpdate(message)) callback(message.record);
    };
    this.runtime.onMessage?.addListener(listener);
    return () => this.runtime.onMessage?.removeListener(listener);
  }

  onExecutePendingSend(callback: (
    record: PendingAssociation, attemptId: string, promptHash: string,
  ) => Promise<{ ok: boolean; error?: string }>): () => void {
    const listener = (message: unknown, _sender?: unknown, sendResponse?: (response: unknown) => void) => {
      if (!message || typeof message !== 'object') return false;
      const value = message as { type?: unknown; record?: PendingAssociation; attemptId?: unknown; promptHash?: unknown };
      if (value.type !== 'pointask:execute-pending-send' || !value.record || typeof value.attemptId !== 'string' ||
        typeof value.promptHash !== 'string' || (value.record.pendingThread.threadId || value.record.pendingThread.id) !== value.record.localThread.id ||
        value.record.pendingThread.promptHash !== value.promptHash) return false;
      void callback(value.record, value.attemptId, value.promptHash).then(
        (result) => sendResponse?.({ ...result, attemptId: value.attemptId }),
        (error: unknown) => sendResponse?.({ ok: false, attemptId: value.attemptId, error: error instanceof Error ? error.message : '发送失败，请重试' }),
      );
      return true;
    };
    this.runtime.onMessage?.addListener(listener);
    return () => this.runtime.onMessage?.removeListener(listener);
  }

  onTargetReadyProbe(callback: (targetConversationUrl: string) => {
    ready: boolean; conversationUrl: string; composerReady: boolean;
  }): () => void {
    const listener = (message: unknown, _sender?: unknown, sendResponse?: (response: unknown) => void) => {
      if (!message || typeof message !== 'object') return false;
      const value = message as { type?: unknown; targetConversationUrl?: unknown };
      if (value.type !== 'pointask:ping' || typeof value.targetConversationUrl !== 'string') return false;
      sendResponse?.(callback(value.targetConversationUrl));
      return true;
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
      if (import.meta.env.DEV) console.debug(`[PointAsk bridge]\ntype=${message.type}\nerror=${internal || 'empty_response'}`);
      const friendly = /quota|QUOTA_BYTES|storage.*limit/i.test(internal)
        ? 'PointAsk 本地存储空间不足，请先在设置中清理不再需要的数据。'
        : /message port closed|receiving end does not exist|service worker|context invalidated/i.test(internal)
          ? 'PointAsk 后台连接刚刚中断，正在保留当前轮次供重试。'
          : message.type === 'pointask:stage-round-answer' && /invalid pointask runtime message/i.test(internal)
            ? '暂存请求校验失败，请刷新当前页面后重试。'
            : /another source tab|cannot be updated from this tab|source tab|associated.*unavailable|cannot be associated/i.test(internal)
        ? '当前页面关联已失效，请重新关联后继续。'
        : internal && /[\u3400-\u9fff]/.test(internal) ? internal : '操作失败，请重试。';
      throw new Error(friendly);
    }
    return response.data as T;
  }
}
