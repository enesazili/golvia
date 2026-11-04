import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { atomicJson } from './wikidata/files.ts';
import { reviewAvailable } from '../src/server/football/review-access.ts';
import { decideReview, type Observation } from '../src/server/football/review.ts';
import { pilotDecisions, validatePilotInput, type PilotInput } from '../src/server/football/review-pilot.ts';
import type { MatchProof } from '../src/server/football/evidence.ts';
import { validateTop100Catalog } from './wikidata/top100.ts';

/**
 * Re-runs the canonical 25-candidate pilot. The candidate list lives in
 * data/football.review-pilot.json and proofs in data/football.match-proofs.json;
 * nothing is read from .local and no proof is hardcoded here.
 */
const url = process.env.DATABASE_ADMIN_URL;
if (!reviewAvailable('development', url)) throw new Error('Local golvia_stage admin connection required');

const input: unknown = JSON.parse(await readFile('data/football.review-pilot.json', 'utf8'));
validatePilotInput(input);
const proofs = JSON.parse(await readFile('data/football.match-proofs.json', 'utf8')) as MatchProof[];
if (!Array.isArray(proofs)) throw new Error('Invalid proof ledger');
const decisions = pilotDecisions(input as PilotInput, proofs);

const catalog: unknown = JSON.parse(await readFile('data/club-catalog.top100.json', 'utf8'));
validateTop100Catalog(catalog);
const top = new Set(catalog.clubs.map((c: { id: string }) => c.id));

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const result = [];
  for (const entry of decisions) {
    const item = entry.item;
    const row = (await pool.query<{
      player_id: string; player_name: string; birth_date: string; team_id: string; team_name: string; candidate_url: string;
    }>(`SELECT c.player_id,p.name AS player_name,p.birth_date::text,c.team_id,t.name AS team_name,s.url AS candidate_url
      FROM football_career c JOIN football_entity p ON p.id=c.player_id JOIN football_entity t ON t.id=c.team_id
      JOIN football_source s ON s.id=c.source_id WHERE c.id=$1`, [item.careerId])).rows[0];
    if (!row) throw new Error(`Aday DB'de yok: ${item.careerId}`);
    if (row.player_id !== item.playerId || row.team_id !== item.clubId || row.birth_date !== item.birthDate ||
        row.player_name !== item.player || row.team_name !== item.club || row.candidate_url !== item.candidateSource) {
      throw new Error(`Pilot girdisi DB kimliğiyle uyuşmuyor: ${item.careerId}`);
    }

    const current = (await pool.query<{ status: string; revision: number }>(
      'SELECT status,revision FROM football_review WHERE career_id=$1', [item.careerId])).rows[0];
    if (!current) {
      let observation: Observation | undefined;
      if (entry.proof) {
        const proof = entry.proof;
        if (proof.evidence.kind !== 'completed-match-event') throw new Error(`Pilot kanıtı maç olayı değil: ${item.careerId}`);
        observation = {
          matchUrl: proof.url, identityUrl: proof.identityUrl!, matchId: proof.matchId!,
          matchDate: proof.matchDate!, competition: proof.competition!,
          playerName: item.player, birthDate: item.birthDate, teamName: item.club,
          teamLevel: 'senior', matchStatus: 'final', event: proof.evidence.event,
          sourceNote: proof.sourceNote!, identityNote: proof.identityNote!, reviewerChecked: true,
        };
      }
      await decideReview(pool, { careerId: item.careerId, revision: 0, decision: entry.decision,
        reason: entry.reason, ...(observation ? { observation } : {}),
        actor: 'pilot:canonical', requestId: `pilot-${item.careerId}` }, top);
    } else if (current.status !== entry.decision) {
      throw new Error(`Mevcut inceleme pilot kararıyla çelişiyor: ${item.careerId}`);
    }

    result.push({ careerId: item.careerId, player: item.player, club: item.club,
      candidateSource: item.candidateSource, matchSource: entry.proof?.url ?? null,
      identitySource: entry.proof?.identityUrl ?? null, decision: entry.decision, reason: entry.reason,
      newPairsAtScreening: item.newPairsAtScreening, possiblePairsAtScreening: item.possiblePairsAtScreening });
  }
  await atomicJson('.local/football-review-pilot.json', { pilotVersion: (input as PilotInput).version, items: result });
  console.log(JSON.stringify({ pilotVersion: (input as PilotInput).version, screened: result.length,
    approved: result.filter(x => x.decision === 'approved').length,
    held: result.filter(x => x.decision === 'hold').length,
    rejected: 0, output: '.local/football-review-pilot.json' }));
} finally { await pool.end(); }
