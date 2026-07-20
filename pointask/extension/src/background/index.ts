import { isCompatibleChatGptTargetUrl, isPointAskRuntimeMessage, type PendingAssociation } from '../bridge/runtime-messages';
import { PendingAssociationCoordinator } from './pending-association-coordinator';
import { ChromeStorageDriver } from '../storage/storage-driver';
import { ThreadStore } from '../storage/thread-store';
import { PendingStore } from '../storage/pending-store';
import { SettingsStore } from '../storage/settings-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { runStorageMigration } from '../storage/migration';
import { NavigationStore, ThreadReturnStore } from '../storage/navigation-store';
import { threadRounds } from '../shared/thread-rounds';

interface TabGateway {
  create(options: { url: string; active: boolean }): Promise<{ id?: number; url?: string; pendingUrl?: string; status?: string }>;
  update(tabId: number, options: { active: boolean; url?: string }): Promise<unknown>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  query?(queryInfo: { url: string }): Promise<Array<{ id?: number; url?: string }>>;
  remove?(tabId: number): Promise<void>;
  get?(tabId: number): Promise<{ id?: number; url?: string; active?: boolean; status?: string; pendingUrl?: string }>;
  onRemoved?: { addListener(callback: (tabId: number) => void): void };
}

function resolvedTargetUrl(tab: { url?: string; pendingUrl?: string }, requestedUrl: string): string {
  for (const candidate of [tab.url, tab.pendingUrl]) {
    if (candidate && isCompatibleChatGptTargetUrl(requestedUrl, candidate)) return candidate;
  }
  // tabs.create() may expose about:blank while the requested page is still
  // loading. Never persist that transient browser URL as a conversation route.
  return requestedUrl;
}

function isUnboundChatUrl(url: string): boolean {
  try { return new URL(url).pathname.replace(/\/+$/, '') === ''; }
  catch { return false; }
}

async function openOrActivateChat(tabs: TabGateway, url: string, preferredTabId?: number): Promise<{ id?: number; url?: string }> {
  if (preferredTabId !== undefined && tabs.get) {
    const preferred = await tabs.get(preferredTabId).catch(() => null);
    if (preferred?.url && isCompatibleChatGptTargetUrl(url, preferred.url)) {
      await tabs.update(preferredTabId, { active: true });
      return { id: preferredTabId, url: preferred.url };
    }
  }
  // A root URL may reuse only another exact root/new-chat tab. The general
  // compatibility rule intentionally allows root -> /c/... SPA transitions,
  // which would otherwise risk routing into the source conversation here.
  const existing = (await tabs.query?.({ url: 'https://chatgpt.com/*' }))?.find((tab) =>
    tab.id !== undefined && tab.url && (isUnboundChatUrl(url)
      ? isUnboundChatUrl(tab.url)
      : isCompatibleChatGptTargetUrl(url, tab.url)),
  );
  if (existing?.id !== undefined) {
    await tabs.update(existing.id, { active: true });
    return existing;
  }
  return tabs.create({ url, active: true });
}

async function findExistingChat(
  tabs: TabGateway, url: string, preferredTabId: number | undefined, excludedTabId: number,
): Promise<{ id?: number; url?: string } | null> {
  if (preferredTabId !== undefined && preferredTabId !== excludedTabId && tabs.get) {
    const preferred = await tabs.get(preferredTabId).catch(() => null);
    if (preferred?.url && isCompatibleChatGptTargetUrl(url, preferred.url)) return { id: preferredTabId, url: preferred.url };
  }
  return (await tabs.query?.({ url: 'https://chatgpt.com/*' }))?.find((tab) =>
    tab.id !== undefined && tab.id !== excludedTabId && tab.url && isCompatibleChatGptTargetUrl(url, tab.url),
  ) ?? null;
}

async function waitForReadyTarget(tabs: TabGateway, tabId: number, targetConversationUrl: string): Promise<void> {
  let lastError = '共享追问空间尚未就绪';
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await tabs.sendMessage(tabId, { type: 'pointask:ping', targetConversationUrl }) as {
        ready?: boolean; composerReady?: boolean; conversationUrl?: string;
      } | undefined;
      if (response?.ready && response.composerReady && response.conversationUrl &&
        isCompatibleChatGptTargetUrl(targetConversationUrl, response.conversationUrl)) return;
      lastError = response?.conversationUrl && !isCompatibleChatGptTargetUrl(targetConversationUrl, response.conversationUrl)
        ? '共享追问空间 URL 不匹配' : '共享追问空间输入框尚未就绪';
    } catch (error) { lastError = error instanceof Error ? error.message : lastError; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(lastError);
}

