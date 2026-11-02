'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
export function useQuickMatch() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [seat, setSeat] = useState<0 | 1>(0);
  const [status, setStatus] = useState<'idle' | 'queue' | 'matched' | 'opponent-wait' | 'reconnecting' | 'error'>('idle');
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const cancel = useCallback(() => {
    socketRef.current?.emit('quitQueue'); socketRef.current?.disconnect(); socketRef.current = null;
    sessionStorage.removeItem('golvia:resume-token');
    setSocket(null); setStatus('idle'); setMatchId(null); setOpponentId(null); setPlayerId(null);
  }, []);
  const start = useCallback(async () => {
    if (socketRef.current) return;
    setStatus('queue');
    const url = process.env.NEXT_PUBLIC_WS_URL || `${location.protocol}//${location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT || '3001'}`;
    const connection = io(url, { autoConnect: false, reconnection: true, reconnectionAttempts: 8, auth: { resumeToken: sessionStorage.getItem('golvia:resume-token') } });
    socketRef.current = connection; setSocket(connection);
    connection.on('playerId', (id: string) => setPlayerId(id));
    connection.on('session', (data: { playerId: string; resumeToken: string }) => {
      setPlayerId(data.playerId);
      sessionStorage.setItem('golvia:resume-token', data.resumeToken);
    });
    connection.on('connect', () => { setStatus('queue'); connection.emit('quickMatch'); });
    connection.on('matchFound', (data: { matchId: string; opponentId: string; seat: 0 | 1 }) => {
      setMatchId(data.matchId); setOpponentId(data.opponentId); setSeat(data.seat); setStatus('matched');
    });
    connection.on('matchCancelled', () => { cancel(); setStatus('error'); });
    connection.on('opponentDisconnected', () => setStatus('opponent-wait'));
    connection.on('opponentResumed', () => setStatus('matched'));
    connection.on('matchError', () => { cancel(); setStatus('error'); });
    connection.on('connect_error', () => setStatus('reconnecting'));
    connection.io.on('reconnect_failed', () => { cancel(); setStatus('error'); });
    connection.on('disconnect', reason => { if (reason !== 'io client disconnect') setStatus('reconnecting'); });
    connection.connect();
  }, [cancel]);
  useEffect(() => {
    if (sessionStorage.getItem('golvia:resume-token')) void start();
    return () => { socketRef.current?.disconnect(); socketRef.current = null; };
  }, [start]);
  return { playerId, matchId, opponentId, seat, status, start, cancel, socket };
}
