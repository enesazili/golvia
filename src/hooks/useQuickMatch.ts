'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { MatchKind, RankedResult } from '@/lib/rating';
import { TERMS_VERSION } from '@/lib/legal';
export function useQuickMatch() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [opponentName, setOpponentName] = useState('Rakip');
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
  const guestRef = useRef('');
  const ownsSession = useRef(false);
  const completed = useRef(false);
  const reset = useCallback(() => {
    socketRef.current?.io.removeAllListeners('reconnect_failed');
    socketRef.current?.removeAllListeners(); socketRef.current?.disconnect(); socketRef.current = null;
    if (ownsSession.current && localStorage.getItem('golvia:guest-token') === sessionStorage.getItem('golvia:resume-token')) localStorage.removeItem('golvia:guest-token');
    ownsSession.current = false;
    sessionStorage.removeItem('golvia:resume-token'); sessionStorage.removeItem('golvia:match-kind');
    matchIdRef.current = null; setSocket(null); setStatus('idle'); setMatchId(null); setOpponentId(null); setOpponentName('Rakip'); setSeat(0); completed.current = false; setPlayerId(null); setRanked(undefined); setOpponentDeadline(null);
  }, []);
  const cancel = useCallback(async () => {
    const connection = socketRef.current;
    const wasCompleted = completed.current;
    if (connection) {
      try {
        const result = await connection.timeout(5000).emitWithAck('quitQueue', {});
        if (socketRef.current !== connection) return false;
        if (result.status !== 200) throw new Error('cancel-failed');
        if (result.result?.reason === 'forfeit' && !wasCompleted) { completed.current = true; setOpponentId(null); setOpponentDeadline(null); setRanked(result.result); setStatus('forfeit'); return true; }
      } catch { setError('Maç iptali doğrulanamadı. Bağlantı gelince yeniden dene.'); return false; }
    }
    reset(); return true;
  }, [reset]);
  const start = useCallback(async (requested: MatchKind = 'casual', guest = '') => {
    if (socketRef.current) return;
    completed.current = false; setOpponentId(null); setOpponentName('Rakip'); setOpponentDeadline(null); kindRef.current = requested; setKind(requested); setRanked(undefined); setError(''); setStatus('queue');
    sessionStorage.setItem('golvia:match-kind', requested);
    guestRef.current = guest || sessionStorage.getItem('golvia:guest-name') || '';
    if (guest) sessionStorage.setItem('golvia:guest-name', guest);
    const url = process.env.NEXT_PUBLIC_WS_URL || (process.env.NODE_ENV === 'production' ? location.origin : `${location.protocol}//${location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT || '3001'}`);
    const connection = io(url, { transports: ['websocket'], autoConnect: false, reconnection: true, reconnectionAttempts: 8, auth: { resumeToken: sessionStorage.getItem('golvia:resume-token') || (requested === 'casual' ? localStorage.getItem('golvia:guest-token') : null) } });
    socketRef.current = connection; setSocket(connection);
    connection.on('playerId', (id: string) => setPlayerId(id));
    connection.on('session', (data: { playerId: string; resumeToken: string }) => {
      const previous = sessionStorage.getItem('golvia:resume-token');
      if (previous && previous !== data.resumeToken) { reset(); setStatus('restarted'); return; }
      ownsSession.current = true;
      setPlayerId(data.playerId); connection.auth = { resumeToken: data.resumeToken };
      sessionStorage.setItem('golvia:resume-token', data.resumeToken);
      if (kindRef.current === 'casual') localStorage.setItem('golvia:guest-token', data.resumeToken);
      if (!matchIdRef.current) { setStatus('queue'); connection.emit('quickMatch', { kind: kindRef.current, ...(guestRef.current ? { name: guestRef.current, termsAccepted: true, termsVersion: TERMS_VERSION } : {}) }); }
    });
    connection.on('matchFound', (data: { matchId: string; opponentId: string; opponentName?: string; seat: 0 | 1; kind: MatchKind }) => {
      if (socketRef.current !== connection) return;
      completed.current = false; setRanked(undefined); setOpponentDeadline(null);
      matchIdRef.current = data.matchId; setMatchId(data.matchId); setOpponentId(data.opponentId); setSeat(data.seat); setKind(data.kind); kindRef.current = data.kind; setStatus('matched');
      setOpponentName(data.opponentName || 'Rakip');
    });
    connection.on('rankedResult', (result: RankedResult) => { if (result.matchId === matchIdRef.current) { completed.current = result.status === 'completed'; if (completed.current) { setOpponentId(null); setOpponentDeadline(null); } setRanked(result); if (result.reason === 'forfeit') { setStatus('forfeit'); setOpponentDeadline(null); } } });
    connection.on('matchCancelled', () => { reset(); setError('Maç iptal edildi. ELO değişmedi.'); setStatus('error'); });
    connection.on('matchClosed', (data: { reason?: string }) => { completed.current = true; setOpponentId(null); setOpponentDeadline(null); if (data.reason !== 'forfeit') setError('Maç sonucu kaydedildi. Yeni rakip arayabilirsin.'); });
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
  return { playerId, matchId, opponentId, opponentName, seat, status, opponentDeadline, start, cancel, socket, kind, ranked, error };
}
