import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationAuthorizer } from '../src/content/operation-authorizer';
import { SettingsStore } from '../src/storage/settings-store';
import { MemoryStorageDriver } from '../src/storage/storage-driver';
import { DEFAULT_SETTINGS, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from '../src/storage/storage-schema';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function setup(authorized = false) {
  const driver = new MemoryStorageDriver();
  await driver.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, autoActionAuthorized: authorized }, [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION });
  return { driver, store: new SettingsStore(driver) };
}

function authorizationButton(label: string): HTMLButtonElement {
  const host = document.querySelector('pointask-operation-authorization');
  return [...(host?.shadowRoot?.querySelectorAll('button') ?? [])].find((button) => button.textContent === label) as HTMLButtonElement;
}

describe('remembered operation authorization', () => {
  beforeEach(() => document.querySelectorAll('pointask-operation-authorization').forEach((item) => item.remove()));
  it('shows the first authorization and persists “允许并记住” across a new authorizer', async () => {
    const { store } = await setup(); const first = new OperationAuthorizer(store);
    const result = first.authorize();
    await vi.waitFor(() => expect(document.querySelector('pointask-operation-authorization')).not.toBeNull());
    await act(() => authorizationButton('允许并记住').click());
    await expect(result).resolves.toBe(true);
    expect((await store.get()).autoActionAuthorized).toBe(true);
    const restored = new OperationAuthorizer(store);
    await expect(restored.authorize()).resolves.toBe(true);
    expect(document.querySelector('pointask-operation-authorization')).toBeNull();
  });

  it('allows only the current operation without persisting “仅本次”', async () => {
    const { store } = await setup(); const authorizer = new OperationAuthorizer(store);
    const once = authorizer.authorize(); await vi.waitFor(() => expect(authorizationButton('仅本次')).toBeTruthy()); await act(() => authorizationButton('仅本次').click());
    await expect(once).resolves.toBe(true); expect((await store.get()).autoActionAuthorized).toBe(false);
    const again = authorizer.authorize(); await vi.waitFor(() => expect(document.querySelector('pointask-operation-authorization')).not.toBeNull());
    await act(() => authorizationButton('取消').click()); await expect(again).resolves.toBe(false);
  });

  it('cancels without granting permission and supports revocation', async () => {
    const initial = await setup(); const cancelled = new OperationAuthorizer(initial.store).authorize();
    await vi.waitFor(() => expect(authorizationButton('取消')).toBeTruthy());
    await act(() => authorizationButton('取消').click()); await expect(cancelled).resolves.toBe(false);
    expect((await initial.store.get()).autoActionAuthorized).toBe(false);
    const remembered = await setup(true); await remembered.store.set({ ...(await remembered.store.get()), autoActionAuthorized: false });
    expect((await remembered.store.get()).autoActionAuthorized).toBe(false);
  });
});
