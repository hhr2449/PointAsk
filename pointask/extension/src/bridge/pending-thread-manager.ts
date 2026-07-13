import type { PromptMode } from './prompt-builder';
import type { RichSelection, TextAnchor, ViewAnchor } from '../shared/local-thread';
import type { AnswerMode } from '../shared/local-thread';
import { stableTextHash } from '../shared/text-utils';

export interface PendingThread {
  id: string;
  sourcePageUrl: string;
  sourceConversationKey: string;
  sourceMessageFingerprint: string;
  anchor: TextAnchor;
  question: string;
  generatedPrompt: string;
  promptMode: PromptMode;
  status: 'prompt_ready' | 'waiting_for_submission' | 'generating' | 'answer_ready' | 'waiting_for_answer' | 'answer_attached' | 'failed';
  createdAt: string;
  updatedAt: string;
  targetConversationUrl?: string;
  displayId: string;
  answerMode: AnswerMode;
  workspaceId?: string;
  threadId?: string;
  targetTabId?: number;
  targetConversationKey?: string;
  promptHash?: string;
  assistantFingerprintsBefore?: string[];
  candidateAnswerFingerprint?: string;
  richSelection?: RichSelection;
  viewAnchor?: ViewAnchor;
  submittedPromptHash?: string;
  submittedAt?: string;
}

export interface CreatePendingThreadInput {
  anchor: TextAnchor;
  question: string;
  generatedPrompt: string;
  promptMode: PromptMode;
  displayId?: string;
  answerMode?: AnswerMode;
  workspaceId?: string;
  richSelection?: RichSelection;
  viewAnchor?: ViewAnchor;
  promptHash?: string;
  assistantFingerprintsBefore?: string[];
}

let nextPendingId = 1;

export class PendingThreadManager {
  private readonly threads = new Map<string, PendingThread>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => `pointask-pending-${nextPendingId++}`,
  ) {}

  create(input: CreatePendingThreadInput): PendingThread | null {
    const question = input.question.trim();
    const generatedPrompt = input.generatedPrompt.trim();
    if (!question || !generatedPrompt) return null;
    const timestamp = this.now().toISOString();
    const thread: PendingThread = {
      id: this.createId(),
      sourcePageUrl: input.anchor.sourcePageUrl,
      sourceConversationKey: input.anchor.conversationKey,
      sourceMessageFingerprint: input.anchor.messageFingerprint,
      anchor: input.anchor,
      question,
      generatedPrompt,
      promptMode: input.promptMode,
      status: 'prompt_ready',
      createdAt: timestamp,
      updatedAt: timestamp,
      displayId: input.displayId ?? 'PA-001',
      answerMode: input.answerMode ?? 'dedicated_branch',
      workspaceId: input.workspaceId,
      threadId: '',
      promptHash: input.promptHash ?? stableTextHash(generatedPrompt),
      assistantFingerprintsBefore: input.assistantFingerprintsBefore ?? [],
      richSelection: input.richSelection,
      viewAnchor: input.viewAnchor,
    };
    thread.threadId = thread.id;
    this.threads.set(thread.id, thread);
    return thread;
  }

  markWaitingForAnswer(id: string): PendingThread | null {
    const thread = this.threads.get(id);
    if (!thread) return null;
    const updated = { ...thread, status: 'waiting_for_answer' as const, updatedAt: this.now().toISOString() };
    this.threads.set(id, updated);
    return updated;
  }
  markWaitingForSubmission(id: string): PendingThread | null {
    const thread = this.threads.get(id); if (!thread) return null;
    const updated = { ...thread, status: 'waiting_for_submission' as const, updatedAt: this.now().toISOString() };
    this.threads.set(id, updated); return updated;
  }
  markFailed(id: string): PendingThread | null {
    const thread = this.threads.get(id); if (!thread) return null;
    const updated = { ...thread, status: 'failed' as const, updatedAt: this.now().toISOString() };
    this.threads.set(id, updated); return updated;
  }

  prepareNext(id: string, question: string, generatedPrompt: string, promptMode: PromptMode, assistantFingerprintsBefore?: string[]): PendingThread | null {
    const thread = this.threads.get(id);
    if (!thread || !question.trim() || !generatedPrompt.trim()) return null;
    const updated: PendingThread = {
      ...thread,
      question: question.trim(),
      generatedPrompt: generatedPrompt.trim(),
      promptHash: stableTextHash(generatedPrompt),
      candidateAnswerFingerprint: undefined,
      submittedPromptHash: undefined,
      submittedAt: undefined,
      assistantFingerprintsBefore: assistantFingerprintsBefore ?? thread.assistantFingerprintsBefore,
      promptMode,
      status: 'prompt_ready',
      updatedAt: this.now().toISOString(),
    };
    this.threads.set(id, updated);
    return updated;
  }

  get(id: string): PendingThread | null {
    return this.threads.get(id) ?? null;
  }

  delete(id: string): boolean {
    return this.threads.delete(id);
  }

  list(): PendingThread[] {
    return [...this.threads.values()];
  }

  restore(thread: PendingThread): void {
    this.threads.set(thread.id, thread);
  }

  updateQuestion(id: string, question: string): PendingThread | null {
    const thread = this.threads.get(id);
    if (!thread || !question.trim()) return null;
    const updated = { ...thread, question: question.trim(), updatedAt: this.now().toISOString() };
    this.threads.set(id, updated);
    return updated;
  }
  updateRouting(id: string, answerMode: AnswerMode, workspaceId?: string, targetConversationUrl?: string): PendingThread | null {
    const thread = this.threads.get(id); if (!thread) return null;
    const updated = { ...thread, answerMode, workspaceId, targetConversationUrl, updatedAt: this.now().toISOString() };
    this.threads.set(id, updated); return updated;
  }
}
