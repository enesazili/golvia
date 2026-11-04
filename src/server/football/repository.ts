import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalize } from './normalize.ts';
import { validateDataset } from './importer.ts';
import type { Catalog, Dataset, Suggestion } from './types.ts';
let reviewed: Promise<Dataset> | undefined;
let top100: Promise<Set<string>> | undefined;
function top100Ids(): Promise<Set<string>> {
  top100 ??= readFile(join(process.cwd(), 'data/club-catalog.top100.json'), 'utf8').then(raw => {
    const value: unknown = JSON.parse(raw);
    const clubs = (value as { clubs?: { id?: unknown }[] })?.clubs;
    if (!Array.isArray(clubs) || clubs.length !== 100 || clubs.some(club => typeof club.id !== 'string' || !/^Q\d+$/.test(club.id))) throw new Error('Invalid A-club catalog');
    const ids = new Set(clubs.map(club => club.id as string));
    if (ids.size !== 100) throw new Error('Duplicate A-club identity');
    return ids;
  }).catch(error => { top100 = undefined; throw error; });
  return top100;
}
function reviewedDataset(): Promise<Dataset> {
  reviewed ??= readFile(join(process.cwd(), 'data/football.reviewed.json'), 'utf8').then(raw => {
    const data: unknown = JSON.parse(raw);
    validateDataset(data);
    if (data.origin || !data.careers.some(c => c.verified && c.appeared)) throw new Error('Reviewed football dataset unavailable');
    return data;
  }).catch(error => { reviewed = undefined; throw error; });
  return reviewed;
}
function reviewedSelections(data: Dataset): Set<string> {
  const entities = new Map(data.entities.map(entity => [entity.id, entity]));
  const ids = new Set<string>();
  for (const career of data.careers) {
    if (!career.verified || !career.appeared) continue;
    const team = entities.get(career.teamId);
    if (team?.level === 'senior') {
      const id = team.kind === 'national_team' ? team.countryId : team.kind === 'club' ? team.id : undefined;
      if (id) ids.add(id);
    }
  }
  return ids;
}
function databaseUnavailable(error: unknown): boolean { return process.env.NODE_ENV !== 'production' && !!error && typeof error === 'object' && 'code' in error && error.code === 'ECONNREFUSED'; }
export class FootballRepository {
  constructor(private readonly pool: Pool) {}
  async selections(): Promise<Suggestion[]> {
    const clubs = [...await top100Ids()];
    try {
      const result = await this.pool.query("SELECT id,name,mark,CASE WHEN kind='club' THEN 'Kulüp' ELSE 'A millî takım · Ülke' END AS detail FROM football_entity e WHERE (kind='country' OR (kind='club' AND level='senior' AND id=ANY($1::text[]))) AND EXISTS(SELECT 1 FROM football_link l WHERE l.selection_id=e.id) ORDER BY name,id", [clubs]);
      return result.rows;
    } catch (error) {
      if (!databaseUnavailable(error)) throw error;
      const data = await reviewedDataset();
      const linked = reviewedSelections(data);
      return data.entities.filter(e => linked.has(e.id) && (e.kind === 'country' || (e.kind === 'club' && e.level === 'senior' && clubs.includes(e.id))))
        .map(e => ({ id: e.id, name: e.name, mark: e.mark ?? '', detail: e.kind === 'club' ? 'Kulüp' : 'A millî takım · Ülke' }));
    }
  }
  async search(kind: 'selection' | 'player', query: string): Promise<Suggestion[]> {
    const clubs = [...await top100Ids()];
    const term = normalize(query).slice(0, 80);
    if (term.length < 2) return [];
    const key = term.replace(/[\\%_]/g, '\\$&');
    let result;
    try { result = await this.pool.query(`SELECT e.id,e.name,e.mark,
      CASE WHEN e.kind='player' THEN concat(to_char(e.birth_date,'YYYY-MM-DD'),' · ',e.id)
      WHEN e.kind='club' THEN 'Kulüp' ELSE 'A millî takım · Ülke' END AS detail
      FROM football_entity e WHERE e.kind=ANY($1::text[])
      AND (e.kind<>'club' OR e.level='senior')
      AND (e.kind<>'club' OR e.id=ANY($6::text[]))
      AND (e.kind='player' OR EXISTS(SELECT 1 FROM football_link l WHERE l.selection_id=e.id))
      AND (e.kind<>'player' OR (SELECT COUNT(DISTINCT l.selection_id) FROM football_link l WHERE l.player_id=e.id)>=2)
      AND EXISTS(SELECT 1 FROM football_alias a WHERE a.entity_id=e.id AND a.search_key LIKE $2 ESCAPE '\\')
      ORDER BY (SELECT MIN(CASE WHEN a.search_key=$3 THEN 0 WHEN a.label=e.name AND a.search_key LIKE $4 ESCAPE '\\' THEN 1 WHEN a.search_key LIKE $4 ESCAPE '\\' THEN 2 WHEN a.label=e.name AND a.search_key LIKE $5 ESCAPE '\\' THEN 3 WHEN a.search_key LIKE $5 ESCAPE '\\' THEN 4 WHEN a.label=e.name THEN 5 ELSE 6 END) FROM football_alias a WHERE a.entity_id=e.id AND a.search_key LIKE $2 ESCAPE '\\'),e.name,e.id LIMIT 8`, [kind === 'player' ? ['player'] : ['club', 'country'], `%${key}%`, term, `${key}%`, `% ${key}%`, clubs]); }
    catch (error) {
      if (!databaseUnavailable(error)) throw error;
      const data = await reviewedDataset();
      const selections = reviewedSelections(data);
      const linked = new Map<string, Set<string>>();
      for (const c of data.careers) if (c.verified && c.appeared) { const ids = linked.get(c.playerId) ?? new Set<string>(); ids.add(c.teamId); linked.set(c.playerId, ids); }
      const rank = (name: string, aliases: string[]) => Math.min(...[name, ...aliases].filter(label => normalize(label).includes(term)).map(label => { const value = normalize(label), canonical = label === name; return value === term ? 0 : value.startsWith(term) ? canonical ? 1 : 2 : value.split(' ').some(word => word.startsWith(term)) ? canonical ? 3 : 4 : canonical ? 5 : 6; }));
      return data.entities.filter(e => kind === 'player' ? e.kind === 'player' && (linked.get(e.id)?.size ?? 0) >= 2 : selections.has(e.id) && (e.kind === 'country' || (e.kind === 'club' && e.level === 'senior' && clubs.includes(e.id))))
        .filter(e => [e.name, ...e.aliases].some(label => normalize(label).includes(term)))
        .sort((a, b) => rank(a.name, a.aliases) - rank(b.name, b.aliases) || a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id)).slice(0, 8)
        .map(e => ({ id: e.id, name: e.name, mark: e.mark ?? '', detail: e.kind === 'player' ? `${e.birthDate ?? ''} · ${e.id}` : e.kind === 'club' ? 'Kulüp' : 'A millî takım · Ülke' }));
    }
    return result.rows;
  }
  async catalog(): Promise<Catalog> {
    const clubs = await top100Ids();
    let client;
    try { client = await this.pool.connect(); }
    catch (error) {
      if (!databaseUnavailable(error)) throw error;
      const data = await reviewedDataset();
      const selections = reviewedSelections(data);
      const catalog: Catalog = { version: data.version, selectionIds: new Set(), playerIds: new Set(), links: new Map(), labels: new Map(data.entities.map(e => [e.id, e.name])) };
      for (const e of data.entities) {
        if (e.kind === 'player') catalog.playerIds.add(e.id);
        else if (selections.has(e.id) && (e.kind === 'country' || (e.kind === 'club' && e.level === 'senior' && clubs.has(e.id)))) catalog.selectionIds.add(e.id);
      }
      const teams = new Map(data.entities.map(e => [e.id, e]));
      for (const c of data.careers) {
        const team = teams.get(c.teamId);
        if (!c.verified || !c.appeared || !team || team.level !== 'senior') continue;
        const selection = team.kind === 'national_team' ? team.countryId : team.kind === 'club' ? team.id : undefined;
        if (!selection) continue;
        const links = catalog.links.get(c.playerId) ?? new Set<string>(); links.add(selection); catalog.links.set(c.playerId, links);
      }
      return catalog;
    }
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const version = await client.query('SELECT version FROM football_dataset WHERE id=1');
      if (!version.rows[0]) throw new Error('Football dataset not imported');
      const entities = await client.query("SELECT id,kind,name FROM football_entity e WHERE kind='player' OR ((kind='country' OR (kind='club' AND level='senior' AND id=ANY($1::text[]))) AND EXISTS(SELECT 1 FROM football_link l WHERE l.selection_id=e.id))", [[...clubs]]);
      const connections = await client.query('SELECT player_id,selection_id FROM football_link');
      await client.query('COMMIT');
      const catalog: Catalog = { version: version.rows[0].version, selectionIds: new Set(), playerIds: new Set(), links: new Map(), labels: new Map() };
      for (const e of entities.rows) { (e.kind === 'player' ? catalog.playerIds : catalog.selectionIds).add(e.id); catalog.labels!.set(e.id, e.name); }
      for (const c of connections.rows) { const links = catalog.links.get(c.player_id) ?? new Set<string>(); links.add(c.selection_id); catalog.links.set(c.player_id, links); }
      return catalog;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
