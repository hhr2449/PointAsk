import type { TextAnchor } from '../shared/local-thread';
import { normalizeWhitespace, stableTextHash } from '../shared/text-utils';

export type AnchorResolutionStatus = 'resolved' | 'pending' | 'ambiguous' | 'orphaned';
export interface AnchorBlockCandidate { element: HTMLElement; text: string; blockIndex: number; }
export interface AnchorMessageCandidate {
  messageFingerprint: string;
  assistantMessageHash: string;
  blocks: AnchorBlockCandidate[];
}
export interface AnchorResolution { status: AnchorResolutionStatus; element: HTMLElement | null; confidence: number; }

export class AnchorResolver {
  resolve(anchor: TextAnchor, messages: AnchorMessageCandidate[], pageReady = true): AnchorResolution {
    if (!messages.length) return { status: pageReady ? 'orphaned' : 'pending', element: null, confidence: 0 };
    let messageMatches = messages.filter((message) =>
      message.messageFingerprint === anchor.messageFingerprint ||
      (anchor.assistantMessageHash && message.assistantMessageHash === anchor.assistantMessageHash),
    );
    if (!messageMatches.length && anchor.paragraphHash) {
      messageMatches = messages.filter((message) => message.blocks.some((block) =>
        stableTextHash(block.text) === anchor.paragraphHash,
      ));
    }
    if (!messageMatches.length) return { status: pageReady ? 'orphaned' : 'pending', element: null, confidence: 0 };

    const selected = normalizeWhitespace(anchor.selectedText);
    const paragraph = normalizeWhitespace(anchor.paragraphText);
    const scored: Array<{ candidate: AnchorBlockCandidate; score: number }> = [];
    for (const message of messageMatches) for (const block of message.blocks) {
      const text = normalizeWhitespace(block.text);
      const selectedMatches = text.includes(selected) || text.replace(/\s+/g, '').includes(selected.replace(/\s+/g, ''));
      if (!selected || !selectedMatches) continue;
      let score = 40;
      if (text === paragraph) score += 30;
      if (anchor.paragraphHash && stableTextHash(text) === anchor.paragraphHash) score += 20;
      const selectedIndex = text.indexOf(selected);
      if (selectedIndex >= 0 && anchor.prefixText && text.slice(0, selectedIndex).endsWith(normalizeWhitespace(anchor.prefixText))) score += 15;
      if (selectedIndex >= 0 && anchor.suffixText && text.slice(selectedIndex + selected.length).startsWith(normalizeWhitespace(anchor.suffixText))) score += 15;
      if (anchor.blockIndex === block.blockIndex) score += 3;
      scored.push({ candidate: block, score });
    }
    if (!scored.length) return { status: pageReady ? 'orphaned' : 'pending', element: null, confidence: 0 };
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    const tied = scored.filter((item) => item.score === best.score);
    if (tied.length !== 1 || best.score < 55) return { status: 'ambiguous', element: null, confidence: best.score };
    return { status: 'resolved', element: best.candidate.element, confidence: best.score };
  }
}
