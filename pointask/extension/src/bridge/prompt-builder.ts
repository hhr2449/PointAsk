import type { LocalMessage, WorkspaceContextMessage } from '../shared/local-thread';
import type { AnswerMode } from '../shared/local-thread';
import { richPlainText } from '../shared/rich-content';

export type PromptMode = 'compact' | 'contextual';

export interface PromptBuildInput {
  selectedText: string;
  paragraphText: string;
  assistantMessageText?: string;
  userQuestion: string;
  previousLocalMessages?: LocalMessage[];
  mode: PromptMode;
  answerMode?: AnswerMode;
  displayId?: string;
  contextVersion?: number;
}

const PROMPT_SIGNATURE = '我正在阅读一段 AI 回答，想针对其中一个局部内容继续追问。';
const WORKSPACE_PROMPT_SIGNATURE = '[PointAsk 局部线程：';
const LIMITS = {
  selectedText: 2_000,
  paragraphText: 4_000,
  assistantMessageText: 12_000,
  historyMessage: 2_000,
  historyTotal: 6_000,
} as const;

function clean(value?: string): string {
  return value?.trim() ?? '';
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 7)).trimEnd()}…（已截断）`;
}

function historyText(messages: LocalMessage[] = []): string {
  let remaining = LIMITS.historyTotal;
  const entries: string[] = [];
  for (const message of [...messages].reverse()) {
    const content = clean(richPlainText(message.content));
    if (!content || content.includes(PROMPT_SIGNATURE) || content.includes(WORKSPACE_PROMPT_SIGNATURE) || remaining <= 0) continue;
    const label = message.role === 'user' ? '用户' : '局部回答';
    const entry = `${label}：${truncate(content, Math.min(LIMITS.historyMessage, remaining))}`;
    entries.unshift(entry);
    remaining -= entry.length;
  }
  return entries.join('\n');
}

function section(label: string, value: string): string | null {
  return value ? `${label}：\n${value}` : null;
}

export function buildPrompt(input: PromptBuildInput): string {
  const rawSelectedText = clean(input.selectedText);
  const rawParagraphText = clean(input.paragraphText);
  const selectedText = truncate(rawSelectedText, LIMITS.selectedText);
  const paragraphText = truncate(rawParagraphText, LIMITS.paragraphText);
  const assistantMessageText = input.mode === 'contextual'
    ? truncate(clean(input.assistantMessageText), LIMITS.assistantMessageText)
    : '';
  const previous = historyText(input.previousLocalMessages);
  const userQuestion = clean(input.userQuestion);
  const displayId = clean(input.displayId);
  if (input.answerMode === 'workspace' && displayId) {
    return [
      `[PointAsk 局部线程：${displayId}]`,
      `[共享追问空间上下文版本：CTX-${String(input.contextVersion ?? 1).padStart(3, '0')}]`,
      previous
        ? `这是 ${displayId} 的继续追问。只延续本线程的必要内容。`
        : '这是一个新的独立局部线程。\n除非我明确引用其他 PointAsk 线程，否则不要延续其他线程的话题。',
      section('选中的内容', rawSelectedText ? `“${rawSelectedText}”` : ''),
      section('所在段落', rawParagraphText),
      section('以下是这个局部线程此前的必要内容', previous),
      section('我的问题', userQuestion),
      `请只回答 ${displayId} 当前的局部问题，不要继续其他线程。`,
    ].filter((part): part is string => Boolean(part)).join('\n\n');
  }
  if (input.answerMode === 'current_conversation') {
    return [
      displayId ? `[PointAsk：${displayId}]` : null,
      section('针对这段内容', selectedText ? `“${selectedText}”` : ''),
      section('我的局部问题', userQuestion),
      '请简洁回答这个局部问题。',
    ].filter((part): part is string => Boolean(part)).join('\n\n');
  }

  return [
    PROMPT_SIGNATURE,
    section('选中的内容', selectedText ? `“${selectedText}”` : ''),
    section('选中内容所在段落', paragraphText),
    section('当前 AI 回答的相关上下文', assistantMessageText),
    section('以下是这个局部线程此前的必要内容', previous),
    section('我的问题', userQuestion),
    '请只回答这个局部问题，不要重新回答整个原始问题。\n必要时结合所在段落说明，但不要扩展到无关主题。',
  ].filter((part): part is string => Boolean(part)).join('\n\n');
}

export function buildWorkspaceContextUpdatePrompt(
  contextVersion: number,
  messages: WorkspaceContextMessage[],
): string {
  const body = messages.map((message) => `${message.role === 'user' ? '用户' : 'AI'}：\n${truncate(clean(message.content), 4_000)}`)
    .filter(Boolean).join('\n\n');
  return [
    `[PointAsk 主对话上下文更新：CTX-${String(contextVersion + 1).padStart(3, '0')}]`,
    '以下内容来自原始主对话，由用户主动选择用于更新共享追问空间：',
    body,
    '请将以上内容作为后续局部追问的补充上下文，\n不要单独回答这段更新。',
  ].filter(Boolean).join('\n\n');
}
