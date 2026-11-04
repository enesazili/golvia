import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { atomicJson } from './wikidata/files.ts';
import { canonicalDataset, datasetChecksum, nextReviewedVersion, stable, validateDataset } from '../src/server/football/importer.ts';
import { buildReviewedExport, readExportSnapshot } from '../src/server/football/review-export.ts';
import { reviewAvailable } from '../src/server/football/review-access.ts';

/**
 * Canonical PostgreSQL -> JSON export.
 *   npm run data:review:export            # report only
 *   npm run data:review:export -- --apply # write a new version after a backup
 *
 * Runs only against the local golvia_stage admin connection.
 */
const path = 'data/football.reviewed.json';
const url = process.env.DATABASE_ADMIN_URL;
if (!reviewAvailable('development', url)) throw new Error('Local golvia_stage admin connection required');
const apply = process.argv.includes('--apply');
const base: unknown = JSON.parse(await readFile(path, 'utf8'));
validateDataset(base);

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const snapshot = await readExportSnapshot(pool, base);
  const result = buildReviewedExport(base, snapshot);
  if (result.conflicts.length) {
    console.error(JSON.stringify({ error: 'DB ve JSON çakışıyor; yazılmadı.', conflicts: result.conflicts }, null, 2));
    process.exitCode = 1;
  } else {
    const canonicalBase = canonicalDataset(base);
    const unchanged = stable(canonicalBase) === stable(result.dataset);
    let version = base.version, written = false;
    if (!unchanged) version = nextReviewedVersion(base.version);
    const output = canonicalDataset({ ...result.dataset, version });
    if (apply && !unchanged) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await mkdir('.local/backups', { recursive: true });
      await copyFile(path, `.local/backups/football.reviewed.${stamp}.json`);
      await atomicJson(path, output);
      written = true;
    }
    console.log(JSON.stringify({
      written, unchanged, version,
      added: result.added.length, changed: result.changed.length,
      verifiedCareers: output.careers.filter(c => c.verified && c.appeared).length,
      checksum: datasetChecksum(output),
    }, null, 2));
  }
} finally { await pool.end(); }
