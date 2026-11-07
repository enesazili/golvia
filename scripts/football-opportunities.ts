import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { validateDataset } from '../src/server/football/importer.ts';
import type { Dataset } from '../src/server/football/types.ts';
import { validateTop100Catalog } from './wikidata/top100.ts';

function load(path: string): Dataset {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  validateDataset(value);
  return value;
}
const reviewed = load('data/football.reviewed.json');
const candidates = ['football-top100-a.json', 'football-top100.json', 'football-curated.json', 'football-wikidata.json'].map(file => load(`data/${file}`));
const catalog: unknown = JSON.parse(readFileSync('data/club-catalog.top100.json', 'utf8'));
validateTop100Catalog(catalog);
const aClubs = new Set(catalog.clubs.map(c => c.id));
const rank = new Map(catalog.clubs.map(c => [c.id, c.rank]));
const entities = new Map([...candidates.flatMap(d => d.entities), ...reviewed.entities].map(e => [e.id, e]));
const verified = new Set(reviewed.careers.filter(c => c.verified && c.appeared).map(c => `${c.playerId}/${c.teamId}`));
const pairs = new Set<string>();
const playable = new Map<string, Set<string>>();
for (const career of reviewed.careers) {
  if (!career.verified || !career.appeared || !aClubs.has(career.teamId)) continue;
  const clubs = playable.get(career.playerId) ?? new Set<string>();
  clubs.add(career.teamId);
  playable.set(career.playerId, clubs);
}
const pairKey = (a: string, b: string) => [a, b].sort().join('/');
for (const clubs of playable.values()) for (const a of clubs) for (const b of clubs) if (a !== b) pairs.add(pairKey(a, b));

const candidateLinks = new Map<string, Set<string>>();
const candidatePairs = new Set<string>();
for (const dataset of candidates) for (const career of dataset.careers) {
  const key = `${career.playerId}/${career.teamId}`;
  candidatePairs.add(key);
  if (!aClubs.has(career.teamId) || verified.has(key)) continue;
  const clubs = candidateLinks.get(career.playerId) ?? new Set<string>();
  clubs.add(career.teamId);
  candidateLinks.set(career.playerId, clubs);
}
const priorities = [...candidateLinks].map(([playerId, missing]) => {
  const all = new Set([...(playable.get(playerId) ?? []), ...missing]);
  const potential = new Set<string>();
  for (const a of all) for (const b of all) if (a !== b) {
    const pair = pairKey(a, b);
    if (!pairs.has(pair)) potential.add(pair);
  }
  return { id: playerId, name: entities.get(playerId)?.name ?? playerId, unverifiedAClubLinks: missing.size,
    possibleNewPairs: potential.size, aClubs: [...all].sort((a, b) => (rank.get(a) ?? 101) - (rank.get(b) ?? 101)) };
}).filter(row => row.aClubs.length > 1)
  .sort((a, b) => b.possibleNewPairs - a.possibleNewPairs || b.unverifiedAClubLinks - a.unverifiedAClubLinks || a.id.localeCompare(b.id));

// Read the cached identities without opening the collector or altering its WAL/checkpoint.
const cache = new DatabaseSync('data/.wikidata-top100.sqlite', { readOnly: true });
cache.exec('PRAGMA query_only=ON');
const identityFlags: { id: string; name: string; reason: string }[] = [];
for (const club of catalog.clubs) {
  const row = cache.prepare('SELECT payload FROM entities WHERE id=?').get(club.id);
  if (!row) { identityFlags.push({ id: club.id, name: club.name, reason: 'missing cached identity' }); continue; }
  const entity = JSON.parse(String(row.payload));
  const classes = (entity.claims?.P31 ?? []).map((s: { mainsnak?: { datavalue?: { value?: { id?: string } } } }) => s.mainsnak?.datavalue?.value?.id);
  const label = [entity.labels?.en?.value, entity.labels?.tr?.value, entity.descriptions?.en?.value, entity.descriptions?.tr?.value].filter(Boolean).join(' ');
  if (!classes.some((id: string) => ['Q476028', 'Q103229495'].includes(id)) || classes.includes('Q2412834') || /\b(women|woman|female|reserve|academy|under[- ]?\d{2}|u[- ]?\d{2})\b|kadın|genç/i.test(label))
    identityFlags.push({ id: club.id, name: club.name, reason: 'football/senior identity needs manual review' });
}
cache.close();
console.log(JSON.stringify({
  catalog: { clubs: catalog.clubs.length, uniqueIds: aClubs.size, offlineIdentityFlags: identityFlags,
    caveat: 'Offline P31/name screening is not independent manual confirmation of all 100 IDs.' },
  playable: { aClubs: new Set([...playable.values()].flatMap(clubs => [...clubs])).size, playersWithAClub: playable.size,
    confirmedCareers: reviewed.careers.filter(c => c.verified && c.appeared).length, aClubPairs: pairs.size },
  candidates: { uniqueCareerIds: new Set(candidates.flatMap(d => d.careers.map(c => c.id))).size,
    unprovenPlayerTeamPairs: [...candidatePairs].filter(key => !verified.has(key)).length,
    caveat: 'P54 is a review lead, never proof of a senior appearance.' },
  priorities: priorities.slice(0, 20),
}, null, 2));
