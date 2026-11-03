import 'server-only';
import { football, pool } from './db';
import { MatchService } from './game/service';
import { PostgresMatchJournal } from './matchJournal';
const globalGame = globalThis as unknown as { golviaMatches?: MatchService };
export const matches = globalGame.golviaMatches ??= new MatchService(() => football.catalog(), undefined, new PostgresMatchJournal(pool, 'practice'));
