export const GAME_MODE = '3-2-1';
export type MatchKind = 'casual' | 'friendly' | 'ranked';

export function elo(player: number, opponent: number, actual: 0 | 0.5 | 1): number {
  if (![player, opponent].every(value => Number.isSafeInteger(value) && value >= 0) || ![0, 0.5, 1].includes(actual)) throw new Error('Invalid ELO input');
  return Math.max(0, Math.round(player + 32 * (actual - 1 / (1 + 10 ** ((opponent - player) / 400)))));
}
export function league(rating: number): string {
  return rating < 900 ? 'Bronz' : rating < 1100 ? 'Gümüş' : rating < 1300 ? 'Altın' : rating < 1500 ? 'Platin' : rating < 1800 ? 'Elmas' : 'Usta';
}
export type Rating = { mode: string; elo: number; wins: number; losses: number; draws: number; played: number; winRate: number; league: string };
export type RankedResult = { matchId: string; status: 'completed' | 'cancelled'; reason: string; winner?: 0 | 1 | null; before?: [number, number]; after?: [number, number] };
