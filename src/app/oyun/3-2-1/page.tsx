import type { Metadata } from 'next';
import { GameClient } from '@/features/game/game-client';
export const metadata: Metadata = { title: '3-2-1 · Oyun alanı' };
export default function GamePage() { return <GameClient />; }
