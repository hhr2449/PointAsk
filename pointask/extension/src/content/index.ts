import { ChatGptAdapter } from '../adapters/chatgpt-adapter';
import { ClipboardManager } from '../bridge/clipboard-manager';
import { PendingThreadManager } from '../bridge/pending-thread-manager';
import { WebConversationBridge } from '../bridge/web-conversation-bridge';
import { InlineThreadManager } from './inline-thread-manager';
import { AnswerAttachmentMount } from './answer-attachment-mount';
import { PendingBannerManager } from './pending-banner-manager';
import { QuestionComposerMount } from './question-composer-mount';
import { hydrateSelectionContext, SelectionManager } from './selection-manager';
import { SelectionToolbar } from './selection-toolbar';
import { ChromeStorageDriver } from '../storage/storage-driver';
import { ThreadStore } from '../storage/thread-store';
import { PendingStore } from '../storage/pending-store';
import { SettingsStore } from '../storage/settings-store';
import { MetricsStore } from '../storage/metrics-store';
import { SpaLifecycleManager } from './spa-lifecycle-manager';
import { WorkspaceStore } from '../storage/workspace-store';
import { runStorageMigration } from '../storage/migration';
import { AnswerNavigationManager } from './answer-navigation-manager';
import { WorkspaceContextMount } from './workspace-context-mount';
import { WorkspaceContextBannerManager } from './workspace-context-banner-manager';
import { buildWorkspaceContextUpdatePrompt } from '../bridge/prompt-builder';
import { OperationAuthorizer } from './operation-authorizer';
import { showAttachmentUndo } from './operation-feedback';

const adapter = new ChatGptAdapter();

