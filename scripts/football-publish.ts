/**
 * Controlled live-usage workflow for football sources.
 *
 * Usage permission is deliberately separate from dataset import. Only `grant`
 * writes a clearance, and `publish` only promotes candidate careers that are
 * both human-approved and backed by a cleared source. Every publish batch can
 * be reverted; the imported candidate rows and their provenance stay intact.
 *
 * Run: npm run data:publish -- status
 *      npm run data:publish -- grant --source <id> --basis <text> --evidence <text> --by <reviewer>
 *      npm run data:publish -- publish --source <id> --by <reviewer>
 *      npm run data:publish -- revert --batch <id> --by <reviewer>
 *
 * Requires DATABASE_ADMIN_URL. Never point this at a live database without a
 * reviewed backup; it is a write command by design.
 */
import { Pool } from 'pg';
import { publishApprovedCareers, revertPublish, setSourceClearance } from '../src/server/football/importer.ts';

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL required for the publish workflow');

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
  return value;
}

function required(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function status(pool: Pool) {
  const filter = option('source');
  const sources = await pool.query(`SELECT s.id, s.license, s.usage_permission,
      c.status AS clearance, c.basis, c.reviewed_by, c.reviewed_at
    FROM football_source s
    LEFT JOIN football_source_clearance c ON c.source_id=s.id
    WHERE ($1::text IS NULL OR s.id=$1)
    ORDER BY s.id`, [filter ?? null]);
  const candidates = await pool.query(`SELECT c.source_id,
      count(*) FILTER (WHERE c.verified=false AND c.appeared=true) AS candidate_careers,
      count(*) FILTER (WHERE c.verified=true AND c.appeared=true) AS verified_careers
    FROM football_career c
    WHERE ($1::text IS NULL OR c.source_id=$1)
    GROUP BY c.source_id ORDER BY c.source_id`, [filter ?? null]);
  const reviews = await pool.query(`SELECT c.source_id, r.status, count(*) AS careers
    FROM football_review r JOIN football_career c ON c.id=r.career_id
    WHERE ($1::text IS NULL OR c.source_id=$1)
    GROUP BY c.source_id, r.status ORDER BY c.source_id, r.status`, [filter ?? null]);
  const batches = await pool.query(`SELECT id, source_id, career_count, published_by, published_at, reverted_at
    FROM football_publish_batch
    WHERE ($1::text IS NULL OR source_id=$1)
    ORDER BY id DESC LIMIT 20`, [filter ?? null]);
  return {
    sources: sources.rows,
    careersBySource: candidates.rows,
    reviewBySource: reviews.rows,
    recentBatches: batches.rows,
    liveGate: 'football_link joins football_source_clearance.status=cleared AND football_career.verified AND appeared',
  };
}

const [command = 'status'] = process.argv.slice(2);
const pool = new Pool({ connectionString: adminUrl, max: 1 });
try {
  if (command === 'status') {
    console.log(JSON.stringify(await status(pool), null, 2));
  } else if (command === 'grant') {
    const sourceId = required('source');
    await setSourceClearance(pool, {
      sourceId,
      status: (option('status') ?? 'cleared') as 'cleared' | 'unresolved' | 'blocked',
      basis: required('basis'),
      evidence: required('evidence'),
      reviewedBy: required('by'),
    });
    console.log(JSON.stringify({ granted: sourceId, clearance: await status(pool) }, null, 2));
  } else if (command === 'publish') {
    const result = await publishApprovedCareers(pool, {
      sourceId: required('source'),
      publishedBy: required('by'),
      limit: option('limit') ? Number(option('limit')) : undefined,
      evidence: option('note') ? { note: option('note') } : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'revert') {
    const batchId = Number(required('batch'));
    const result = await revertPublish(pool, { batchId, revertedBy: required('by') });
    console.log(JSON.stringify({ batchId, ...result }, null, 2));
  } else {
    throw new Error(`Unknown command: ${command}. Use status | grant | publish | revert`);
  }
} finally {
  await pool.end();
}
