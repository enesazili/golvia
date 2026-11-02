import { football } from '@/server/db';
import { failure, json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind'), q = params.get('q') ?? '';
  if (!['selection', 'player', 'catalog'].includes(kind ?? '') || q.length > 80) return json({ error: 'Geçersiz arama.' }, 400);
  try { return json({ items: kind === 'catalog' ? await football.selections() : await football.search(kind as 'selection' | 'player', q) }); }
  catch (error) { return failure(error); }
}
