import { createHash } from 'node:crypto';
import type { Dataset, Entity, Career, Source } from '../../src/server/football/types.ts';
import type { Stored } from './store.ts';
export type Snak = { snaktype?: string; datavalue?: { value: unknown } };
export type Statement = { id?: string; rank?: string; mainsnak: Snak; qualifiers?: Record<string, Snak[]>; references?: unknown[] };
export type WdEntity = { id: string; lastrevid: number; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims: Record<string, Statement[]> };
type Category = 'professional-club' | 'club-candidate' | 'senior-national' | 'youth-national' | 'academy' | 'reserve' | 'unknown';
export type Classification = { category: Category; status: 'classified' | 'needs-review'; reason: string };
export function statements(entity: WdEntity, property: string) { return (Array.isArray(entity.claims[property]) ? entity.claims[property] : []).filter(s => s.rank !== 'deprecated'); }
export function entityIds(entity: WdEntity, property: string) {
  return [...new Set(statements(entity, property).flatMap(s => {
    const v = s.mainsnak?.datavalue?.value; return v && typeof v === 'object' && 'id' in v && typeof v.id === 'string' && /^Q\d+$/.test(v.id) ? [v.id] : [];
  }))];
}
export function names(entity: WdEntity) {
  const labels = ['tr', 'en'].flatMap(l => entity.labels?.[l]?.value ? [entity.labels[l].value] : []);
  const aliases = ['tr', 'en'].flatMap(l => entity.aliases?.[l]?.map(a => a.value) ?? []);
  for (const property of ['P1449', 'P1813']) for (const s of statements(entity, property)) {
    const v = s.mainsnak.datavalue?.value;
    if (typeof v === 'string') aliases.push(v);
    else if (v && typeof v === 'object' && 'text' in v && typeof v.text === 'string' && 'language' in v && ['tr', 'en'].includes(String(v.language))) aliases.push(v.text);
  }
  const valid = [...new Set([...labels, ...aliases].filter(n => n.trim() && n.length <= 500))];
  return { name: labels[0] ?? entity.id, aliases: valid.filter(n => n !== labels[0]) };
}
export function classifyTeam(entity: WdEntity, trusted?: Entity): Classification {
  const types = entityIds(entity, 'P31');
  const text = [...Object.values(entity.labels ?? {}), ...Object.values(entity.descriptions ?? {})].map(v => v.value).join(' ').toLowerCase();
  const national = types.some(t => ['Q6979593', 'Q135408445', 'Q21945604'].includes(t)) || /national|millî|milli/.test(text);
  if (types.includes('Q2412834')) return { category: 'reserve', status: 'classified', reason: 'P31 Q2412834 (reserve team)' };
  if (types.includes('Q21945604')) return { category: 'youth-national', status: 'classified', reason: 'P31 Q21945604 (national youth football team)' };
  // Names are only exclusion hints, never proof of professional or senior status.
  if (/\b(u[- ]?\d{2}|under[- ]?\d{2}|youth|genç|altyapı|academy|olympic)\b|\d{2}\s*yaş/.test(text)) return { category: national ? 'youth-national' : 'academy', status: 'needs-review', reason: 'Age/youth/academy label requires review' };
  if (/\b(reserve|rezerv|b team|c team|ii team)\b/.test(text)) return { category: 'reserve', status: 'needs-review', reason: 'Reserve label requires review' };
  if (trusted?.kind === 'club' && trusted.level === 'senior') return { category: 'professional-club', status: 'classified', reason: 'Existing reviewed Golvia seed team' };
  if (trusted?.kind === 'national_team' && trusted.level === 'senior') return { category: 'senior-national', status: 'classified', reason: 'Existing reviewed Golvia seed national team' };
  // Professional team plus an explicit association-football signal is sufficient;
  // representation-team is inconsistently modelled and adds no senior evidence.
  const football = types.some(t => ['Q476028', 'Q103229495'].includes(t)) || entityIds(entity, 'P641').includes('Q2736');
  if (types.includes('Q20639856') && football && !national) return { category: 'professional-club', status: 'classified', reason: 'Explicit professional sports team and association football statements' };
  if (types.includes('Q476028') && football && !national) return { category: 'club-candidate', status: 'needs-review', reason: 'Association football club; senior/professional level not proven' };
  return { category: 'unknown', status: 'needs-review', reason: national ? 'National membership class alone does not prove senior level' : 'Professional first-team classification not established' };
}
function time(snak?: Snak): { time: string; precision: number } | undefined {
  const v = snak?.datavalue?.value;
  return v && typeof v === 'object' && 'time' in v && 'precision' in v && typeof v.time === 'string' && typeof v.precision === 'number' ? { time: v.time, precision: v.precision } : undefined;
}
function year(snak?: Snak) { const t = time(snak); const m = t && t.precision >= 9 ? /^\+(\d{4})-/.exec(t.time) : null; return m && +m[1] >= 1800 && +m[1] <= 2200 ? +m[1] : undefined; }
export function career(player: WdEntity, statement: Statement, sourceId: string): Career | undefined {
  const target = statement.mainsnak?.datavalue?.value;
  if (!target || typeof target !== 'object' || !('id' in target) || typeof target.id !== 'string') return;
  const id = statement.id ? `wd-statement-${statement.id.replace(/[^a-zA-Z0-9:_-]/g, '-')}` : `wd-statement-${createHash('sha256').update(JSON.stringify([player.id, statement])).digest('hex')}`;
  const from = statement.qualifiers?.P580 ?? [], to = statement.qualifiers?.P582 ?? [];
  return { id, playerId: player.id, teamId: target.id, fromYear: from.length === 1 ? year(from[0]) : undefined, toYear: to.length === 1 ? year(to[0]) : undefined,
    appeared: false, verified: false, sourceId, evidenceId: sourceId,
    provenance: { statementId: statement.id ?? null, rank: statement.rank ?? 'normal', qualifiers: statement.qualifiers ?? {}, references: statement.references ?? [], appearanceStatus: 'unknown', loanStatus: 'unreviewed' } };
}
export function transform(records: Stored[], seed: Dataset) {
  const trusted = new Map(seed.entities.map(e => [e.id, e]));
  const entities = new Map<string, Entity>(), sources: Source[] = [];
  const review: { id: string; reason: string; category?: Category; record: unknown }[] = [];
  const candidates: Career[] = [];
  for (const { entity: e, roles, retrieved } of records) {
    const sourceId = `wd-${e.id}-r${e.lastrevid}`;
    sources.push({ id: sourceId, url: `https://www.wikidata.org/w/index.php?title=${e.id}&oldid=${e.lastrevid}`, license: 'CC0-1.0', retrieved });
    const named = names(e);
    if (roles.length !== 1) { review.push({ id: e.id, reason: 'Conflicting discovery roles', record: e }); continue; }
    if (roles.includes('player') && entityIds(e, 'P31').includes('Q5')) {
      const births = statements(e, 'P569'); const born = births.length === 1 ? time(births[0].mainsnak) : undefined;
      const birthDate = born && born.precision >= 11 && /^\+\d{4}-\d{2}-\d{2}T/.test(born.time) ? born.time.slice(1, 11) : undefined;
      entities.set(e.id, { id: e.id, kind: 'player', ...named, birthDate, sourceId });
      for (const statement of statements(e, 'P54')) { const c = career(e, statement, sourceId); if (c) candidates.push(c); else review.push({ id: statement.id ?? e.id, reason: 'P54 unknown/no-value target', record: statement }); }
    } else if (roles.includes('country')) {
      entities.set(e.id, { id: e.id, kind: 'country', ...named, sourceId });
    } else if (roles.includes('team')) {
      const classification = classifyTeam(e, trusted.get(e.id));
      const countries = [...new Set([...entityIds(e, 'P1532'), ...entityIds(e, 'P17')])];
      if (classification.category === 'club-candidate') {
        entities.set(e.id, { id: e.id, kind: 'club', ...named, level: 'unknown', sourceId });
        review.push({ id: e.id, ...classification, record: e });
        continue;
      }
      if (classification.status === 'needs-review') { review.push({ id: e.id, ...classification, record: e }); continue; }
      if (classification.category === 'senior-national' || classification.category === 'youth-national') {
        const countryId = trusted.get(e.id)?.countryId ?? (countries.length === 1 ? countries[0] : undefined);
        if (!countryId) { review.push({ id: e.id, reason: 'Ambiguous country', record: e }); continue; }
        entities.set(e.id, { id: e.id, kind: 'national_team', ...named, countryId, level: classification.category === 'senior-national' ? 'senior' : 'youth', sourceId });
      } else if (classification.category === 'professional-club') entities.set(e.id, { id: e.id, kind: 'club', ...named, level: 'senior', sourceId });
      else review.push({ id: e.id, ...classification, record: e });
    } else review.push({ id: e.id, reason: 'Player is not a human or role is ambiguous', record: e });
  }
  // Partial checkpoint exports stay valid: unresolved references remain in the review queue.
  for (const [id, e] of entities) if (e.countryId && entities.get(e.countryId)?.kind !== 'country') { review.push({ id, reason: 'Country not fetched yet', record: e }); entities.delete(id); }
  const careers: Career[] = [];
  for (const c of candidates) {
    if (entities.get(c.playerId)?.kind !== 'player' || !['club', 'national_team'].includes(entities.get(c.teamId)?.kind ?? '') || (c.fromYear && c.toYear && c.fromYear > c.toYear)) review.push({ id: c.id, reason: 'Unresolved team or conflicting dates', record: c });
    else careers.push(c);
  }
  const dataset: Dataset = { version: `wikidata-candidates-${new Date().toISOString().slice(0, 10)}`, origin: 'wikidata-candidates', sources, entities: [...entities.values()], careers };
  return { ...dataset, review, counts: { players: dataset.entities.filter(e => e.kind === 'player').length, clubs: dataset.entities.filter(e => e.kind === 'club').length, nationalTeams: dataset.entities.filter(e => e.kind === 'national_team').length, careers: candidates.length, importableCareers: careers.length, verified: careers.filter(c => c.verified).length, unverified: candidates.length, reviewRecords: review.length } };
}
