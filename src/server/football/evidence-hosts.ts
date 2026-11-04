/**
 * Single allow-list for reviewed football evidence. Only official club/league
 * pages below may be used for manual match review. Adding a host is a code
 * change because it expands the trust boundary.
 */
export const OFFICIAL_EVIDENCE_HOSTS = new Set([
  'www.bayer04.de',
  'www.laliga.com',
  'www.the-afc.com',
  'www.psv.nl',
  'www.slbenfica.pt',
  'scbraga.pt',
  'www.ligaportugal.pt',
  'www.sporting.pt',
  'www.bundesliga.com',
  'www.rclens.fr',
]);

export function officialEvidenceUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Geçersiz kaynak bağlantısı'); }
  if (url.protocol !== 'https:' || !OFFICIAL_EVIDENCE_HOSTS.has(url.hostname) || url.username || url.password ||
      url.search || url.hash || !url.pathname || url.pathname === '/') {
    throw new Error('Onaylanmamış kaynak bağlantısı');
  }
  return url;
}

export function independentEvidencePages(matchUrl: string, identityUrl: string): boolean {
  const match = officialEvidenceUrl(matchUrl), identity = officialEvidenceUrl(identityUrl);
  return match.origin !== identity.origin || match.pathname !== identity.pathname;
}
