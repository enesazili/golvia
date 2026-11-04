import type { Observation } from './review.ts';

// Only an explicitly licensed, local structured feed may be passed here. This adapter never fetches a site.
export type LicensedFeed = {
  provider: string; rightsUrl: string; redistributionAllowed: boolean; checkedAt: string;
  matches: { id: string; url: string; date: string; competition: string; status: 'final' | 'scheduled';
    team: { externalId: string; name: string; level: 'senior' | 'youth' | 'reserve' | 'unknown' };
    players: { externalId: string; name: string; birthDate: string; minutesPlayed: number }[] }[];
};
export type IdentityMapping = { playerId: string; teamId: string; externalPlayerId: string; externalTeamId: string; identityUrl: string };

export type FeedObservation = Omit<Observation,'reviewerChecked'|'sourceNote'|'identityNote'>;
export function feedObservations(feed: LicensedFeed, mapping: IdentityMapping[], licensedProviders: Set<string>): { playerId: string; teamId: string; observation: FeedObservation }[] {
  if (!licensedProviders.has(feed.provider) || !feed.redistributionAllowed || !feed.rightsUrl.startsWith('https://') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(feed.checkedAt)) throw new Error('Feed rights not approved');
  const result: { playerId: string; teamId: string; observation: FeedObservation }[] = [];
  const seen = new Set<string>();
  for (const match of feed.matches) {
    if (match.status !== 'final' || match.team.level !== 'senior') continue;
    for (const person of match.players) {
      if (!Number.isInteger(person.minutesPlayed) || person.minutesPlayed <= 0) continue;
      for (const link of mapping) {
        if (link.externalPlayerId !== person.externalId || link.externalTeamId !== match.team.externalId) continue;
        const id = `${feed.provider}/${match.id}/${link.playerId}/${link.teamId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({ playerId: link.playerId, teamId: link.teamId, observation: {
          matchUrl: match.url, identityUrl: link.identityUrl, matchId: `${feed.provider}:${match.id}`,
          matchDate: match.date, competition: match.competition,
          playerName: person.name, birthDate: person.birthDate, teamName: match.team.name,
          teamLevel: 'senior', matchStatus: 'final', event: 'minutes-played', minutesPlayed: person.minutesPlayed,
        } });
      }
    }
  }
  return result;
}
