export const GAME_MODE = '3-2-1';
export type MatchKind = 'casual' | 'friendly' | 'ranked';

export function elo(player: number, opponent: number, actual: 0 | 0.5 | 1): number {
  if (![player, opponent].every(value => Number.isSafeInteger(value) && value >= 0) || ![0, 0.5, 1].includes(actual)) throw new Error('Invalid ELO input');
  return Math.max(0, Math.round(player + 32 * (actual - 1 / (1 + 10 ** ((opponent - player) / 400)))));
}
const LEAGUES = [
  { name: 'Bronz', minimum: 0, color: '#cb9167', symbol: 0 },
  { name: 'Gümüş', minimum: 900, color: '#b9cadb', symbol: 1 },
  { name: 'Altın', minimum: 1100, color: '#f1ca68', symbol: 2 },
  { name: 'Platin', minimum: 1300, color: '#79d8c3', symbol: 3 },
  { name: 'Elmas', minimum: 1500, color: '#80bbff', symbol: 4 },
  { name: 'Usta', minimum: 1800, color: '#cda2ff', symbol: 5 },
] as const;
export function rankProgress(elo: number) {
  if (!Number.isSafeInteger(elo) || elo < 0) throw new Error('Invalid ELO');
  const index = LEAGUES.findLastIndex(item => elo >= item.minimum);
  const current = LEAGUES[index], next = LEAGUES[index + 1];
  return { ...current, next: next?.name ?? null, remaining: next ? next.minimum - elo : 0,
    progress: next ? Math.floor((elo - current.minimum) / (next.minimum - current.minimum) * 100) : 100 };
}
export function league(rating: number): string { return rankProgress(rating).name; }
export type RankProgress = ReturnType<typeof rankProgress>;
export type Rating = { mode: string; elo: number; wins: number; losses: number; draws: number; played: number; winRate: number; league: string; rank: RankProgress };
export type RankedResult = { matchId: string; status: 'completed' | 'cancelled'; reason: string; winner?: 0 | 1 | null; before?: [number, number]; after?: [number, number] };
