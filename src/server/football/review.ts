import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { normalize } from './normalize.ts';
import { independentEvidencePages, officialEvidenceUrl } from './evidence-hosts.ts';

export type Observation = {
  matchUrl: string; identityUrl: string; matchId: string; matchDate: string;
  competition: string; playerName: string; birthDate: string; teamName: string;
  teamLevel: 'senior'; matchStatus: 'final';
  event: 'goal' | 'substituted-on' | 'substituted-off' | 'minutes-played'; minutesPlayed?: number;
  sourceNote: string; identityNote: string; reviewerChecked: true;
};
export type ReviewAction = { careerId: string; revision: number; decision: 'approved' | 'rejected' | 'hold'; reason: string;
  observation?: Observation; actor?: string; requestId?: string };
const unsafe = /\b(women|female|ladies|reserve|academy|youth|under[- ]?\d{2}|u[- ]?\d{2}|b team|c team|ii|iii|friendly)\b|kadın|genç|altyapı|hazırlık/i;
const key = (a: string, b: string) => [a,b].sort().join('/');
const text = (s: unknown, max = 200) => typeof s === 'string' && s.trim().length >= 3 && s.length <= max;
const note = (s: unknown, max = 800) => typeof s === 'string' && s.trim().length >= 40 && s.length <= max;

export function validateObservation(value: unknown, identity: { playerName: string; birthDate: string; teamName: string; aliases: string[]; teamAliases: string[]; teamLevel: string },
  options: { allowLegacyNotes?: boolean } = {}) : asserts value is Observation {
  const o = value as Observation;
  if (!o || typeof o !== 'object' || o.reviewerChecked !== true || o.teamLevel !== 'senior' || o.matchStatus !== 'final') throw new Error('Tamamlanmış A takım maçı ve insan kontrolü zorunlu');
  if (!text(o.matchUrl, 700) || !text(o.identityUrl, 700)) throw new Error('Maç ve bağımsız kimlik kaynağı zorunlu');
  officialEvidenceUrl(o.matchUrl); officialEvidenceUrl(o.identityUrl);
  if (!independentEvidencePages(o.matchUrl, o.identityUrl)) throw new Error('Bağımsız kimlik kaynağı farklı sayfa olmalı');
  if (!options.allowLegacyNotes && (!note(o.sourceNote) || !note(o.identityNote))) throw new Error('Kaynak ve kimlik inceleme notu zorunlu');
  if ((o.sourceNote !== undefined && !note(o.sourceNote)) || (o.identityNote !== undefined && !note(o.identityNote))) throw new Error('İnceleme notu geçersiz');
  if (!text(o.matchId, 120) || !text(o.competition, 120) || unsafe.test(o.competition) || !/^\d{4}-\d{2}-\d{2}$/.test(o.matchDate) ||
      !Number.isFinite(Date.parse(o.matchDate)) || o.matchDate > new Date().toISOString().slice(0,10)) throw new Error('Resmî maç kimliği/tarihi geçersiz');
  if (identity.teamLevel === 'youth' || unsafe.test(o.teamName) || ![identity.teamName,...identity.teamAliases].some(n => normalize(n) === normalize(o.teamName))) throw new Error('A takım kimliği eşleşmiyor');
  if (identity.birthDate !== o.birthDate || ![identity.playerName,...identity.aliases].some(n => normalize(n) === normalize(o.playerName))) throw new Error('Oyuncu kimliği eşleşmiyor');
  if (!['goal','substituted-on','substituted-off','minutes-played'].includes(o.event) ||
      (o.event === 'minutes-played' && (!Number.isInteger(o.minutesPlayed) || (o.minutesPlayed ?? 0) <= 0))) throw new Error('Sahaya çıkma olayı yok');
}

