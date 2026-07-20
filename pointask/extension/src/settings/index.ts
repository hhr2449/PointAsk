import { MetricsStore } from '../storage/metrics-store';
import { SettingsStore, clearAllPointAskData } from '../storage/settings-store';
import { ChromeStorageDriver } from '../storage/storage-driver';
import { runStorageMigration } from '../storage/migration';

const driver = new ChromeStorageDriver();
const migrationReady = runStorageMigration(driver);
const settingsStore = new SettingsStore(driver);
const metricsStore = new MetricsStore(driver);
const mode = document.querySelector<HTMLSelectElement>('#pointask-prompt-mode')!;
const expand = document.querySelector<HTMLInputElement>('#pointask-expand')!;
const expiry = document.querySelector<HTMLInputElement>('#pointask-expiry')!;
const scrollBehavior = document.querySelector<HTMLSelectElement>('#pointask-scroll-behavior')!;
const closeDedicated = document.querySelector<HTMLInputElement>('#pointask-close-dedicated')!;
const authorizationState = document.querySelector<HTMLElement>('#pointask-authorization-state')!;
const status = document.querySelector<HTMLElement>('#pointask-status')!;

void migrationReady.then(() => settingsStore.get()).then((settings) => {
  mode.value = settings.defaultPromptMode;
  expand.checked = settings.expandNewThreads;
  expiry.value = String(settings.pendingExpiryHours);
  scrollBehavior.value = settings.currentConversationScrollBehavior;
  closeDedicated.checked = settings.closeDedicatedTabAfterAttach;
  authorizationState.textContent = settings.autoActionAuthorized ? '已开启' : '未开启';
});

document.querySelector('#pointask-save')?.addEventListener('click', () => {
  void settingsStore.set({
    defaultPromptMode: mode.value === 'contextual' ? 'contextual' : 'compact',
    expandNewThreads: expand.checked,
    pendingExpiryHours: Number(expiry.value),
    currentConversationScrollBehavior: scrollBehavior.value === 'follow_response' ? 'follow_response' : 'stay_at_source',
    closeDedicatedTabAfterAttach: closeDedicated.checked,
    autoActionAuthorized: authorizationState.textContent === '已开启',
  }).then(() => { status.textContent = '设置已保存。'; });
});
document.querySelector('#pointask-revoke-authorization')?.addEventListener('click', () => {
  void settingsStore.get().then((settings) => settingsStore.set({ ...settings, autoActionAuthorized: false })).then(() => {
    authorizationState.textContent = '未开启'; status.textContent = '已撤销自动操作授权，将恢复每次确认。';
  });
});
document.querySelector('#pointask-clear')?.addEventListener('click', () => {
  if (!confirm('确认清除全部 PointAsk 本地数据（包括暂存回答）？此操作不会影响其他扩展数据。')) return;
  void clearAllPointAskData(driver).then(() => { status.textContent = 'PointAsk 数据已清除。'; });
});
document.querySelector('#pointask-export')?.addEventListener('click', () => {
  void metricsStore.exportFeedback().then((json) => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pointask-feedback-0.1.0.json';
    link.click();
    URL.revokeObjectURL(url);
  });
});
