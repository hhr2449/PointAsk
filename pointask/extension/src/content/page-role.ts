import type { PendingAssociation } from '../bridge/runtime-messages';
import type { PointAskWorkspace } from '../shared/local-thread';
import { isSameChatGptConversationUrl } from '../bridge/runtime-messages';

export type PointAskPageRole = 'source_page' | 'workspace_target' | 'dedicated_target' | 'current_conversation_target' | 'unrelated';

/** Exact stable conversation identity. A saved root/new-chat URL never aliases an existing /c/... conversation. */
export function isSameConversationUrl(left: string | undefined, right: string): boolean {
  return Boolean(left && isSameChatGptConversationUrl(left, right));
}

export function derivePointAskPageRole(currentUrl: string, workspaces: PointAskWorkspace[], records: PendingAssociation[]): PointAskPageRole {
  const currentConversationTargets = records.filter((record) => record.localThread.answerMode === 'current_conversation');
  if (currentConversationTargets.some((record) =>
    isSameConversationUrl(record.localThread.sourceConversationKey, currentUrl) ||
    isSameConversationUrl(record.targetConversationUrl, currentUrl) ||
    isSameConversationUrl(record.localThread.targetConversationUrl, currentUrl))) {
    return 'current_conversation_target';
  }

  const sourceMatches = workspaces.some((workspace) => isSameConversationUrl(workspace.sourceConversationUrl, currentUrl) ||
    isSameConversationUrl(workspace.sourceConversationKey, currentUrl)) || records.some((record) =>
    isSameConversationUrl(record.localThread.sourceConversationKey, currentUrl));
  const workspaceTarget = workspaces.some((workspace) => !isSameConversationUrl(workspace.sourceConversationUrl, currentUrl) &&
    isSameConversationUrl(workspace.targetConversationUrl, currentUrl)) || records.some((record) =>
    record.localThread.answerMode === 'workspace' && !isSameConversationUrl(record.localThread.sourceConversationKey, currentUrl) &&
    (isSameConversationUrl(record.targetConversationUrl, currentUrl) ||
      isSameConversationUrl(record.localThread.targetConversationUrl, currentUrl)));
  if (workspaceTarget) return 'workspace_target';
  if (sourceMatches) return 'source_page';
  if (records.some((record) => record.localThread.answerMode === 'dedicated_branch' &&
    (isSameConversationUrl(record.targetConversationUrl, currentUrl) ||
      isSameConversationUrl(record.localThread.dedicatedConversationUrl, currentUrl)))) return 'dedicated_target';
  return 'unrelated';
}
