'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { MatchKind, RankedResult } from '@/lib/rating';
export function useQuickMatch() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [seat, setSeat] = useState<0 | 1>(0);
  const [kind, setKind] = useState<MatchKind>('casual');
  const [ranked, setRanked] = useState<RankedResult | undefined>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'queue' | 'matched' | 'opponent-wait' | 'reconnecting' | 'restarted' | 'forfeit' | 'error'>('idle');
  const [opponentDeadline, setOpponentDeadline] = useState<number | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const matchIdRef = useRef<string | null>(null);
  const kindRef = useRef<MatchKind>('casual');
  const reset = useCallback(() => {
    socketRef.current?.disconnect(); socketRef.current = null;
    sessionStorage.removeItem('golvia:resume-token'); sessionStorage.removeItem('golvia:match-kind');
    matchIdRef.current = null; setSocket(null); setStatus('idle'); setMatchId(null); setOpponentId(null); setPlayerId(null); setRanked(undefined); setOpponentDeadline(null);
  }, []);
  const cancel = useCallback(async () => {
    const connection = socketRef.current;
    if (connection) {
      try {
        const result = await connection.timeout(5000).emitWithAck('quitQueue', {});
        if (result.status !== 200) throw new Error('cancel-failed');
        if (result.result?.reason === 'forfeit') { setRanked(result.result); setStatus('forfeit'); return true; }
      } catch { setError('Maç iptali doğrulanamadı. Bağlantı gelince yeniden dene.'); return false; }
    }
    reset(); return true;
  }, [reset]);
  const start = useCallback(async (requested: MatchKind = 'casual') => {
    if (socketRef.current) return;
    kindRef.current = requested; setKind(requested); setRanked(undefined); setError(''); setStatus('queue');
    sessionStorage.setItem('golvia:match-kind', requested);
    const url = process.env.NEXT_PUBLIC_WS_URL || (process.env.NODE_ENV === 'production' ? location.origin : `${location.protocol}//${location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT || '3001'}`);
    const connection = io(url, { transports: ['websocket'], autoConnect: false, reconnection: true, reconnectionAttempts: 8, auth: { resumeToken: sessionStorage.getItem('golvia:resume-token') } });
    socketRef.current = connection; setSocket(connection);
    connection.on('playerId', (id: string) => setPlayerId(id));
    connection.on('session', (data: { playerId: string; resumeToken: string }) => {
      const previous = sessionStorage.getItem('golvia:resume-token');
      if (previous && previous !== data.resumeToken) { reset(); setStatus('restarted'); return; }
      setPlayerId(data.playerId); connection.auth = { resumeToken: data.resumeToken };
      sessionStorage.setItem('golvia:resume-token', data.resumeToken);
      if (!matchIdRef.current) { setStatus('queue'); connection.emit('quickMatch', { kind: kindRef.current }); }
    });
    connection.on('matchFound', (data: { matchId: string; opponentId: string; seat: 0 | 1; kind: MatchKind }) => {
      matchIdRef.current = data.matchId; setMatchId(data.matchId); setOpponentId(data.opponentId); setSeat(data.seat); setKind(data.kind); kindRef.current = data.kind; setStatus('matched');
    });
    connection.on('rankedResult', (result: RankedResult) => { if (result.matchId === matchIdRef.current) { setRanked(result); if (result.reason === 'forfeit') { setStatus('forfeit'); setOpponentDeadline(null); } } });
    connection.on('matchCancelled', () => { reset(); setError('Maç iptal edildi. ELO değişmedi.'); setStatus('error'); });
    connection.on('matchClosed', (data: { reason?: string }) => { if (data.reason !== 'forfeit') setError('Maç sonucu kaydedildi. Yeni rakip arayabilirsin.'); });
    connection.on('opponentDisconnected', (data: { deadline: number }) => { setOpponentDeadline(data.deadline); setStatus('opponent-wait'); });
    connection.on('opponentResumed', () => { setOpponentDeadline(null); setStatus('matched'); });
    connection.on('matchError', (data: { message?: string }) => { setError(data.message ?? 'Eşleşme başarısız.'); if (!matchIdRef.current) { reset(); setStatus('error'); } });
    connection.on('serverRestarting', () => { reset(); setStatus('restarted'); });
    connection.on('connect_error', () => setStatus('reconnecting'));
    connection.io.on('reconnect_failed', () => { reset(); setStatus('error'); });
    connection.on('disconnect', reason => { if (reason !== 'io client disconnect') setStatus('reconnecting'); });
    connection.connect();
  }, [reset]);
  useEffect(() => {
    if (sessionStorage.getItem('golvia:resume-token')) void start(sessionStorage.getItem('golvia:match-kind') === 'ranked' ? 'ranked' : 'casual');
    return () => { socketRef.current?.disconnect(); socketRef.current = null; };
  }, [start]);
  return { playerId, matchId, opponentId, seat, status, opponentDeadline, start, cancel, socket, kind, ranked, error };
}