export function reviewPriority(rows: { careerId: string; playerId: string; teamId: string; rank: number; status: string }[], confirmed: { playerId: string; teamId: string }[]) {
  const byPlayer = new Map<string,Set<string>>(), all = new Map<string,Set<string>>(), pairs = new Set<string>();
  for (const c of confirmed) { const ids = byPlayer.get(c.playerId) ?? new Set<string>(); ids.add(c.teamId); byPlayer.set(c.playerId,ids); }
  for (const ids of byPlayer.values()) for (const a of ids) for (const b of ids) if (a !== b) pairs.add(key(a,b));
  for (const c of rows) if (c.status !== 'rejected') { const ids = all.get(c.playerId) ?? new Set<string>(); ids.add(c.teamId); all.set(c.playerId,ids); }
  return rows.map(row => {
    const existing = byPlayer.get(row.playerId) ?? new Set<string>();
    const immediate = [...existing].filter(id => id !== row.teamId && !pairs.has(key(id,row.teamId))).length;
    const potential = new Set([...existing,...(all.get(row.playerId) ?? [])]);
    const future = [...potential].filter(id => id !== row.teamId && !pairs.has(key(id,row.teamId))).length;
    return { ...row, newPairsIfApproved: immediate, possiblePairs: future,
      priority: immediate * 10000 + future * 100 + (101 - row.rank) };
  }).sort((a,b) => b.priority - a.priority || a.careerId.localeCompare(b.careerId));
}

export async function listReviewQueue(pool: Pool, top: { id: string; rank: number }[], limit = 50) {
  const ids = top.map(c => c.id), ranks = new Map(top.map(c => [c.id,c.rank]));
  const candidates = await pool.query(`SELECT c.id AS career_id,c.player_id,c.team_id,p.name AS player_name,p.birth_date::text,
    t.name AS team_name,t.level AS team_level,s.url AS candidate_url,c.provenance,
    COALESCE(r.status,'pending') AS status,COALESCE(r.reason,'') AS reason,COALESCE(r.revision,0) AS revision,
    COALESCE((SELECT array_agg(label) FROM football_alias WHERE entity_id=p.id),ARRAY[]::text[]) AS player_aliases,
    COALESCE((SELECT array_agg(label) FROM football_alias WHERE entity_id=t.id),ARRAY[]::text[]) AS team_aliases
    FROM football_career c JOIN football_entity p ON p.id=c.player_id JOIN football_entity t ON t.id=c.team_id
    JOIN football_source s ON s.id=c.source_id LEFT JOIN football_review r ON r.career_id=c.id
    WHERE (NOT(c.verified AND c.appeared) OR r.status='pending') AND t.kind='club' AND t.id=ANY($1::text[]) AND t.level<>'youth'
    AND c.id LIKE 'wd-statement-%'
    AND NOT EXISTS (SELECT 1 FROM football_career v WHERE v.player_id=c.player_id AND v.team_id=c.team_id AND v.id<>c.id
      AND v.verified AND v.appeared)`, [ids]);
  const confirmed = await pool.query("SELECT c.player_id,c.team_id FROM football_career c JOIN football_entity t ON t.id=c.team_id WHERE c.verified AND c.appeared AND t.kind='club' AND t.id=ANY($1::text[])", [ids]);
  const ranked = reviewPriority(candidates.rows.map(row => ({ careerId: row.career_id, playerId: row.player_id, teamId: row.team_id,
    rank: ranks.get(row.team_id) ?? 101, status: row.status })), confirmed.rows);
  const details = new Map(candidates.rows.map(row => [row.career_id,row]));
  const seen = new Set<string>();
  return ranked.filter(row => {
    const id = key(row.playerId,row.teamId);
    if (row.status === 'rejected' || seen.has(id)) return false;
    seen.add(id); return true;
  }).slice(0,Math.min(Math.max(limit,1),100)).map(row => ({
    ...row, ...details.get(row.careerId), newPairsIfApproved: row.newPairsIfApproved,
    possiblePairs: row.possiblePairs, priority: row.priority,
  }));
}

