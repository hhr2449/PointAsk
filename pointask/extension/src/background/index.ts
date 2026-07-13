import { isCompatibleChatGptTargetUrl, isPointAskRuntimeMessage, type PendingAssociation } from '../bridge/runtime-messages';
import { PendingAssociationCoordinator } from './pending-association-coordinator';
import { ChromeStorageDriver } from '../storage/storage-driver';
import { ThreadStore } from '../storage/thread-store';
import { PendingStore } from '../storage/pending-store';
import { SettingsStore } from '../storage/settings-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { runStorageMigration } from '../storage/migration';
import { NavigationStore } from '../storage/navigation-store';

interface TabGateway {
  create(options: { url: string; active: boolean }): Promise<{ id?: number; url?: string }>;
  update(tabId: number, options: { active: boolean; url?: string }): Promise<unknown>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  query?(queryInfo: { url: string }): Promise<Array<{ id?: number; url?: string }>>;
  remove?(tabId: number): Promise<void>;
  get?(tabId: number): Promise<{ id?: number; url?: string; active?: boolean }>;
}

async function openOrActivateChat(tabs: TabGateway, url: string): Promise<{ id?: number; url?: string }> {
  const existing = (await tabs.query?.({ url: 'https://chatgpt.com/*' }))?.find((tab) =>
    tab.id !== undefined && tab.url && isCompatibleChatGptTargetUrl(url, tab.url),
  );
  if (existing?.id !== undefined) {
    await tabs.update(existing.id, { active: true });
    return existing;
  }
  return tabs.create({ url, active: true });
}

interface RuntimeDependencies {
  coordinator: PendingAssociationCoordinator;
  tabs: TabGateway;
  threadStore?: ThreadStore;
  pendingStore?: PendingStore;
  settingsStore?: SettingsStore;
  workspaceStore?: WorkspaceStore;
  navigationStore?: NavigationStore;
}

const coordinator = new PendingAssociationCoordinator();
const storageDriver = new ChromeStorageDriver();
const migrationReady = runStorageMigration(storageDriver).catch(() => undefined);
const dependencies: RuntimeDependencies = {
  coordinator,
  tabs: chrome.tabs,
  threadStore: new ThreadStore(storageDriver),
  pendingStore: new PendingStore(storageDriver),
  settingsStore: new SettingsStore(storageDriver),
  workspaceStore: new WorkspaceStore(storageDriver),
  navigationStore: new NavigationStore(storageDriver),
};

async function persist(record: PendingAssociation, deps: RuntimeDependencies): Promise<void> {
  await Promise.all([
    deps.threadStore?.upsert(record.localThread),
    deps.pendingStore?.upsert(record.pendingThread),
  ]);
  if (record.localThread.answerMode === 'workspace' && record.localThread.workspaceId && record.targetConversationUrl) {
    const workspace = await deps.workspaceStore?.get(record.localThread.workspaceId);
    if (workspace) await deps.workspaceStore?.upsert({
      ...workspace,
      targetConversationUrl: record.targetConversationUrl,
      targetConversationKey: record.targetConversationUrl,
      updatedAt: record.updatedAt,
    });
  }
}

async function notify(record: PendingAssociation, tabs: TabGateway): Promise<void> {
  const tabIds = new Set([record.sourceTabId, record.targetTabId].filter((id): id is number => id !== undefined));
  await Promise.all([...tabIds].map((tabId) =>
    tabs.sendMessage(tabId, { type: 'pointask:pending-thread-updated', record }).catch(() => undefined),
  ));
}

function senderMatchesSource(senderUrl: string | undefined, sourceConversationKey: string): boolean {
  return Boolean(senderUrl && isCompatibleChatGptTargetUrl(sourceConversationKey, senderUrl));
}

async function ensureSourceRecord(id: string, senderTabId: number, senderUrl: string | undefined, deps: RuntimeDependencies): Promise<PendingAssociation | null> {
  const record = deps.coordinator.get(id);
  if (record && senderMatchesSource(senderUrl, record.localThread.sourceConversationKey)) {
    return deps.coordinator.restore(record.pendingThread, record.localThread, senderTabId);
  }
  if (!deps.threadStore || !deps.pendingStore) return record;
  const [thread, pending] = await Promise.all([deps.threadStore.get(id), deps.pendingStore.get(id)]);
  if (!thread || !pending || !senderMatchesSource(senderUrl, thread.sourceConversationKey)) return record;
  return deps.coordinator.restore(pending, thread, senderTabId);
}

