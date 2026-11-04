import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { validateTop100Catalog } from './wikidata/top100.ts';
import { OFFICIAL_EVIDENCE_HOSTS } from '../src/server/football/evidence-hosts.ts';

/**
 * One-off integrity repair/report for the staging database.
 *   npm run data:review:integrity            # report only
 *   npm run data:review:integrity -- --apply # apply evidence-backed repairs
 *
 * Only evidence-backed unknown-level clubs of approved, playable careers are
 * promoted. No bulk level change is performed.
 */
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL required');
const apply = process.argv.includes('--apply');
const catalog: unknown = JSON.parse(await readFile('data/club-catalog.top100.json', 'utf8'));
validateTop100Catalog(catalog);
const top = new Set(catalog.clubs.map((club: { id: string }) => club.id));

const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(3212026)');

  const promotions = await client.query<{
    career_id: string; player_id: string; team_id: string; team_name: string;
    evidence: Record<string, unknown> | null; provenance: Record<string, unknown> | null;
  }>(`SELECT c.id AS career_id,c.player_id,t.id AS team_id,t.name AS team_name,r.evidence,c.provenance
    FROM football_career c JOIN football_entity t ON t.id=c.team_id JOIN football_review r ON r.career_id=c.id
    WHERE r.status='approved' AND c.verified AND c.appeared AND t.kind='club' AND t.level='unknown'
    ORDER BY c.id`);

  const promotable = promotions.rows.filter(row => {
    const evidence = row.evidence ?? {};
    const identityUrl = typeof evidence.identityUrl === 'string' ? evidence.identityUrl : '';
    let host = '';
    try { host = new URL(identityUrl).hostname; } catch { /* no independent identity */ }
    return top.has(row.team_id) && evidence.teamLevel === 'senior' &&
      evidence.matchStatus === 'final' && ['goal', 'substituted-on', 'substituted-off', 'minutes-played'].includes(String(evidence.event)) &&
      !!identityUrl && OFFICIAL_EVIDENCE_HOSTS.has(host);
  });

  const missingIdentity = await client.query<{ career_id: string; proof: Record<string, unknown> }>(
    `SELECT c.id AS career_id,c.provenance->'matchProof' AS proof
     FROM football_career c LEFT JOIN football_review r ON r.career_id=c.id
     WHERE c.verified AND c.appeared AND c.provenance ? 'matchProof'
       AND COALESCE(c.provenance->'matchProof'->>'identityUrl','')=''
       AND r.career_id IS NULL
     ORDER BY c.id`);

  const unplayable = await client.query<{ career_id: string; verified: boolean; appeared: boolean; team_kind: string; team_level: string | null }>(
    `SELECT r.career_id,c.verified,c.appeared,t.kind AS team_kind,t.level AS team_level
     FROM football_review r JOIN football_career c ON c.id=r.career_id JOIN football_entity t ON t.id=c.team_id
     WHERE r.status='approved' AND (NOT c.verified OR NOT c.appeared OR t.kind NOT IN ('club','national_team')
       OR t.level<>'senior' OR NOT EXISTS(SELECT 1 FROM football_link l WHERE l.player_id=c.player_id AND l.selection_id=t.id))
     ORDER BY r.career_id`);

  const legacyEvents = await client.query<{ id: string }>(
    'SELECT id FROM football_review_event WHERE request_id IS NULL ORDER BY id');

  const report = {
    appliable: apply,
    promotions: promotable.map(row => ({ careerId: row.career_id, playerId: row.player_id, teamId: row.team_id, teamName: row.team_name })),
    pendingUnknownLevel: promotions.rows.filter(row => !promotable.includes(row)).map(row => ({ careerId: row.career_id, teamId: row.team_id, teamName: row.team_name })),
    missingIdentity: missingIdentity.rows.map(row => ({ careerId: row.career_id, hasIdentityUrl: false })),
    unplayable: unplayable.rows,
    legacyEventsWithoutActor: legacyEvents.rows.length,
  };

  if (apply) {
    for (const row of promotable) {
      const updated = await client.query("UPDATE football_entity SET level='senior' WHERE id=$1 AND kind='club' AND level='unknown'", [row.team_id]);
      if (updated.rowCount !== 1) throw new Error(`Seviye güncellenemedi: ${row.team_id}`);
      await client.query(`INSERT INTO football_review_event(career_id,status,reason,evidence,action,actor,request_id)
        VALUES($1,'approved',$2,$3::jsonb,'level-correction','repair:integrity',$4)`,
        [row.career_id, `${row.team_name} (${row.team_id}) kanıtlı A takım onayı nedeniyle senior seviyesine düzeltildi.`,
          JSON.stringify(row.evidence ?? {}), `integrity-level-${row.team_id}`]);
    }
    for (const row of missingIdentity.rows) {
      await client.query(`INSERT INTO football_review(career_id,status,reason,evidence,revision)
        VALUES($1,'pending',$2,$3::jsonb,1)
        ON CONFLICT(career_id) DO UPDATE SET status='pending',reason=EXCLUDED.reason,evidence=EXCLUDED.evidence,
        revision=football_review.revision+1,updated_at=now()`,
        [row.career_id, 'Bağımsız kimlik kanıtı (identityUrl) eksik; yeniden inceleme gerekli.', JSON.stringify(row.proof)]);
      await client.query(`INSERT INTO football_review_event(career_id,status,reason,evidence,action,actor,request_id)
        VALUES($1,'pending',$2,$3::jsonb,'integrity-flag','repair:integrity',$4)`,
        [row.career_id, 'Bağımsız kimlik kanıtı eksik; yeniden inceleme için işaretlendi.', JSON.stringify(row.proof),
          `integrity-flag-${row.career_id}`]);
    }
    for (const row of legacyEvents.rows) {
      // Never invent a person: old rows get an explicit legacy marker instead.
      await client.query(`UPDATE football_review_event SET action='legacy-decision',actor='legacy:unknown',request_id=$2 WHERE id=$1`,
        [row.id, `legacy-event-${row.id}`]);
    }
    await client.query('COMMIT');
  } else {
    await client.query('ROLLBACK');
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally { client.release(); await pool.end(); }
