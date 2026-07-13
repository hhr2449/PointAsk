import { describe, expect, it } from 'vitest';
import { buildPrompt, buildWorkspaceContextUpdatePrompt } from '../src/bridge/prompt-builder';
import { selectWorkspaceContextMessages } from '../src/shared/workspace-context-selection';
import type { PointAskWorkspace, WorkspaceContextMessage } from '../src/shared/local-thread';
import { migrateStorage } from '../src/storage/migration';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { STORAGE_KEYS } from '../src/storage/storage-schema';
import { WorkspaceStore } from '../src/storage/workspace-store';

const now = '2026-07-13T00:00:00.000Z';
const messages: WorkspaceContextMessage[] = [
  { fingerprint: 'u1', role: 'user', content: '原问题' },
  { fingerprint: 'a1', role: 'assistant', content: '原回答' },
  { fingerprint: 'u2', role: 'user', content: '新增问题一' },
  { fingerprint: 'a2', role: 'assistant', content: '新增回答一' },
  { fingerprint: 'u3', role: 'user', content: '新增问题二' },
  { fingerprint: 'a3', role: 'assistant', content: '新增回答二' },
];
const workspace = (id = 'w'): PointAskWorkspace => ({
  id, sourceConversationKey: `https://chatgpt.com/c/${id}`, sourceConversationUrl: `https://chatgpt.com/c/${id}`,
  targetConversationUrl: `https://chatgpt.com/c/target-${id}`, workspaceType: 'new_conversation', threadCount: 1,
  approximateContentLength: 20, createdAt: now, updatedAt: now,
  contextState: { contextVersion: 2, lastSyncedMessageFingerprint: 'a1', syncedAt: now, unsyncedMessageCount: 0, unsyncedTurnCount: 0, status: 'fresh' },
});

describe('Workspace context snapshots', () => {
  it('only updates progress after new messages and never stores their content', async () => {
    const store = new WorkspaceStore(new MemoryStorageDriver()); await store.upsert(workspace());
    const updated = await store.updateContextProgress('w', messages);
    expect(updated?.contextState).toMatchObject({ status: 'outdated', unsyncedMessageCount: 4, unsyncedTurnCount: 2, contextVersion: 2 });
    expect(JSON.stringify(updated)).not.toContain('新增问题一');
  });

  it('allows an outdated Workspace prompt without unsynced messages', () => {
    const prompt = buildPrompt({ selectedText: '选区', paragraphText: '段落', userQuestion: '继续问', mode: 'compact',
      answerMode: 'workspace', displayId: 'PA-002', contextVersion: 2 });
    expect(prompt).toContain('CTX-002'); expect(prompt).not.toContain('新增问题');
  });

  it('builds a deterministic update and increments only after explicit confirmation', async () => {
    const driver = new MemoryStorageDriver(); const store = new WorkspaceStore(driver); const base = workspace();
    const update = { id: 'update-1', workspaceId: 'w', label: '最近 2 轮', prompt: buildWorkspaceContextUpdatePrompt(2, messages.slice(-4)),
      messageFingerprints: messages.slice(-4).map((item) => item.fingerprint), lastMessageFingerprint: 'a3', status: 'filled' as const, createdAt: now, updatedAt: now };
    await store.upsert({ ...base, pendingContextUpdate: update });
    expect((await store.get('w'))?.contextState.contextVersion).toBe(2);
    expect(update.prompt).toContain('CTX-003'); expect(update.prompt).toContain('不要单独回答这段更新');
    await store.confirmContextUpdate('w', 'wrong-update'); expect((await store.get('w'))?.contextState.contextVersion).toBe(2);
    const confirmed = await store.confirmContextUpdate('w', 'update-1');
    expect(confirmed?.contextState).toMatchObject({ contextVersion: 3, status: 'fresh', lastSyncedMessageFingerprint: 'a3' });
    expect(confirmed?.pendingContextUpdate).toBeUndefined();
  });

  it('supports all three explicit update ranges', () => {
    expect(selectWorkspaceContextMessages('since_snapshot', messages, 1, new Set())).toHaveLength(4);
    expect(selectWorkspaceContextMessages('recent_two_turns', messages, 1, new Set())).toHaveLength(4);
    expect(selectWorkspaceContextMessages('manual', messages, 1, new Set(['u2'])).map((item) => item.fingerprint)).toEqual(['u2']);
  });

  it('marks edited conversations unknown rather than guessing', async () => {
    const store = new WorkspaceStore(new MemoryStorageDriver()); await store.upsert(workspace());
    const updated = await store.updateContextProgress('w', messages.filter((message) => message.fingerprint !== 'a1'));
    expect(updated?.contextState.status).toBe('unknown');
  });

  it('keeps Workspace updates isolated and restores them after a new store instance', async () => {
    const driver = new MemoryStorageDriver(); const store = new WorkspaceStore(driver);
    await store.upsert(workspace('one')); await store.upsert({ ...workspace('two'), contextState: { ...workspace('two').contextState, lastSyncedMessageFingerprint: 'a3' } });
    await store.updateContextProgress('one', messages);
    const restored = new WorkspaceStore(driver);
    expect((await restored.get('one'))?.contextState.status).toBe('outdated');
    expect((await restored.get('two'))?.contextState.status).toBe('fresh');
  });

  it('migrates old Workspaces idempotently to CTX-001 unknown', () => {
    const old = { ...workspace() } as Record<string, unknown>; delete old.contextState;
    const first = migrateStorage({ [STORAGE_KEYS.workspaces]: [old] });
    const second = migrateStorage({ [STORAGE_KEYS.workspaces]: first.workspaces, [STORAGE_KEYS.schemaVersion]: first.version });
    expect(first.workspaces[0]?.contextState).toMatchObject({ contextVersion: 1, status: 'unknown' });
    expect(second.workspaces).toEqual(first.workspaces);
  });
});
