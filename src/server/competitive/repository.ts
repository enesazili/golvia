import type { Pool } from 'pg';
import { elo, GAME_MODE, rankProgress, type RankedResult, type Rating } from '../../lib/rating.ts';
import { SessionError } from '../game/service.ts';

export interface Competition {
  start(id: string, users: [string, string], at: number): Promise<void>;
  complete(id: string, score: [number, number], winner: 0 | 1 | null, at: number, reason?: 'finished' | 'forfeit'): Promise<RankedResult>;
  cancel(id: string, reason: string): Promise<RankedResult>;
}
type Standing = { mode: string; elo: number; wins: number; losses: number; draws: number };
export function rating(row: Standing): Rating {
  const played = row.wins + row.losses + row.draws, rank = rankProgress(row.elo);
  return { ...row, played, winRate: played ? Math.round(row.wins / played * 1000) / 10 : 0, league: rank.name, rank };
}
export class CompetitiveRepository implements Competition {
  constructor(private readonly pool: Pool) {}
  async start(id: string, users: [string, string], at: number) {
    if (users[0] === users[1]) throw new SessionError(409, 'Kendi hesabınla eşleşemezsin.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const verified = await client.query('SELECT id FROM golvia_auth."user" WHERE id=ANY($1::text[]) AND status=\'active\' AND "emailVerified"', [users]);
      if (verified.rowCount !== 2) throw new SessionError(403, 'Rekabetçi maç için doğrulanmış hesap gerekli.');
      await client.query('INSERT INTO competitive_match(id,mode,started_at) VALUES($1,$2,to_timestamp($3 / 1000.0))', [id, GAME_MODE, at]);
      for (const [seat, user] of users.entries()) await client.query('INSERT INTO competitive_participant(match_id,seat,user_id) VALUES($1,$2,$3)', [id, seat, user]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new SessionError(409, 'Hesabının devam eden rekabetçi maçı var.');
      throw error;
    } finally { client.release(); }
  }
  async complete(id: string, score: [number, number], winner: 0 | 1 | null, at: number, reason: 'finished' | 'forfeit' = 'finished'): Promise<RankedResult> {
    if (!score.every(n => Number.isInteger(n) && n >= 0 && n <= 3) || (reason === 'finished' ? winner !== (score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1) : winner !== 0 && winner !== 1)) throw new Error('Invalid server result');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const match = (await client.query('SELECT * FROM competitive_match WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!match || match.status === 'cancelled') throw new SessionError(409, 'Maç sonucu kaydedilemez.');
      const seats = (await client.query('SELECT * FROM competitive_participant WHERE match_id=$1 ORDER BY seat', [id])).rows;
      if (seats.length !== 2) throw new Error('Incomplete ranked participants');
      if (match.status === 'completed') {
        if (match.score0 !== score[0] || match.score1 !== score[1] || match.winner !== winner || match.reason !== reason) throw new SessionError(409, 'Maç sonucu çakışıyor.');
      } else {
        // Every transaction locks rating rows in the same account order to avoid deadlocks.
        for (const user of seats.map(s => s.user_id as string).sort()) await client.query('INSERT INTO competitive_rating(user_id,mode) VALUES($1,$2) ON CONFLICT DO NOTHING', [user, match.mode]);
        const locked = (await client.query('SELECT user_id,elo FROM competitive_rating WHERE mode=$1 AND user_id=ANY($2::text[]) ORDER BY user_id FOR UPDATE', [match.mode, seats.map(s => s.user_id)])).rows;
        const before = seats.map(s => locked.find(r => r.user_id === s.user_id)!.elo) as [number, number];
        for (const [seat, participant] of seats.entries()) {
          const actual = winner === null ? 0.5 : winner === seat ? 1 : 0;
          const after = elo(before[seat], before[1 - seat], actual);
          await client.query('UPDATE competitive_rating SET elo=$3,wins=wins+$4,losses=losses+$5,draws=draws+$6 WHERE user_id=$1 AND mode=$2', [participant.user_id, match.mode, after, actual === 1 ? 1 : 0, actual === 0 ? 1 : 0, actual === 0.5 ? 1 : 0]);
          await client.query('UPDATE competitive_participant SET active=false,elo_before=$3,elo_after=$4 WHERE match_id=$1 AND seat=$2', [id, seat, before[seat], after]);
          participant.elo_before = before[seat]; participant.elo_after = after;
        }
        await client.query("UPDATE competitive_match SET status='completed',score0=$2,score1=$3,winner=$4,reason=$6,ended_at=to_timestamp($5 / 1000.0) WHERE id=$1", [id, ...score, winner, at, reason]);
      }
      await client.query('COMMIT');
      return { matchId: id, status: 'completed', reason, winner, before: seats.map(s => s.elo_before) as [number, number], after: seats.map(s => s.elo_after) as [number, number] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async cancel(id: string, reason: string): Promise<RankedResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const match = (await client.query('SELECT status,reason FROM competitive_match WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (match?.status === 'completed') throw new SessionError(409, 'Tamamlanmış maç iptal edilemez.');
      await client.query("UPDATE competitive_match SET status='cancelled',reason=COALESCE(reason,$2),ended_at=COALESCE(ended_at,now()) WHERE id=$1", [id, reason]);
      await client.query('UPDATE competitive_participant SET active=false WHERE match_id=$1', [id]);
      await client.query('COMMIT');
      return { matchId: id, status: 'cancelled', reason: match?.reason ?? reason };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  /** Only one owning socket process is supported. Restart abandons unfinished games without ELO. */
  async recover() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE competitive_match SET status='cancelled',reason='server-restart',ended_at=now() WHERE status='active'");
      await client.query("UPDATE competitive_participant SET active=false WHERE active AND match_id IN (SELECT id FROM competitive_match WHERE status<>'active')");
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async profile(userId: string, page = 1, limit = 20) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new SessionError(400, 'Geçersiz geçmiş sorgusu.');
    const rows = (await this.pool.query('SELECT mode,elo,wins,losses,draws FROM competitive_rating WHERE user_id=$1 ORDER BY mode', [userId])).rows as Standing[];
    if (!rows.some(r => r.mode === GAME_MODE)) rows.push({ mode: GAME_MODE, elo: 1000, wins: 0, losses: 0, draws: 0 });
    const history = (await this.pool.query(`SELECT m.id,m.mode,m.started_at,m.ended_at,m.score0,m.score1,m.winner,m.reason,p.seat,p.elo_before,p.elo_after,
      COALESCE(u.name,'Silinmiş oyuncu') opponent_name,o.elo_before opponent_elo
      FROM competitive_participant p JOIN competitive_match m ON m.id=p.match_id
      JOIN competitive_participant o ON o.match_id=m.id AND o.seat<>p.seat
      LEFT JOIN golvia_auth."user" u ON u.id=o.user_id
      WHERE p.user_id=$1 AND m.status='completed' AND m.mode=$4
      ORDER BY m.ended_at DESC,m.id DESC LIMIT $2 OFFSET $3`, [userId, limit + 1, (page - 1) * limit, GAME_MODE])).rows;
    const stats = (await this.pool.query(`WITH ordered AS (
      SELECT m.id,m.ended_at,p.elo_before,p.elo_after,m.reason,
        CASE WHEN m.winner IS NULL THEN 'draw' WHEN m.winner=p.seat THEN 'win' ELSE 'loss' END outcome,
        row_number() OVER(ORDER BY m.ended_at DESC,m.id DESC) rn
      FROM competitive_participant p JOIN competitive_match m ON m.id=p.match_id
      WHERE p.user_id=$1 AND m.status='completed' AND m.mode=$2
    ) SELECT MAX(GREATEST(elo_before,elo_after)) peak,
      COUNT(*) FILTER(WHERE reason='forfeit' AND outcome='win')::int forfeit_wins,
      COUNT(*) FILTER(WHERE reason='forfeit' AND outcome='loss')::int forfeit_losses,
      (SELECT outcome FROM ordered WHERE rn=1) streak_outcome,
      COUNT(*) FILTER(WHERE rn < COALESCE((SELECT MIN(rn) FROM ordered WHERE outcome<>(SELECT outcome FROM ordered WHERE rn=1)),2147483647))::int streak,
      COALESCE(json_agg(json_build_object('id',id,'at',ended_at,'before',elo_before,'elo',elo_after,'outcome',outcome) ORDER BY rn DESC) FILTER(WHERE rn<=30),'[]') recent
      FROM ordered`, [userId, GAME_MODE])).rows[0];
    const own = await this.leaderboard(GAME_MODE, 1, 1, userId);
    return { ratings: rows.map(rating), stats, standing: own.self, page, hasNext: history.length > limit,
      history: history.slice(0, limit).map(item => ({ ...item, opponent_rank: item.opponent_elo == null ? null : rankProgress(item.opponent_elo) })) };
  }
  async leaderboard(mode: string, page: number, limit = 20, userId: string | null = null) {
    if (![GAME_MODE, 'overall'].includes(mode) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new SessionError(400, 'Geçersiz sıralama sorgusu.');
    const result = await this.pool.query(`WITH stats AS (
      SELECT r.user_id, SUM(r.wins)::int wins,SUM(r.losses)::int losses,SUM(r.draws)::int draws,
        CASE WHEN $1='overall' THEN ROUND(1000 + (SUM(r.elo::numeric*(r.wins+r.losses+r.draws))/NULLIF(SUM(r.wins+r.losses+r.draws),0)-1000)*SUM(r.wins+r.losses+r.draws)/(SUM(r.wins+r.losses+r.draws)+20))::int ELSE MAX(r.elo) END elo
      FROM competitive_rating r WHERE ($1='overall' OR r.mode=$1) AND r.wins+r.losses+r.draws>0 GROUP BY r.user_id
    ) , ranked AS (SELECT s.elo,s.wins,s.losses,s.draws,u.name, s.user_id=$4 AS self,COUNT(*) OVER()::int total,
      ROW_NUMBER() OVER(ORDER BY s.elo DESC,s.wins DESC,s.losses ASC,s.user_id)::int position
      FROM stats s JOIN golvia_auth."user" u ON u.id=s.user_id WHERE u.status='active' AND u."emailVerified"
       ) SELECT * FROM ranked WHERE (position>$3 AND position<=$3+$2) OR self ORDER BY position`, [mode, limit, (page - 1) * limit, userId]);
    const format = ({ name, elo, wins, losses, draws, position }: typeof result.rows[number]) => {
      const { rank: badge, ...stats } = rating({ mode, elo, wins, losses, draws });
      return { ...stats, badge, rank: position as number, name: String(name), ...(mode === 'overall' ? { league: '—' } : {}) };
    };
    const self = result.rows.find(row => row.self);
    return { page, limit, hasNext: result.rows[0] ? page * limit < result.rows[0].total : false,
      self: self ? format(self) : null,
      items: result.rows.filter(row => row.position > (page - 1) * limit && row.position <= page * limit).map(format) };
  }
}
