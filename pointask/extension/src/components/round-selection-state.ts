import type { SelectableRound } from './round-selection-view';

export function isSelectableRound(round: SelectableRound): boolean {
  return !round.attached && (round.stageable === true || round.reliable && (round.persistenceStatus ?? 'staged') === 'staged');
}

export function defaultSelectedRoundIds(rounds: SelectableRound[]): Set<string> {
  return new Set(rounds.filter(isSelectableRound).map((round) => round.id));
}

export function validSelectedRoundIds(rounds: SelectableRound[], selected: ReadonlySet<string>): Set<string> {
  const attachable = new Set(rounds.filter(isSelectableRound).map((round) => round.id));
  return new Set([...selected].filter((id) => attachable.has(id)));
}
