import { json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Socket.IO owns the queue; the HTTP process must not create a separate one.
export async function POST() { return json({ transport: 'socket.io', event: 'quickMatch' }); }
export async function DELETE() { return json({ transport: 'socket.io', event: 'quitQueue' }); }
