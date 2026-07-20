import type { AnswerSourceLocator, RichSelection, TextAnchor, WorkspaceContextMessage } from '../shared/local-thread';
import type { AnchorResolution } from './anchor-resolver';

export interface CandidateAnswer {
  element: HTMLElement;
  fingerprint: string;
  streaming: boolean;
}

export interface SiteAdapter {
  isSupportedPage(): boolean;
  findAssistantMessage(node: Node): HTMLElement | null;
  isAssistantMessage(element: HTMLElement): boolean;
  getMessageContent(element: HTMLElement): HTMLElement | null;
  getMessageText(element: HTMLElement): string;
  getMessageFingerprint(element: HTMLElement): string;
  getParagraphText(range: Range): string;
  normalizeSelectionRange(range: Range): Range;
  getRichSelection(range: Range): RichSelection;
  getMessageRichContent(element: HTMLElement): RichSelection;
  getAssistantMessageFingerprints(): string[];
  getConversationContextMessages(): WorkspaceContextMessage[];
  findAssistantMessageByFingerprint(fingerprint: string): HTMLElement | null;
  isMessageStreaming(element: HTMLElement): boolean;
  fillComposer(prompt: string): boolean;
  canSubmitComposer(): boolean;
  isComposerReady(): boolean;
  waitForComposerReady(timeoutMs?: number): Promise<boolean>;
  waitForSubmitReady(timeoutMs?: number): Promise<boolean>;
  submitComposer(): boolean;
  hasSubmittedPrompt(promptHash: string): boolean;
  findCandidateAnswer(promptHash: string, assistantFingerprintsBefore: string[]): CandidateAnswer | null;
  resolveAnswerSource(locator: AnswerSourceLocator): HTMLElement | null;
  getRecoveryMountElement(): HTMLElement | null;
  getScrollContainer(element: HTMLElement): HTMLElement | Window;
  getAnchorElement(range: Range): HTMLElement | null;
  resolveTextAnchor(anchor: TextAnchor, pageReady?: boolean): AnchorResolution;
  getConversationKey(): string;
  observePageChanges(callback: () => void): () => void;
}
