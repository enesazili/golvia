/**
 * Golvia top-100 -> conservative Wikidata ID matching.
 * Usage (from Golvia project root): node resolve-golvia-top100.mjs
 * Requires WIKIDATA_USER_AGENT with a real project contact.
 * The produced club catalog contains only confidently matched clubs.
 * Review unresolved/ambiguous clubs; NEVER guess Wikidata Q-IDs.
 */
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const sourceFile = resolve(process.argv[2] ?? 'golvia-top100-2026-10-27.json');
const target = resolve('data/club-catalog.top100.json');
const reviewFile = resolve('data/club-catalog.top100.review.json');
const progressFile = resolve('data/club-catalog.top100.progress.json');
const userAgent = process.env.WIKIDATA_USER_AGENT?.trim() ?? '';
if (!userAgent || !/(mailto:|https?:\/\/)/i.test(userAgent) || /(example\.(com|org)|KULLANICI)/i.test(userAgent)) {
  throw new Error('Gerçek iletişim adresi içeren WIKIDATA_USER_AGENT ayarla.');
}

const source = JSON.parse(await readFile(sourceFile, 'utf8'));
if (!Array.isArray(source.clubs) || source.clubs.length !== 100) throw new Error('100 kulüplük kaynak bulunamadı.');

const aliases = {
  'Bayern München': ['FC Bayern Munich', 'Bayern Munich'],
  'Paris Saint Germain': ['Paris Saint-Germain FC', 'Paris Saint-Germain'],
  Inter: ['Inter Milan', 'FC Internazionale Milano'],
  'Sporting CP': ['Sporting Clube de Portugal'],
  'Atletico Madrid': ['Atlético Madrid', 'Atlético de Madrid'],
  Brighton: ['Brighton & Hove Albion'],
  Bournemouth: ['AFC Bournemouth'],
  Como: ['Como 1907'],
  'AS Roma': ['A.S. Roma', 'Roma'],
  Newcastle: ['Newcastle United'],
  'Bodo/Glimt': ['FK Bodø/Glimt', 'Bodø/Glimt'],
  Tottenham: ['Tottenham Hotspur'],
  Leeds: ['Leeds United'],
  'Johor Darul Takzim FC': ["Johor Darul Ta'zim FC", "Johor Darul Ta'zim"],
  'Al-Nassr': ['Al Nassr FC', 'Al-Nassr FC'],
  'Al-Hilal Saudi FC': ['Al Hilal SFC', 'Al Hilal Saudi FC'],
  'Guadalajara Chivas': ['C.D. Guadalajara', 'Chivas Guadalajara'],
  '1899 Hoffenheim': ['TSG 1899 Hoffenheim'],
  Monaco: ['AS Monaco FC'],
  'U.N.A.M. - Pumas': ['Club Universidad Nacional', 'Pumas UNAM'],
  Marseille: ['Olympique de Marseille'],
  Lyon: ['Olympique Lyonnais'],
  'Union St. Gilloise': ['Royale Union Saint-Gilloise', 'Union Saint-Gilloise'],
  'West Ham': ['West Ham United'],
  'Inter Miami': ['Inter Miami CF'],
  'Al-Ahli Jeddah': ['Al Ahli Saudi FC', 'Al-Ahli Saudi FC'],
  'Club America': ['Club América'],
  Alaves: ['Deportivo Alavés'],
  'Slavia Praha': ['SK Slavia Prague', 'SK Slavia Praha'],
  'Vancouver Whitecaps': ['Vancouver Whitecaps FC'],
  'Al-Qadisiyah FC': ['Al Qadsiah FC', 'Al-Qadsiah'],
  Ajax: ['AFC Ajax'],
  'Los Angeles FC': ['Los Angeles Football Club'],
  'Spartak Moscow': ['FC Spartak Moscow'],
  Dynamo: ['FC Dynamo Moscow'],
  'SC Braga': ['S.C. Braga'],
};
const demonyms = {
  Germany: ['german'], Spain: ['spanish'], England: ['english'], Italy: ['italian'],
  France: ['french'], Portugal: ['portuguese'], Netherlands: ['dutch'],
  Norway: ['norwegian'], Russia: ['russian'], Mexico: ['mexican'],
  Malaysia: ['malaysian'], 'Saudi Arabia': ['saudi'], Brazil: ['brazilian'],
  Belgium: ['belgian'], Croatia: ['croatian'], Turkey: ['turkish'],
  Denmark: ['danish'], 'United States': ['american', 'united states'],
  Czechia: ['czech'], Canada: ['canadian'],
};
const normalize = v => String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clubName = v => normalize(v).split(' ').filter(t => !['fc', 'cf', 'afc', 'sc', 'ac', 'f', 'c'].includes(t)).join(' ');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isFootball = s => /(football|soccer|futbol|fussball|fußball)/i.test(s);
// Wikidata descriptions usually use country NAMES ('Spain', 'England'), not only demonyms.
const matchesCountry = (country, description) => {
  const value = normalize(description);
  return [country, ...(demonyms[country] ?? [])].some(term =>
    value.includes(normalize(term))
  );
};
// A ranking of men's first teams must not accidentally select similarly named women's/youth teams.
const excludedVariant = item => /\b(women|women's|female|feminine|femminile|femenino|femenina|youth|academy|reserve|u[- ]?\d{2})\b/i.test(item.description);

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 120000) : 2000 * (2 ** attempt));
      continue;
    }
    if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
    return response.json();
  }
  throw new Error('Wikidata yeniden denemelerden sonra yanıt vermedi');
}
async function search(text) {
  const params = new URLSearchParams({ action: 'wbsearchentities', format: 'json', language: 'en', limit: '10', search: text, type: 'item' });
  const result = await get('https://www.wikidata.org/w/api.php?' + params);
  return (result.search ?? []).map(item => ({ id: item.id, label: item.label ?? '', description: item.description ?? '' }));
}
async function atomicWrite(file, obj) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}
let saved = {};
try { saved = JSON.parse(await readFile(progressFile, 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
for (const club of source.clubs) {
  const options = [club.name, ...(aliases[club.name] ?? [])];
  const names = options.map(clubName);
  // Re-score already downloaded candidates first. Old matcher incorrectly rejected
  // descriptions like 'football club in Spain' or 'club in England'.
  // This avoids repeating Wikidata requests for successfully cached matches.
  const cached = saved[club.rank];
  if (cached && Array.isArray(cached.matches)) {
    const rescored = cached.matches.map(item => ({
      ...item,
      exactName: names.includes(clubName(item.label)),
      matchesCountry: matchesCountry(club.country, item.description),
    }));
    const confident = rescored.filter(item => item.exactName && item.matchesCountry && isFootball(item.description) && !excludedVariant(item));
    if (confident.length === 1) {
      saved[club.rank] = { ...cached, wikidataId: confident[0].id, status: 'candidate-auto', matches: rescored };
      await atomicWrite(progressFile, saved);
      console.log(`${club.rank}/100 ${club.name}: ${confident[0].id} (önbellekten)`);
      continue;
    }
  }
  // Still unresolved or ambiguous? Search again with updated country rules.

  const all = new Map();
  for (const q of options.slice(0, 3)) {
    const result = await search(q);
    for (const item of result) all.set(item.id, item);
    await sleep(850);
    if (result.some(item => {
      return names.includes(clubName(item.label)) && isFootball(item.description)
        && matchesCountry(club.country, item.description) && !excludedVariant(item);
    })) break;
  }
  const matches = [...all.values()].filter(item => isFootball(item.description))
    .map(item => ({ ...item, exactName: names.includes(clubName(item.label)), matchesCountry: matchesCountry(club.country, item.description) }));
  // Require a unique name + football + country match, excluding women's/youth teams.
  const confident = matches.filter(item => item.exactName && item.matchesCountry && !excludedVariant(item));
  saved[club.rank] = {
    name: club.name, country: club.country,
    wikidataId: confident.length === 1 ? confident[0].id : null,
    status: confident.length === 1 ? 'candidate-auto' : 'needs-review',
    matches,
  };
  await atomicWrite(progressFile, saved);
  console.log(`${club.rank}/100 ${club.name}: ${saved[club.rank].wikidataId ?? 'inceleme gerekli'}`);
}
const clubs = source.clubs.filter(club => saved[club.rank]?.wikidataId).map(club => ({
  id: saved[club.rank].wikidataId, name: club.name, tier: 'A', rank: club.rank, country: club.country,
}));
const unresolved = source.clubs.filter(club => !saved[club.rank]?.wikidataId).map(club => ({ ...club, candidates: saved[club.rank]?.matches ?? [] }));
await atomicWrite(target, { clubs, nationalTeams: [], source: source.source, rankingDate: source.rankingDate,
  warning: 'candidate-auto IDs must be spot-checked before public production use' });
await atomicWrite(reviewFile, { unresolved, total: source.clubs.length, resolved: clubs.length });
console.log(`Eşleşen: ${clubs.length}/100 | İncelenecek: ${unresolved.length}`);
console.log(`Katalog: ${target}\nİnceleme: ${reviewFile}`);