if (adapter.isSupportedPage()) {
  document.querySelectorAll('[data-pointask-owned="true"]').forEach((element) => element.remove());
  const composer = new QuestionComposerMount();
  const clipboard = new ClipboardManager();
  const webBridge = new WebConversationBridge();
  const storageDriver = new ChromeStorageDriver();
  const migrationReady = runStorageMigration(storageDriver);
  const threadStore = new ThreadStore(storageDriver);
  const pendingStore = new PendingStore(storageDriver);
  const settingsStore = new SettingsStore(storageDriver);
  const metrics = new MetricsStore(storageDriver);
  const workspaceStore = new WorkspaceStore(storageDriver);
  const operationAuthorizer = new OperationAuthorizer(settingsStore);
  const pendingThreads = new PendingThreadManager();
  const threads = new InlineThreadManager(
    pendingThreads, clipboard, webBridge, undefined, undefined, threadStore, pendingStore, metrics, workspaceStore, adapter, operationAuthorizer,
  );
  const banner = new PendingBannerManager(webBridge, clipboard, adapter, operationAuthorizer);
  banner.setReturnToThreadHandler((id) => threads.reveal(id));
  const attachment = new AnswerAttachmentMount(webBridge, operationAuthorizer);
  const answerNavigation = new AnswerNavigationManager(adapter, webBridge);
  const workspaceContextMount = new WorkspaceContextMount();
  const workspaceContextBanner = new WorkspaceContextBannerManager(workspaceStore, adapter, clipboard);
  void workspaceContextBanner.start().catch(() => undefined);
  void answerNavigation.start();
  threads.setContinueHandler((id, thread, anchorElement) => {
    composer.open({
      data: {
        selectedText: thread.anchor.selectedText,
        paragraphText: thread.anchor.paragraphText,
        messageFingerprint: thread.sourceMessageFingerprint,
        conversationKey: thread.sourceConversationKey,
        sourcePageUrl: thread.sourcePageUrl,
        rangeRect: anchorElement.getBoundingClientRect(),
        anchorElement,
        sourceMessageElement: anchorElement,
      },
      answerMode: thread.answerMode,
      onCancel: () => threads.focus(id),
      onSubmit: (question) => { void threads.continueThread(id, question).then((sent) => { if (!sent) threads.focus(id); }); },
    });
  });
  threads.setWorkspaceContextHandler((workspace, threadId) => {
    const contextMessages = adapter.getConversationContextMessages();
    void workspaceStore.updateContextProgress(workspace.id, contextMessages).then((currentWorkspace) => {
      const refreshedWorkspace = currentWorkspace ?? workspace;
      workspaceContextMount.open(refreshedWorkspace, contextMessages, {
      submit: (messages, label) => {
        const now = new Date().toISOString();
        const pendingContextUpdate = {
          id: `pointask-context-update-${refreshedWorkspace.id}-${Date.now()}`,
          workspaceId: refreshedWorkspace.id,
          label,
          prompt: buildWorkspaceContextUpdatePrompt(refreshedWorkspace.contextState.contextVersion, messages),
          messageFingerprints: messages.map((message) => message.fingerprint),
          lastMessageFingerprint: messages.at(-1)!.fingerprint,
          status: 'waiting_for_fill' as const,
          createdAt: now,
          updatedAt: now,
        };
        void workspaceStore.upsert({ ...refreshedWorkspace, pendingContextUpdate, updatedAt: now }).then(async () => {
          if (refreshedWorkspace.targetConversationUrl) await webBridge.openWorkspaceContextUpdate(refreshedWorkspace.id);
          else await threads.prepareManualBranch(threadId);
        }).catch(() => undefined);
      },
      useSelectionOnly: () => threads.focus(threadId),
      createWorkspace: () => void threads.createNewWorkspace(threadId),
      });
    }).catch(() => undefined);
  });
  void banner.start().catch(() => undefined);
  let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const recoveryAttempts = new Map<string, number>();
  const revealReturnedThread = async (): Promise<void> => {
    const navigation = await webBridge.getPendingThreadReturn().catch(() => null);
    if (!navigation || !threads.reveal(navigation.threadId)) return;
    await webBridge.completeNavigation(navigation.id).catch(() => undefined);
  };
  let restoreInProgress = false;
  let restoreQueued = false;
  const restoreSourceThreads = async (): Promise<void> => {
    if (restoreInProgress) { restoreQueued = true; return; }
    restoreInProgress = true;
    let needsRetry = false;
    try {
    await migrationReady;
    const conversationKey = adapter.getConversationKey();
    const [storedThreads, storedPending] = await Promise.all([
      threadStore.listByConversation(conversationKey), pendingStore.list(),
    ]);
    const visibleIds = new Set(storedThreads.map((thread) => thread.id));
    threads.syncVisible(visibleIds);
    for (const thread of storedThreads) {
      const resolution = adapter.resolveTextAnchor(thread.anchor, document.readyState === 'complete');
      if (resolution.status === 'resolved' && resolution.element) {
        recoveryAttempts.delete(thread.id);
        const pending = storedPending.find((item) => item.id === thread.id);
        if (pending) pendingThreads.restore(pending);
        if (threads.mount(thread, resolution.element)) void metrics.increment('anchorsResolved');
      } else {
        // ChatGPT frequently replaces a message subtree while streaming or
        // navigating. Never guess another block: wait for the exact anchor.
        const attempts = Math.min(12, (recoveryAttempts.get(thread.id) ?? 0) + 1);
        recoveryAttempts.set(thread.id, attempts);
        needsRetry ||= attempts < 12;
        if (resolution.status === 'orphaned' && attempts === 12) void metrics.increment('anchorsFailed');
      }
    }
    await revealReturnedThread();
    } finally {
      restoreInProgress = false;
      if (restoreQueued) { restoreQueued = false; void restoreSourceThreads().catch(() => undefined); }
      else if (needsRetry && !recoveryRetryTimer) {
        recoveryRetryTimer = setTimeout(() => {
          recoveryRetryTimer = null;
          void restoreSourceThreads().catch(() => undefined);
        }, 350);
      }
    }
  };
  void migrationReady.then(() => settingsStore.get()).then((settings) => {
    threads.configure(settings);
    return pendingStore.deleteExpired(settings.pendingExpiryHours);
  }).then((expired) => {
    if (expired > 0) void metrics.add('pendingExpired', expired);
  });
  void restoreSourceThreads();
  threadStore.subscribe(() => { void restoreSourceThreads().catch(() => undefined); });
  const lifecycle = new SpaLifecycleManager(adapter, () => {
    void restoreSourceThreads().catch(() => undefined);
    void threads.refreshWorkspaceContextProgress().catch(() => undefined);
  });
  lifecycle.start();
  void threads.refreshWorkspaceContextProgress().catch(() => undefined);
  webBridge.onPendingUpdated((record) => threads.handleAssociationUpdate(record));
  webBridge.onThreadReturnReady(() => { void restoreSourceThreads().then(revealReturnedThread).catch(() => undefined); });
  const toolbar = new SelectionToolbar({
    onFollowUp: (selection) => {
      const data = hydrateSelectionContext(adapter, selection);
      if (!data) return;
      toolbar.hide();
      const cancel = () => { toolbar.show(data, banner.getAttachmentAssociations()); toolbar.focus(); };
      const openQuestion = () => composer.open({
        data,
        onCancel: cancel,
        onSubmit: async (question, mode) => {
          const threadId = await threads.create(data, question, mode);
          if (!threadId) return;
          void threads.confirmAnswerModeAndSend(threadId).then((sent) => { if (!sent) threads.focus(threadId); });
        },
      });
      openQuestion();
    },
    onAttach: (data, association) => {
      toolbar.hide();
      if (association.localThread.answerMode === 'current_conversation') {
        void banner.attachCurrentSelection(data, association).then((attached) => {
          if (!attached) { toolbar.show(data, banner.getAttachmentAssociations()); toolbar.focus(); }
        });
        return;
      }
      attachment.open(
        data,
        association,
        (record) => {
          banner.applyRecord(record);
          threads.handleAssociationUpdate(record);
          showAttachmentUndo(webBridge, record, (restored) => { banner.applyRecord(restored); threads.handleAssociationUpdate(restored); });
        },
        () => {
          toolbar.show(data, banner.getAttachmentAssociations());
          toolbar.focus();
        },
      );
    },
  });
  const selectionManager = new SelectionManager(adapter, (data) => {
    if (data) toolbar.show(data, banner.getAttachmentAssociations());
    else toolbar.hide();
  }, () => banner.getAttachmentAssociations().length === 0);
  selectionManager.start();

  if (import.meta.env.DEV) {
    console.info('[PointAsk] content script loaded');
  }
}
