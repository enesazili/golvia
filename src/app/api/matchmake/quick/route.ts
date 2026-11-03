import { json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Socket.IO owns the queue; the HTTP process must not create a separate one.
export async function POST() { return json({ error: 'Eşleşme için oyun bağlantısını kullan.' }, 410); }
export async function DELETE() { return json({ error: 'Eşleşme için oyun bağlantısını kullan.' }, 410); }
