import type { WorkspaceContextMessage } from './local-thread';

export type WorkspaceUpdateRange = 'since_snapshot' | 'recent_two_turns' | 'manual';

export function selectWorkspaceContextMessages(range: WorkspaceUpdateRange, messages: WorkspaceContextMessage[], markerIndex: number, selected: Set<string>): WorkspaceContextMessage[] {
  if (range === 'since_snapshot') return markerIndex >= 0 ? messages.slice(markerIndex + 1) : [];
  if (range === 'recent_two_turns') {
    const userIndexes = messages.map((message, index) => message.role === 'user' ? index : -1).filter((index) => index >= 0);
    return messages.slice(userIndexes.at(-2) ?? Math.max(0, messages.length - 4));
  }
  return messages.filter((message) => selected.has(message.fingerprint));
}
