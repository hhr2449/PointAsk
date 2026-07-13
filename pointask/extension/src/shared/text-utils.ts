export function normalizeWhitespace(text: string): string { return text.replace(/\s+/g, ' ').trim(); }
export function stableTextHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(normalizeWhitespace(text))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
