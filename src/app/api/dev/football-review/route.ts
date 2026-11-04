import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { reviewActor, reviewAuthorized, reviewAvailable, reviewRateLimited } from '@/server/football/review-access';
import { decideReview, listReviewQueue, type ReviewAction } from '@/server/football/review';
import { body, json } from '@/server/http';
import { validateTop100Catalog } from '../../../../../scripts/wikidata/top100';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const admin = globalThis as unknown as { golviaReviewPool?: Pool };
async function authorized(request: Request) {
  if (!reviewAvailable(process.env.NODE_ENV,process.env.DATABASE_ADMIN_URL)) return false;
  if (!reviewAuthorized(request,process.env.GOLVIA_REVIEW_TOKEN)) return false;
  const token = process.env.GOLVIA_REVIEW_TOKEN!;
  return !reviewRateLimited(createHash('sha256').update(token).digest('hex'));
}
function pool() { return admin.golviaReviewPool ??= new Pool({ connectionString:process.env.DATABASE_ADMIN_URL,max:2,connectionTimeoutMillis:3000 }); }
async function catalog() {
  const value: unknown = JSON.parse(await readFile('data/club-catalog.top100.json','utf8'));
  validateTop100Catalog(value);
  return value.clubs.map(c=>({id:c.id,rank:c.rank}));
}
export async function GET(request: Request) {
  if (!await authorized(request)) return json({ error:'Bulunamadı.' },404);
  try { return json({ items:await listReviewQueue(pool(),await catalog(),50) }); }
  catch { return json({ error:'İnceleme kuyruğuna erişilemedi.' },503); }
}
export async function POST(request: Request) {
  if (!await authorized(request)) return json({ error:'Bulunamadı.' },404);
  try {
    const value = await body(request, 8192);
    const token = process.env.GOLVIA_REVIEW_TOKEN;
    const supplied = typeof value.requestId === 'string' && /^[a-zA-Z0-9:_.-]{1,120}$/.test(value.requestId)
      ? value.requestId : randomUUID();
    const action: ReviewAction = { ...(value as unknown as ReviewAction),
      actor: reviewActor(token, process.env.GOLVIA_REVIEW_ACTOR), requestId: supplied };
    const clubs = await catalog();
    return json(await decideReview(pool(),action,new Set(clubs.map(c=>c.id))));
  } catch(error) {
    const message = error instanceof Error ? error.message : 'İşlem başarısız.';
    return json({ error: message },message.includes('sürümü') ? 409 : 400);
  }
}
