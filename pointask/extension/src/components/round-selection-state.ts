import type { SelectableRound } from './round-selection-view';

export function defaultSelectedRoundIds(rounds: SelectableRound[]): Set<string> {
  return new Set(rounds.filter((round) => !round.attached && round.reliable && (round.persistenceStatus ?? 'staged') === 'staged').map((round) => round.id));
}

export function validSelectedRoundIds(rounds: SelectableRound[], selected: ReadonlySet<string>): Set<string> {
  const attachable = new Set(rounds.filter((round) => !round.attached && round.reliable && (round.persistenceStatus ?? 'staged') === 'staged').map((round) => round.id));
  return new Set([...selected].filter((id) => attachable.has(id)));
}
