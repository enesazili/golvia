import { headers } from 'next/headers';
import { activeSession } from '@/server/auth';
import { GameClient } from '@/features/game/game-client';
import { TERMS_VERSION } from '@/lib/legal';
export default async function Home() {
  let viewer = null;
  try { const session = await activeSession(await headers()); if (session) viewer = { name: session.user.name, verified: session.user.emailVerified, termsAccepted: session.user.termsVersion === TERMS_VERSION }; } catch { /* Guests and practice remain available. */ }
  return <GameClient viewer={viewer} />;
}
