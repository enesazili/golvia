import 'server-only';
import { football } from './db';
import { MatchService } from './game/service';
const globalGame = globalThis as unknown as { golviaMatches?: MatchService };
export const matches = globalGame.golviaMatches ??= new MatchService(() => football.catalog());
