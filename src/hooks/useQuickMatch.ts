'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { MatchKind, RankedResult } from '@/lib/rating';
import { TERMS_VERSION } from '@/lib/legal';
export function useQuickMatch() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [opponentAccountId,setOpponentAccountId]=useState<string|null>(null);
  const inviteRef=useRef('');
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
    sessionStorage.removeItem('golvia:friend-invite'); inviteRef.current=''; setOpponentAccountId(null);
    sessionStorage.removeItem('golvia:resume-token'); sessionStorage.removeItem('golvia:match-kind');
    matchIdRef.current = null; setSocket(null); setStatus('idle'); setMatchId(null); setOpponentId(null); setOpponentName('Rakip'); setSeat(0); completed.current = false; setPlayerId(null); setRanked(undefined); setOpponentDeadline(null);
  }, []);
  const cancel = useCallback(async () => {
    const connection = socketRef.current;
    const wasCompleted = completed.current;
    if (connection) {
      try {
        const result = await connection.timeout(5000).emitWithAck('quitQueue', kindRef.current==='friendly'?{inviteId:inviteRef.current}:{});
        if (socketRef.current !== connection) return false;
        if (result.status !== 200) throw new Error('cancel-failed');
        if (result.result?.reason === 'forfeit' && !wasCompleted) { completed.current = true; setOpponentId(null); setOpponentDeadline(null); setRanked(result.result); setStatus('forfeit'); return true; }
      } catch { setError('Maç iptali doğrulanamadı. Bağlantı gelince yeniden dene.'); return false; }
    }
    reset(); return true;
  }, [reset]);
  const start = useCallback(async (requested: MatchKind = 'casual', guest = '', invitation = '') => {
    if (socketRef.current) return;
    inviteRef.current=invitation||sessionStorage.getItem('golvia:friend-invite')||'';
    if(requested==='friendly')sessionStorage.setItem('golvia:friend-invite',inviteRef.current);
    completed.current = false; setOpponentAccountId(null); setOpponentId(null); setOpponentName('Rakip'); setOpponentDeadline(null); kindRef.current = requested; setKind(requested); setRanked(undefined); setError(''); setStatus('queue');
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
      if (!matchIdRef.current && kindRef.current==='friendly') {
        setStatus('queue');
        void connection.timeout(8000).emitWithAck('joinFriendMatch',{inviteId:inviteRef.current}).then(result=>{if(result.status!==200&&!matchIdRef.current){reset();setStatus('error');setError(result.error??'Özel maç başlatılamadı.');}}).catch(()=>{if(!matchIdRef.current)setError('Özel maç bağlantısı kurulamadı.');});
      } else if (!matchIdRef.current) { setStatus('queue'); connection.emit('quickMatch', { kind: kindRef.current, ...(guestRef.current ? { name: guestRef.current, termsAccepted: true, termsVersion: TERMS_VERSION } : {}) }); }
    });
    connection.on('matchFound', (data: { matchId: string; opponentId: string; opponentName?: string; opponentAccountId?:string; seat: 0 | 1; kind: MatchKind }) => {
      if (socketRef.current !== connection) return;
      completed.current = false; setRanked(undefined); setOpponentDeadline(null);
      matchIdRef.current = data.matchId; setMatchId(data.matchId); setOpponentId(data.opponentId); setSeat(data.seat); setKind(data.kind); kindRef.current = data.kind; setStatus('matched');
      setOpponentName(data.opponentName || 'Rakip');setOpponentAccountId(data.opponentAccountId??null);
    });
    const acceptResult=(result: RankedResult) => { if (result.matchId === matchIdRef.current) { completed.current = result.status === 'completed'; if (completed.current) { setOpponentId(null); setOpponentDeadline(null); } setRanked(result); if (result.reason === 'forfeit') { setStatus('forfeit'); setOpponentDeadline(null); } } };
    connection.on('rankedResult',acceptResult);connection.on('friendlyResult',acceptResult);
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
    const ready=()=>{
      const id=sessionStorage.getItem('golvia:friend-invite');if(!id)return;
      if(socketRef.current&&matchIdRef.current&&!completed.current&&kindRef.current!=='friendly'){setError('Özel maç için önce mevcut maçtan ayrıl.');return;}
      if(completed.current||socketRef.current&&!matchIdRef.current&&kindRef.current!=='friendly')void cancel().then(done=>{if(done)void start('friendly','',id);});else void start('friendly','',id);
    };
    window.addEventListener('golvia:friend-ready',ready);
    if (sessionStorage.getItem('golvia:friend-invite')) ready();
    else if (sessionStorage.getItem('golvia:resume-token')) void start(sessionStorage.getItem('golvia:match-kind') === 'ranked' ? 'ranked' : 'casual');
    return () => { window.removeEventListener('golvia:friend-ready',ready); socketRef.current?.disconnect(); socketRef.current = null; };
  }, [start,cancel]);
  return { playerId, matchId, opponentId, opponentName, opponentAccountId, seat, status, opponentDeadline, start, cancel, socket, kind, ranked, error };
}
