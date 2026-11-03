import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type MatchMode = 'practice' | 'versus';

/**
 * Durable match lifecycle journal. It deliberately stores lifecycle and ownership metadata only:
 * the authoritative game state (round, score, deadlines, hidden choices) stays in the owning
 * process. A restart therefore cannot resume a match; it closes the abandoned record instead of
 * pretending the match still exists.
 */
export interface MatchJournal {
  start(record: { matchId: string; mode: MatchMode; createdAt: number; expiresAt: number }): Promise<void>;
  close(matchId: string, reason: string): Promise<void>;
  closeOpen(reason: string): Promise<number>;
}

export class NoopJournal implements MatchJournal {
  async start() {}
  async close() {}
  async closeOpen() { return 0; }
}

export class PostgresMatchJournal implements MatchJournal {
  private recovery: Promise<number> | undefined;
  constructor(private readonly pool: Pool, private readonly mode: MatchMode, private readonly instanceId = randomUUID()) {}

  /** Any row still open belongs to a process that no longer owns it. */
  private ensureRecovered() {
    this.recovery ??= this.closeOpen('server-restart').catch(error => { this.recovery = undefined; throw error; });
    return this.recovery;
  }

  /** Closes rows left open by a previous process; safe to call at boot and from start(). */
  recover() {
    return this.ensureRecovered();
  }

  async start(record: { matchId: string; createdAt: number; expiresAt: number }) {
    await this.ensureRecovered();
    await this.pool.query(
      'INSERT INTO golvia_match (id, mode, instance_id, created_at, expires_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0)) ON CONFLICT (id) DO NOTHING',
      [record.matchId, this.mode, this.instanceId, record.createdAt, record.expiresAt],
    );
  }

  async close(matchId: string, reason: string) {
    await this.pool.query('UPDATE golvia_match SET closed_at = now(), close_reason = $2 WHERE id = $1 AND closed_at IS NULL', [matchId, reason]);
  }

  async closeOpen(reason: string) {
    const result = await this.pool.query('UPDATE golvia_match SET closed_at = now(), close_reason = $2 WHERE mode = $1 AND closed_at IS NULL', [this.mode, reason]);
    return result.rowCount ?? 0;
  }
}
