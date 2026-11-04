import { readFileSync } from 'node:fs';
import { atomicJson } from './wikidata/files.ts';
import { validateTop100Catalog } from './wikidata/top100.ts';
import { mergeMatchProofs, playablePairCount, type MatchProof } from '../src/server/football/evidence.ts';
import type { Dataset } from '../src/server/football/types.ts';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
const reviewed = read('data/football.reviewed.json') as Dataset;
const candidates = read('data/football-top100-a.json') as Dataset;
const catalog = read('data/club-catalog.top100.json');
validateTop100Catalog(catalog);
const ids = new Set(catalog.clubs.map(c => c.id));
const proofs = read('data/football.match-proofs.json') as MatchProof[];
if (!Array.isArray(proofs)) throw new Error('Invalid proof ledger');
const before = playablePairCount(reviewed, ids);
const result = mergeMatchProofs(reviewed, candidates, ids, proofs);
const after = playablePairCount(result.dataset, ids);
const summary = { reviewedProofs: proofs.length, newlyApproved: result.added.length,
  pendingCandidateCareers: candidates.careers.filter(c => !result.dataset.careers.some(r => r.id === c.id && r.verified && r.appeared)).length,
  playablePairsBefore: before, playablePairsAfter: after,
  added: result.added.map(c => ({ playerId: c.playerId, teamId: c.teamId, careerId: c.id,
    evidenceUrl: result.dataset.sources.find(s => s.id === c.evidenceId)?.url })) };
if (process.argv.includes('--apply')) {
  if (result.added.length) {
    const previous = /^(.*-v)(\d+)$/.exec(reviewed.version);
    if (!previous) throw new Error('Reviewed version has no incrementable suffix');
    result.dataset.version = `${previous[1]}${Number(previous[2]) + 1}`;
    await atomicJson('data/football.reviewed.json', result.dataset);
  }
  console.log(JSON.stringify({ ...summary, written: result.added.length > 0 }, null, 2));
} else console.log(JSON.stringify({ ...summary, written: false }, null, 2));
