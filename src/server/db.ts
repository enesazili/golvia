import 'server-only';
import { Pool } from 'pg';
import { FootballRepository } from './football/repository';
import { CompetitiveRepository } from './competitive/repository';
const globalDb = globalThis as unknown as { golviaPool?: Pool };
export const pool = globalDb.golviaPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
export const football = new FootballRepository(pool);
export const competitive = new CompetitiveRepository(pool);