export async function decideReview(pool: Pool, action: ReviewAction, topIds: Set<string>) {
  if (!/^wd-statement-[Qq]\d+-[a-zA-Z0-9-]+$/.test(action.careerId) || !['approved','rejected','hold'].includes(action.decision) ||
      !Number.isInteger(action.revision) || action.revision < 0 || !text(action.reason,500)) throw new Error('Geçersiz inceleme kararı');
  const actor = text(action.actor,120) ? action.actor!.trim() : 'unknown';
  const requestId = typeof action.requestId === 'string' && /^[a-zA-Z0-9:_.-]{1,120}$/.test(action.requestId)
    ? action.requestId : randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(3212026)');
    const result = await client.query(`SELECT c.id,c.player_id,c.team_id,c.verified,c.appeared,c.provenance,
      p.name AS player_name,p.birth_date::text,t.name AS team_name,t.level AS team_level,t.kind AS team_kind
      FROM football_career c JOIN football_entity p ON p.id=c.player_id JOIN football_entity t ON t.id=c.team_id
      WHERE c.id=$1 FOR UPDATE OF c`, [action.careerId]);
    const row = result.rows[0];
    if (!row || !topIds.has(row.team_id)) throw new Error('Aday bulunamadı');
    if (row.team_kind !== 'club' || row.team_level === 'youth') throw new Error('Aday A takım kulübü değil');
    const previous = await client.query('SELECT revision FROM football_review WHERE career_id=$1 FOR UPDATE',[action.careerId]);
    if (row.verified && row.appeared && !previous.rows[0]) throw new Error('Önceden doğrulanmış bağ bu kuyrukta değiştirilemez');
    if ((previous.rows[0]?.revision ?? 0) !== action.revision) throw new Error('İnceleme sürümü değişti');
    let evidence: Observation | null = null;
    let levelCorrected = false;
    if (action.decision === 'approved') {
      const duplicate = await client.query('SELECT 1 FROM football_career WHERE player_id=$1 AND team_id=$2 AND verified AND appeared AND id<>$3 LIMIT 1',
        [row.player_id,row.team_id,action.careerId]);
      if (duplicate.rowCount) throw new Error('Oyuncu-kulüp bağı zaten doğrulanmış');
      const pAliases = await client.query('SELECT label FROM football_alias WHERE entity_id=$1',[row.player_id]);
      const tAliases = await client.query('SELECT label FROM football_alias WHERE entity_id=$1',[row.team_id]);
      validateObservation(action.observation,{ playerName:row.player_name,birthDate:row.birth_date,teamName:row.team_name,
        teamLevel:row.team_level,aliases:pAliases.rows.map(x=>x.label),teamAliases:tAliases.rows.map(x=>x.label) });
      evidence = action.observation;
      if (row.team_level !== 'senior') {
        if (row.team_level !== 'unknown') throw new Error('Takım seviyesi güvenli biçimde yükseltilemiyor');
        const promoted = await client.query("UPDATE football_entity SET level='senior' WHERE id=$1 AND kind='club' AND level='unknown'",[row.team_id]);
        if (promoted.rowCount !== 1) throw new Error('Takım seviyesi yükseltilemedi');
        levelCorrected = true;
      }
      const sourceId = `review:${action.careerId}`;
      await client.query(`INSERT INTO football_source(id,url,license,retrieved) VALUES($1,$2,'reference-only',CURRENT_DATE)
        ON CONFLICT(id) DO UPDATE SET url=EXCLUDED.url,retrieved=EXCLUDED.retrieved`,[sourceId,evidence.matchUrl]);
      await client.query(`UPDATE football_career SET verified=true,appeared=true,evidence_id=$2,
        provenance=provenance || jsonb_build_object('reviewObservation',$3::jsonb) WHERE id=$1`,
        [action.careerId,sourceId,JSON.stringify(evidence)]);
      const playable = await client.query('SELECT 1 FROM football_link WHERE player_id=$1 AND selection_id=$2 LIMIT 1',[row.player_id,row.team_id]);
      if (!playable.rowCount) throw new Error('Onay oynanabilir bağ üretmedi');
    } else {
      await client.query('UPDATE football_career SET verified=false,appeared=false WHERE id=$1',[action.careerId]);
    }
    await client.query(`INSERT INTO football_review(career_id,status,reason,evidence,revision) VALUES($1,$2,$3,$4::jsonb,1)
      ON CONFLICT(career_id) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,evidence=EXCLUDED.evidence,
      revision=football_review.revision+1,updated_at=now()`,[action.careerId,action.decision,action.reason,evidence ? JSON.stringify(evidence):null]);
    await client.query(`INSERT INTO football_review_event(career_id,status,reason,evidence,action,actor,request_id)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [action.careerId,action.decision,action.reason,evidence ? JSON.stringify(evidence):null,
        action.decision === 'approved' && levelCorrected ? 'decision+level-correction' : 'decision',actor,requestId]);
    await client.query('COMMIT');
    return { careerId: action.careerId, status: action.decision, revision: action.revision+1, actor, requestId, levelCorrected };
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