async function ensureTargetRecord(id: string, senderTabId: number, senderUrl: string | undefined, deps: RuntimeDependencies): Promise<PendingAssociation | null> {
  const existing = deps.coordinator.get(id);
  if (existing?.targetConversationUrl && senderUrl && isCompatibleChatGptTargetUrl(existing.targetConversationUrl, senderUrl)) {
    return deps.coordinator.associate(id, senderTabId, senderUrl, true);
  }
  if (existing) return existing;
  if (!senderUrl || !deps.threadStore || !deps.pendingStore) return null;
  const [thread, pending] = await Promise.all([deps.threadStore.get(id), deps.pendingStore.get(id)]);
  if (!thread || !pending || !thread.targetConversationUrl || !isCompatibleChatGptTargetUrl(thread.targetConversationUrl, senderUrl)) return null;
  deps.coordinator.restore(pending, thread, -1);
  return deps.coordinator.markTargetOpened(id, senderTabId, senderUrl);
}

export async function handleRuntimeMessage(
  message: unknown,
  sender: { tab?: { id?: number; url?: string } },
  deps: RuntimeDependencies = dependencies,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!isPointAskRuntimeMessage(message)) return { ok: false, error: 'Invalid PointAsk runtime message' };
  if (deps === dependencies) await migrationReady;
  const senderTabId = sender.tab?.id;
  if (senderTabId === undefined) return { ok: false, error: 'A visible sender tab is required' };
  const settings = await deps.settingsStore?.get();
  if (settings) deps.coordinator.setExpiryHours(settings.pendingExpiryHours);

  try {
    switch (message.type) {
      case 'pointask:create-pending-thread': {
        const record = deps.coordinator.create(message.pendingThread, senderTabId, message.localThread);
        await persist(record, deps);
        return { ok: true, data: record };
      }
      case 'pointask:update-local-thread': {
        await ensureSourceRecord(message.pendingThread.id, senderTabId, sender.tab?.url, deps);
        const record = deps.coordinator.updateLocalThread(message.pendingThread, message.localThread, senderTabId,
          senderMatchesSource(sender.tab?.url, message.localThread.sourceConversationKey));
        if (!record) throw new Error('当前页面关联已失效，请重新关联后继续');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:open-target-chat': {
        const existing = await ensureSourceRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        if (!existing || existing.sourceTabId !== senderTabId) throw new Error('Pending thread not found for source tab');
        const tab = await deps.tabs.create({ url: 'https://chatgpt.com/', active: true });
        if (tab.id === undefined) throw new Error('Target tab could not be created');
        const record = deps.coordinator.markTargetOpened(message.pendingThreadId, tab.id, tab.url || 'https://chatgpt.com/');
        if (!record) throw new Error('Pending thread could not be updated');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:open-workspace-context-update': {
        const workspace = await deps.workspaceStore?.get(message.workspaceId);
        if (!workspace?.pendingContextUpdate || !workspace.targetConversationUrl ||
          !senderMatchesSource(sender.tab?.url, workspace.sourceConversationKey)) {
          throw new Error('无法打开共享追问空间，请检查关联后重试');
        }
        const tab = await openOrActivateChat(deps.tabs, workspace.targetConversationUrl);
        if (tab.id === undefined) throw new Error('无法打开共享追问空间');
        return { ok: true };
      }
      case 'pointask:associate-target-page': {
        const record = deps.coordinator.associate(
          message.pendingThreadId,
          senderTabId,
          message.targetUrl,
          message.confirmReassociation,
        );
        if (!record) throw new Error('Target page cannot be associated with this pending thread');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:open-answer-page': {
        const existing = await ensureSourceRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        if (!existing || existing.sourceTabId !== senderTabId || !existing.targetConversationUrl) {
          throw new Error('Associated ChatGPT page is unavailable');
        }
        let tab: { id?: number; url?: string } | null = null;
        if (existing.targetTabId !== undefined) {
          try {
            const current = await deps.tabs.get?.(existing.targetTabId);
            if (current?.url && isCompatibleChatGptTargetUrl(existing.targetConversationUrl, current.url)) {
              await deps.tabs.update(existing.targetTabId, { active: true });
              tab = { id: existing.targetTabId, url: current.url };
            }
          }
          catch { tab = null; }
        }
        tab ??= await openOrActivateChat(deps.tabs, existing.targetConversationUrl);
        if (tab.id === undefined) throw new Error('Associated page could not be opened');
        const record = deps.coordinator.markTargetOpened(message.pendingThreadId, tab.id, tab.url ?? existing.targetConversationUrl);
        if (!record) throw new Error('Associated page could not be activated');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:unlink-target-page': {
        const existing = await ensureSourceRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        const oldTargetTabId = existing?.targetTabId;
        const record = deps.coordinator.unlink(message.pendingThreadId, senderTabId);
        if (!record) throw new Error('Only the source tab can unlink this thread');
        await persist(record, deps);
        await notify(record, deps.tabs);
        if (oldTargetTabId !== undefined) {
          await deps.tabs.sendMessage(oldTargetTabId, { type: 'pointask:pending-thread-updated', record }).catch(() => undefined);
        }
        return { ok: true, data: record };
      }
      case 'pointask:attach-answer': {
        let existing = deps.coordinator.get(message.pendingThreadId);
        if (!existing && deps.threadStore && deps.pendingStore) {
          const [localThread, pendingThread] = await Promise.all([
            deps.threadStore.get(message.pendingThreadId), deps.pendingStore.get(message.pendingThreadId),
          ]);
          const currentConversationTarget = localThread?.answerMode === 'current_conversation' &&
            senderMatchesSource(message.targetUrl, localThread.sourceConversationKey);
          if (localThread && pendingThread && (currentConversationTarget || localThread.targetConversationUrl &&
            isCompatibleChatGptTargetUrl(localThread.targetConversationUrl, message.targetUrl))) {
            deps.coordinator.restore(pendingThread, localThread, -1);
            existing = deps.coordinator.associate(message.pendingThreadId, senderTabId, message.targetUrl, true) ??
              deps.coordinator.markTargetOpened(message.pendingThreadId, senderTabId, message.targetUrl);
          }
        } else if (existing && existing.localThread.answerMode === 'current_conversation' &&
          senderMatchesSource(message.targetUrl, existing.localThread.sourceConversationKey)) {
          existing = deps.coordinator.associate(message.pendingThreadId, senderTabId, message.targetUrl, true);
        } else if (existing && existing.targetTabId !== senderTabId && existing.targetConversationUrl &&
          isCompatibleChatGptTargetUrl(existing.targetConversationUrl, message.targetUrl)) {
          existing = deps.coordinator.associate(message.pendingThreadId, senderTabId, message.targetUrl, true);
        }
        if (!existing) throw new Error('当前页面与该 PointAsk 线程的关联已失效，请重新关联');
        const record = deps.coordinator.attachAnswer(
          message.pendingThreadId,
          senderTabId,
          message.richContent ?? message.selectedText ?? [],
          message.targetUrl,
          message.replace,
          message.answerSource,
        );
        if (!record) throw new Error('Answer cannot be attached to this pending thread');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:pending-thread-updated': {
        const existing = deps.coordinator.get(message.pendingThreadId);
        if (!existing) throw new Error('Pending thread not found');
        if (message.action === 'return-source') {
          if (existing.targetTabId !== senderTabId) throw new Error('Only the target tab may return to source');
          const completed = deps.coordinator.completeReturn(message.pendingThreadId, senderTabId);
          if (completed) { await persist(completed, deps); await notify(completed, deps.tabs); }
          if (existing.sourceTabId < 0) {
            await deps.tabs.create({ url: existing.pendingThread.sourcePageUrl, active: true });
            return { ok: true };
          }
          const options = existing.sourceTabId === existing.targetTabId
            ? { active: true, url: existing.pendingThread.sourcePageUrl }
            : { active: true };
          await deps.tabs.update(existing.sourceTabId, options);
          if (completed && settings?.closeDedicatedTabAfterAttach && existing.localThread.answerMode === 'dedicated_branch' &&
            existing.targetTabId !== undefined && existing.targetTabId !== existing.sourceTabId && deps.tabs.get && deps.tabs.remove) {
            const target = await deps.tabs.get(existing.targetTabId).catch(() => null);
            if (target && target.active === false) await deps.tabs.remove(existing.targetTabId).catch(() => undefined);
          }
          return { ok: true };
        }
        await ensureSourceRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        const record = deps.coordinator.markManualBranch(message.pendingThreadId, senderTabId);
        if (!record) throw new Error('Manual branch can only be prepared from its source tab');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:cancel-pending-thread': {
        await ensureSourceRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        await ensureTargetRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        const record = deps.coordinator.cancel(message.pendingThreadId, senderTabId);
        if (!record) throw new Error('Pending thread cannot be cancelled from this tab');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:get-page-pending-threads': {
        const live = deps.coordinator.forPage(senderTabId).filter((record) => record.pendingThread.status !== 'answer_attached');
        if (live.length || !deps.threadStore || !deps.pendingStore) return { ok: true, data: live };
        const [threads, pendingThreads] = await Promise.all([deps.threadStore.list(), deps.pendingStore.list()]);
        const restored: PendingAssociation[] = [];
        for (const thread of threads.filter((item) => {
          if (['answer_attached', 'failed', 'orphaned'].includes(item.status)) return false;
          return item.answerMode === 'current_conversation'
            ? isCompatibleChatGptTargetUrl(item.sourceConversationKey, message.currentUrl)
            : Boolean(item.targetConversationUrl && isCompatibleChatGptTargetUrl(item.targetConversationUrl, message.currentUrl));
        })) {
          const pending = pendingThreads.find((item) => item.id === thread.id);
          if (!pending) continue;
          deps.coordinator.restore(pending, thread, -1);
          const record = deps.coordinator.markTargetOpened(thread.id, senderTabId, message.currentUrl);
          if (record) restored.push(record);
        }
        return { ok: true, data: restored };
      }
      case 'pointask:get-source-threads': {
        if (!deps.threadStore || !deps.pendingStore) return { ok: true, data: deps.coordinator.forSourceTab(senderTabId) };
        const [threads, pendingThreads] = await Promise.all([
          deps.threadStore.listByConversation(message.conversationKey), deps.pendingStore.list(),
        ]);
        const restored = threads.flatMap((thread) => {
          const pending = pendingThreads.find((item) => item.id === thread.id);
          return pending ? [deps.coordinator.restore(pending, thread, senderTabId)] : [];
        });
        return { ok: true, data: restored };
      }
      case 'pointask:navigate-to-answer': {
        if (!deps.navigationStore) throw new Error('Answer navigation is unavailable');
        const navigation = { id: `pointask-navigation-${Date.now()}`, threadId: message.threadId, locator: message.locator, createdAt: new Date().toISOString() };
        await deps.navigationStore.set(navigation);
        const tab = sender.tab?.url && isCompatibleChatGptTargetUrl(message.locator.conversationUrl, sender.tab.url)
          ? (await deps.tabs.update(senderTabId, { active: true }), { id: senderTabId, url: sender.tab.url })
          : await openOrActivateChat(deps.tabs, message.locator.conversationUrl);
        if (tab.id === undefined) throw new Error('Answer conversation could not be opened');
        await deps.tabs.sendMessage(tab.id, { type: 'pointask:navigation-ready' }).catch(() => undefined);
        return { ok: true, data: navigation };
      }
      case 'pointask:get-pending-navigation': {
        const navigation = await deps.navigationStore?.get();
        return { ok: true, data: navigation && isCompatibleChatGptTargetUrl(navigation.locator.conversationUrl, message.currentUrl) ? navigation : null };
      }
      case 'pointask:complete-navigation': {
        await deps.navigationStore?.clear(message.navigationId);
        return { ok: true };
      }
      case 'pointask:undo-attachment': {
        await ensureSourceRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        await ensureTargetRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        const record = deps.coordinator.undoAttachment(message.pendingThreadId, senderTabId);
        if (!record) throw new Error('Attached answer cannot be undone from this page');
        await persist(record, deps); await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:candidate-answer-state': {
        const record = deps.coordinator.markCandidate(message.pendingThreadId, senderTabId, message.fingerprint, message.streaming);
        if (!record) throw new Error('Candidate answer does not belong to this target tab');
        await persist(record, deps); await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:reserve-prompt-submission': {
        await ensureTargetRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        const record = deps.coordinator.reserveSubmission(message.pendingThreadId, senderTabId, message.promptHash, message.targetUrl);
        if (!record) throw new Error('该问题已发送，或当前页面与线程不匹配');
        await persist(record, deps); await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'PointAsk runtime request failed' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleRuntimeMessage(message, sender).then(sendResponse);
  return true;
});