async function waitForSourceThread(tabs: TabGateway, tabId: number, threadId: string, roundId?: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    await tabs.sendMessage(tabId, { type: 'pointask:thread-return-ready', threadId }).catch(() => undefined);
    const response = await tabs.sendMessage(tabId, { type: 'pointask:probe-thread-return', threadId, roundId }).catch(() => null) as { ready?: boolean } | null;
    if (response?.ready) return;
    // Older installed content scripts do not implement the probe. The ready
    // notification above preserves compatibility during extension updates.
    if (response && response.ready === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('已打开原会话，但 PointAsk 卡片尚未恢复，请重试返回');
}

const activeWorkspaceAttempts = new Map<string, string>();

interface RuntimeDependencies {
  coordinator: PendingAssociationCoordinator;
  tabs: TabGateway;
  threadStore?: ThreadStore;
  pendingStore?: PendingStore;
  settingsStore?: SettingsStore;
  workspaceStore?: WorkspaceStore;
  navigationStore?: NavigationStore;
  threadReturnStore?: ThreadReturnStore;
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
  threadReturnStore: new ThreadReturnStore(storageDriver),
};

async function persist(record: PendingAssociation, deps: RuntimeDependencies): Promise<void> {
  const { targetTabId: _transientTargetTabId, ...storedPendingThread } = record.pendingThread;
  void _transientTargetTabId;
  if (deps.threadStore && deps.pendingStore) await deps.threadStore.upsertAssociation(record.localThread, storedPendingThread);
  else await Promise.all([deps.threadStore?.upsert(record.localThread), deps.pendingStore?.replaceForThread(storedPendingThread)]);
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

export async function handleTargetTabRemoved(tabId: number, deps: RuntimeDependencies = dependencies): Promise<void> {
  const records = deps.coordinator.clearTargetTab(tabId);
  await Promise.all(records.map(async (record) => {
    await persist(record, deps);
    await notify(record, deps.tabs);
  }));
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
  const pending = await deps.pendingStore.get(id);
  const thread = await deps.threadStore.get(pending?.threadId || id);
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
  const pending = await deps.pendingStore.get(id);
  const thread = await deps.threadStore.get(pending?.threadId || id);
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
        const stored = await deps.threadStore?.get(message.pendingThread.threadId || message.pendingThread.id);
        if (stored && stored.id !== (message.pendingThread.threadId || message.pendingThread.id)) {
          throw new Error('线程标识冲突，请刷新页面后重试');
        }
        const threadId = message.pendingThread.threadId || message.pendingThread.id;
        const previous = deps.coordinator.findByThreadId(threadId);
        const continuedFromTarget = Boolean(message.localThread && previous?.targetTabId === senderTabId && previous.sourceTabId !== senderTabId);
        if (previous && previous.pendingThread.id !== message.pendingThread.id) {
          const retired = deps.coordinator.retireForContinuation(previous.pendingThread.id);
          if (retired) await notify(retired, deps.tabs);
        }
        let record = deps.coordinator.create(message.pendingThread, continuedFromTarget ? previous!.sourceTabId : senderTabId, message.localThread);
        if (continuedFromTarget && sender.tab?.url) {
          record = deps.coordinator.markTargetOpened(message.pendingThread.id, senderTabId, sender.tab.url) ?? record;
        }
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
        const tab = await openOrActivateChat(deps.tabs, 'https://chatgpt.com/');
        if (tab.id === undefined) throw new Error('Target tab could not be created');
        const record = deps.coordinator.markTargetOpened(message.pendingThreadId, tab.id, resolvedTargetUrl(tab, 'https://chatgpt.com/'));
        if (!record) throw new Error('Pending thread could not be updated');
        await persist(record, deps);
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:open-or-auto-send-workspace': {
        const existing = await ensureSourceRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        if (!existing || existing.sourceTabId !== senderTabId || existing.localThread.answerMode !== 'workspace' ||
          !existing.pendingThread.promptHash || existing.pendingThread.promptHash !== message.promptHash ||
          existing.pendingThread.submittedPromptHash === message.promptHash) {
          throw new Error(existing?.pendingThread.submittedPromptHash === message.promptHash
            ? '该问题已经发送' : '当前共享追问线程无法发送');
        }
        if (activeWorkspaceAttempts.has(message.pendingThreadId)) throw new Error('该问题正在处理，请勿重复点击');
        activeWorkspaceAttempts.set(message.pendingThreadId, message.attemptId);
        try {
          const requestedUrl = existing.targetConversationUrl;
          const reusable = requestedUrl
            ? await findExistingChat(deps.tabs, requestedUrl, existing.targetTabId, senderTabId)
            : null;
          const tab = reusable ?? await deps.tabs.create({ url: requestedUrl ?? 'https://chatgpt.com/', active: true });
          if (tab.id === undefined) throw new Error('无法打开共享追问空间');
          if (reusable) await deps.tabs.update(tab.id, { active: true });
          const targetUrl = resolvedTargetUrl(tab, requestedUrl ?? 'https://chatgpt.com/');
          const routed = deps.coordinator.markTargetOpened(message.pendingThreadId, tab.id, targetUrl);
          if (!routed) throw new Error('共享追问空间绑定失败');
          await persist(routed, deps); await notify(routed, deps.tabs);
          if (!reusable) return { ok: true, data: { record: routed, autoSent: false } };

          try {
            await waitForReadyTarget(deps.tabs, tab.id, targetUrl);
            const response = await deps.tabs.sendMessage(tab.id, {
              type: 'pointask:execute-pending-send', record: routed, promptHash: message.promptHash, attemptId: message.attemptId,
            }) as { ok?: boolean; attemptId?: string; error?: string } | undefined;
            if (!response?.ok || response.attemptId !== message.attemptId) throw new Error(response?.error || '目标页面未确认发送');
            const submitted = deps.coordinator.get(message.pendingThreadId);
            if (!submitted || submitted.pendingThread.submittedPromptHash !== message.promptHash) throw new Error('发送状态未确认');
            await persist(submitted, deps);
            return { ok: true, data: { record: submitted, autoSent: true } };
          } catch (error) {
            const submitted = deps.coordinator.get(message.pendingThreadId);
            if (submitted?.pendingThread.submittedPromptHash === message.promptHash) {
              return { ok: true, data: { record: submitted, autoSent: true } };
            }
            const failed = deps.coordinator.markSendFailed(message.pendingThreadId);
            if (failed) { await persist(failed, deps); await notify(failed, deps.tabs); }
            throw error;
          }
        } finally {
          if (activeWorkspaceAttempts.get(message.pendingThreadId) === message.attemptId) {
            activeWorkspaceAttempts.delete(message.pendingThreadId);
          }
        }
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
        const record = deps.coordinator.markTargetOpened(message.pendingThreadId, tab.id, resolvedTargetUrl(tab, existing.targetConversationUrl));
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
          const pendingThread = await deps.pendingStore.get(message.pendingThreadId);
          const localThread = await deps.threadStore.get(pendingThread?.threadId || message.pendingThreadId);
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
      case 'pointask:attach-rounds': {
        let existing = deps.coordinator.get(message.pendingThreadId);
        if (!existing) existing = await ensureTargetRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        if (!existing) throw new Error('当前页面与该 PointAsk 线程的关联已失效，请重新关联');
        const record = deps.coordinator.attachRounds(message.pendingThreadId, senderTabId, message.rounds, message.targetUrl);
        if (!record) throw new Error('所选轮次无法附加到当前线程');
        try { await persist(record, deps); }
        catch (error) { deps.coordinator.restoreSnapshot(existing); throw error; }
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:stage-round-answer': {
        let existing = deps.coordinator.get(message.pendingThreadId);
        if (!existing) existing = await ensureTargetRecord(message.pendingThreadId, senderTabId, sender.tab?.url, deps);
        if (!existing) throw new Error('当前页面与该 PointAsk 线程的关联已失效，请重新关联');
        const record = deps.coordinator.stageRoundAnswer(message.pendingThreadId, senderTabId, message.roundId, message.promptHash,
          message.targetUrl, message.captureFailed, message.richContent, message.answerSource);
        if (!record) throw new Error('当前回答无法暂存，请确认轮次和 Workspace 页面后重试');
        try { await persist(record, deps); }
        catch (error) { deps.coordinator.restoreSnapshot(existing); throw error; }
        await notify(record, deps.tabs);
        return { ok: true, data: record };
      }
      case 'pointask:pending-thread-updated': {
        const existing = deps.coordinator.get(message.pendingThreadId);
        if (!existing) throw new Error('Pending thread not found');
        if (message.action === 'return-source') {
          if (existing.targetTabId !== senderTabId) throw new Error('Only the target tab may return to source');
          const sourceUrl = existing.localThread.sourceConversationKey || existing.pendingThread.sourcePageUrl;
          const threadId = existing.localThread.id;
          const roundId = [...threadRounds(existing.localThread, existing.pendingThread)].reverse().find((round) => round.status === 'attached')?.id;
          let sourceTab: { id?: number; url?: string } | null = null;
          if (existing.sourceTabId >= 0 && deps.tabs.get) {
            const remembered = await deps.tabs.get(existing.sourceTabId).catch(() => null);
            if (remembered?.url && isCompatibleChatGptTargetUrl(sourceUrl, remembered.url)) {
              sourceTab = { id: existing.sourceTabId, url: remembered.url };
            }
          }
          if (!deps.tabs.get && existing.sourceTabId >= 0) {
            sourceTab = { id: existing.sourceTabId, url: sourceUrl };
          }
          sourceTab ??= (await deps.tabs.query?.({ url: 'https://chatgpt.com/*' }))?.find((tab) =>
            tab.id !== undefined && tab.url && isCompatibleChatGptTargetUrl(sourceUrl, tab.url),
          ) ?? null;
          sourceTab ??= await deps.tabs.create({ url: sourceUrl, active: true });
          if (sourceTab.id === undefined) throw new Error('无法返回来源页面');
          await deps.threadReturnStore?.set({
            id: `pointask-thread-return-${Date.now()}`,
            threadId,
            roundId,
            sourceConversationUrl: sourceUrl,
            createdAt: new Date().toISOString(),
          });
          await deps.tabs.update(sourceTab.id, { active: true });
          deps.coordinator.restore(existing.pendingThread, existing.localThread, sourceTab.id);
          await waitForSourceThread(deps.tabs, sourceTab.id, threadId, roundId);
          const completed = deps.coordinator.completeReturn(message.pendingThreadId, senderTabId);
          if (completed) { await persist(completed, deps); await notify(completed, deps.tabs); }
          if (completed && settings?.closeDedicatedTabAfterAttach && existing.localThread.answerMode === 'dedicated_branch' &&
            existing.targetTabId !== undefined && existing.targetTabId !== sourceTab.id && deps.tabs.get && deps.tabs.remove) {
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
        const live = deps.coordinator.forPage(senderTabId).filter((record) => record.pendingThread.status !== 'answer_attached' ||
          threadRounds(record.localThread, record.pendingThread).some((round) => round.status === 'answer_ready' || round.status === 'generating'));
        if (live.length || !deps.threadStore || !deps.pendingStore) return { ok: true, data: live };
        const [threads, pendingThreads] = await Promise.all([deps.threadStore.list(), deps.pendingStore.list()]);
        const restored: PendingAssociation[] = [];
        for (const thread of threads.filter((item) => {
          if (['failed', 'orphaned'].includes(item.status)) return false;
          if (item.status === 'answer_attached' && !threadRounds(item).some((round) => round.status === 'answer_ready' || round.status === 'generating')) return false;
          return item.answerMode === 'current_conversation'
            ? isCompatibleChatGptTargetUrl(item.sourceConversationKey, message.currentUrl)
            : Boolean(item.targetConversationUrl && isCompatibleChatGptTargetUrl(item.targetConversationUrl, message.currentUrl));
        })) {
          const pending = pendingThreads.find((item) => (item.threadId || item.id) === thread.id);
          if (!pending) continue;
          deps.coordinator.restore(pending, thread, -1);
          const record = deps.coordinator.markTargetOpened(pending.id, senderTabId, message.currentUrl);
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
          const pending = pendingThreads.find((item) => (item.threadId || item.id) === thread.id);
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
      case 'pointask:get-pending-thread-return': {
        const navigation = await deps.threadReturnStore?.get();
        return { ok: true, data: navigation && isCompatibleChatGptTargetUrl(navigation.sourceConversationUrl, message.currentUrl)
          ? navigation : null };
      }
      case 'pointask:complete-navigation': {
        await Promise.all([
          deps.navigationStore?.clear(message.navigationId),
          deps.threadReturnStore?.clear(message.navigationId),
        ]);
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
      case 'pointask:release-prompt-submission': {
        const record = deps.coordinator.releaseSubmission(message.pendingThreadId, senderTabId, message.promptHash);
        if (!record) throw new Error('无法恢复本次发送状态');
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

chrome.tabs.onRemoved?.addListener((tabId) => { void handleTargetTabRemoved(tabId); });
