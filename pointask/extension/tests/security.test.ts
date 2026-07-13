import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';
import { isChatGptUrl, isPointAskRuntimeMessage } from '../src/bridge/runtime-messages';
import { MetricsStore } from '../src/storage/metrics-store';
import { MemoryStorageDriver } from '../src/storage/storage-driver';

describe('release security boundaries', () => {
  it('uses minimal manifest permissions and a ChatGPT-only content scope', () => {
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.host_permissions).toEqual(['https://chatgpt.com/*']);
    expect(manifest.content_scripts.flatMap((script) => script.matches)).toEqual(['https://chatgpt.com/*']);
    expect(JSON.stringify(manifest)).not.toMatch(/cookies/i);
  });

  it('allows only visible HTTPS ChatGPT URLs', () => {
    expect(isChatGptUrl('https://chatgpt.com/')).toBe(true);
    expect(isChatGptUrl('https://chatgpt.com/c/safe')).toBe(true);
    expect(isChatGptUrl('http://chatgpt.com/')).toBe(false);
    expect(isChatGptUrl('javascript:alert(1)')).toBe(false);
    expect(isChatGptUrl('file:///tmp/data')).toBe(false);
    expect(isChatGptUrl('https://chatgpt.com.example.com/')).toBe(false);
  });

  it('rejects malformed runtime messages and unknown fields', () => {
    expect(isPointAskRuntimeMessage({ type: 'pointask:open-target-chat', pendingThreadId: 'id', url: 'javascript:x' })).toBe(false);
    expect(isPointAskRuntimeMessage({ type: 'pointask:get-page-pending-threads', currentUrl: 'file:///x' })).toBe(false);
    expect(isPointAskRuntimeMessage({ type: 'pointask:get-source-threads', conversationKey: 'https://example.com/' })).toBe(false);
    expect(isPointAskRuntimeMessage({ type: 'pointask:attach-answer', pendingThreadId: 'id', targetUrl: 'https://chatgpt.com/c/a', replace: false,
      richContent: [{ type: 'inline_math', latex: 'x^2', unsafe: true }] })).toBe(false);
  });

  it('exports counters without conversation content or identifiers', async () => {
    const metrics = new MetricsStore(new MemoryStorageDriver());
    await metrics.increment('questionsCreated');
    const exported = await metrics.exportFeedback();
    expect(JSON.parse(exported)).toMatchObject({ version: '0.1.0', metrics: { questionsCreated: 1 } });
    expect(exported).not.toMatch(/selectedText|generatedPrompt|messageFingerprint|sourceUrl|targetUrl|chatgpt\.com\/c\//i);
  });
});
