export const REACTIONS={gg:'🤝',clap:'👏',laugh:'😂',wow:'😮',thumb:'👍',ball:'⚽'} as const;
export type Reaction=keyof typeof REACTIONS;
