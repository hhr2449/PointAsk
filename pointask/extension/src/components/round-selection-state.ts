import type { SelectableRound } from './round-selection-view';

export function defaultSelectedRoundIds(rounds: SelectableRound[]): Set<string> {
  const latest = [...rounds].reverse().find((round) => !round.attached);
  return new Set(latest ? [latest.id] : []);
}

