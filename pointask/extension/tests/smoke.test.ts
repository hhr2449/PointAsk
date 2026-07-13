import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('extension manifest', () => {
  it('is a ChatGPT-only Manifest V3 extension', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts[0]?.matches).toEqual(['https://chatgpt.com/*']);
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.version).toBe('0.1.0');
  });
});
