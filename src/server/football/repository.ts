import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalize } from './normalize.ts';
import { validateDataset } from './importer.ts';
import type { Catalog, Dataset, Suggestion } from './types.ts';
let reviewed: Promise<Dataset> | undefined;
function reviewedDataset(): Promise<Dataset> {
  reviewed ??= readFile(join(process.cwd(), 'data/football.reviewed.json'), 'utf8').then(raw => {
    const data: unknown = JSON.parse(raw);
    validateDataset(data);
    if (data.origin || !data.careers.some(c => c.verified && c.appeared)) throw new Error('Reviewed football dataset unavailable');
    return data;
  }).catch(error => { reviewed = undefined; throw error; });
  return reviewed;
}
function databaseUnavailable(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ECONNREFUSED'; }
export class FootballRepository {
  constructor(private readonly pool: Pool) {}
  async selections(): Promise<Suggestion[]> {
    try {
      const result = await this.pool.query("SELECT id,name,mark,CASE WHEN kind='club' THEN 'Kulüp' ELSE 'A millî takım · Ülke' END AS detail FROM football_entity WHERE kind='country' OR (kind='club' AND level='senior') ORDER BY name,id");
      return result.rows;
    } catch (error) {
      if (!databaseUnavailable(error)) throw error;
      const data = await reviewedDataset();
      return data.entities.filter(e => e.kind === 'country' || (e.kind === 'club' && e.level === 'senior'))
        .map(e => ({ id: e.id, name: e.name, mark: e.mark ?? '', detail: e.kind === 'club' ? 'Kulüp' : 'A millî takım · Ülke' }));
    }
  }
  async search(kind: 'selection' | 'player', query: string): Promise<Suggestion[]> {
    const term = normalize(query).slice(0, 80);
    if (term.length < 2) return [];
    const key = term.replace(/[\\%_]/g, '\\$&');
    let result;
    try { result = await this.pool.query(`SELECT e.id,e.name,e.mark,
      CASE WHEN e.kind='player' THEN concat(to_char(e.birth_date,'YYYY-MM-DD'),' · ',e.id)
      WHEN e.kind='club' THEN 'Kulüp' ELSE 'A millî takım · Ülke' END AS detail
      FROM football_entity e WHERE e.kind=ANY($1::text[])
      AND (e.kind<>'club' OR e.level='senior')
      AND (e.kind<>'player' OR (SELECT COUNT(DISTINCT l.selection_id) FROM football_link l WHERE l.player_id=e.id)>=2)
      AND EXISTS(SELECT 1 FROM football_alias a WHERE a.entity_id=e.id AND a.search_key LIKE $2 ESCAPE '\\')
      ORDER BY (SELECT MIN(CASE WHEN a.search_key=$3 THEN 0 WHEN a.label=e.name AND a.search_key LIKE $4 ESCAPE '\\' THEN 1 WHEN a.search_key LIKE $4 ESCAPE '\\' THEN 2 WHEN a.label=e.name AND a.search_key LIKE $5 ESCAPE '\\' THEN 3 WHEN a.search_key LIKE $5 ESCAPE '\\' THEN 4 WHEN a.label=e.name THEN 5 ELSE 6 END) FROM football_alias a WHERE a.entity_id=e.id AND a.search_key LIKE $2 ESCAPE '\\'),e.name,e.id LIMIT 8`, [kind === 'player' ? ['player'] : ['club', 'country'], `%${key}%`, term, `${key}%`, `% ${key}%`]); }
    catch (error) {
      if (!databaseUnavailable(error)) throw error;
      const data = await reviewedDataset();
      const linked = new Map<string, Set<string>>();
      for (const c of data.careers) if (c.verified && c.appeared) { const ids = linked.get(c.playerId) ?? new Set<string>(); ids.add(c.teamId); linked.set(c.playerId, ids); }
      const rank = (name: string, aliases: string[]) => Math.min(...[name, ...aliases].filter(label => normalize(label).includes(term)).map(label => { const value = normalize(label), canonical = label === name; return value === term ? 0 : value.startsWith(term) ? canonical ? 1 : 2 : value.split(' ').some(word => word.startsWith(term)) ? canonical ? 3 : 4 : canonical ? 5 : 6; }));
      return data.entities.filter(e => kind === 'player' ? e.kind === 'player' && (linked.get(e.id)?.size ?? 0) >= 2 : e.kind === 'country' || (e.kind === 'club' && e.level === 'senior'))
        .filter(e => [e.name, ...e.aliases].some(label => normalize(label).includes(term)))
        .sort((a, b) => rank(a.name, a.aliases) - rank(b.name, b.aliases) || a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id)).slice(0, 8)
        .map(e => ({ id: e.id, name: e.name, mark: e.mark ?? '', detail: e.kind === 'player' ? `${e.birthDate ?? ''} · ${e.id}` : e.kind === 'club' ? 'Kulüp' : 'A millî takım · Ülke' }));
    }
    return result.rows;
  }
  async catalog(): Promise<Catalog> {
    let client;
    try { client = await this.pool.connect(); }
    catch (error) {
      if (!databaseUnavailable(error)) throw error;
      const data = await reviewedDataset();
      const catalog: Catalog = { version: data.version, selectionIds: new Set(), playerIds: new Set(), links: new Map(), labels: new Map(data.entities.map(e => [e.id, e.name])) };
      for (const e of data.entities) {
        if (e.kind === 'player') catalog.playerIds.add(e.id);
        else if (e.kind === 'country' || (e.kind === 'club' && e.level === 'senior')) catalog.selectionIds.add(e.id);
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
      const entities = await client.query("SELECT id,kind,name FROM football_entity WHERE kind='player' OR kind='country' OR (kind='club' AND level='senior')");
      const connections = await client.query('SELECT player_id,selection_id FROM football_link');
      await client.query('COMMIT');
      const catalog: Catalog = { version: version.rows[0].version, selectionIds: new Set(), playerIds: new Set(), links: new Map(), labels: new Map() };
      for (const e of entities.rows) { (e.kind === 'player' ? catalog.playerIds : catalog.selectionIds).add(e.id); catalog.labels!.set(e.id, e.name); }
      for (const c of connections.rows) { const links = catalog.links.get(c.player_id) ?? new Set<string>(); links.add(c.selection_id); catalog.links.set(c.player_id, links); }
      return catalog;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
