'use client';
import { useEffect, useRef, useState } from 'react';
import type { Action, View } from '@/server/game/engine';
import type { Suggestion } from '@/server/football/types';
import type { Socket } from 'socket.io-client';
import { requestId } from './request-id';
import type { MatchKind, RankedResult } from '@/lib/rating';
export type RemoteMatch = { socket: Socket; matchId: string; playerId: string; seat: 0 | 1; kind?: MatchKind; ranked?: RankedResult };
export function usePractice(remote?: RemoteMatch) {
  const [view, setView] = useState<View | null>(null);
  const [ranked, setRanked] = useState<RankedResult | undefined>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<Action | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [teams, setTeams] = useState<Suggestion[]>([]);
  const [options, setOptions] = useState<Suggestion[]>([]);
  const [optionsKey, setOptionsKey] = useState('');
  const [queryState, setQueryState] = useState({ key: '', value: '' });
  const [searching, setSearching] = useState(false);
  const latest = useRef<View | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const clock = useRef({ at: 0, server: 0, deadline: 0 });
  const phaseKey = view ? `${view.round}:${view.attempt}:${['ready', 'countdown', 'select'].includes(view.phase) ? 'select' : view.phase}` : 'lobby';
  const query = queryState.key === phaseKey ? queryState.value : '';
  function accept(next: View, result?: RankedResult) {
    if (latest.current && (next.revision < latest.current.revision || (next.revision === latest.current.revision && next.serverNow < latest.current.serverNow))) return;
    latest.current = next;
    if (result) setRanked(result);
    clock.current = { at: performance.now(), server: next.serverNow, deadline: next.deadline };
    setView(next);
    setError('');
    setRemaining(Math.max(0, Math.ceil((next.deadline - next.serverNow) / 1000)));
  }
  const remoteSocket = remote?.socket, remoteId = remote?.matchId;
  useEffect(() => {
    if (!remoteSocket || !remoteId) return;
    let active = true;
    const onRanked = (result: RankedResult & { view?: View }) => { if (active && result.matchId === remoteId && result.view) accept(result.view, result); };
    remoteSocket.on('rankedResult', onRanked);
    void remoteSocket.timeout(5000).emitWithAck('getState', { matchId: remoteId }).then(data => {
      if (active && data.view) accept(data.view, data.ranked);
      else if (active) setError(data.error ?? 'Maç okunamadı.');
    }).catch(() => { if (active) setError('Maç bağlantısı kesildi.'); });
    return () => { active = false; remoteSocket.off('rankedResult', onRanked); };
  }, [remoteSocket, remoteId]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/football?kind=catalog', { signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setTeams(data.items); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, []);
  const kind = view?.phase === 'answer' ? 'player' : 'selection';
  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length < 2) return () => controller.abort();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/football?kind=${kind}&q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) { setOptions(data.items.slice(0, 8)); setOptionsKey(`${kind}:${query}`); }
      } catch (e) { if (!controller.signal.aborted) { setOptions([]); setError(e instanceof Error ? e.message : 'Arama başarısız.'); } }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 90);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, query]);
  const running = (!!remote || !!view) && view?.phase !== 'finished' && remote?.ranked?.reason !== 'forfeit' && ranked?.reason !== 'forfeit';
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const gen = generation.current;
    async function poll() {
      try {
        const response = remoteSocket && remoteId
          ? await remoteSocket.timeout(5000).emitWithAck('getState', { matchId: remoteId }).then(data => Response.json(data, { status: data.status }))
          : await fetch('/api/practice', { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (response.status === 401 || response.status === 404) {
          if (!stopped && gen === generation.current) { latest.current = null; setView(null); setRetry(null); }
          throw new Error(data.error);
        }
        if (!response.ok) throw new Error(data.error);
        if (!stopped && gen === generation.current) accept(data.view, data.ranked);
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : 'Bağlantı kesildi.'); }
      if (!stopped) timeout = setTimeout(poll, 250);
    }
    timeout = setTimeout(poll, 250);
    const timer = setInterval(() => { const c = clock.current; setRemaining(Math.max(0, Math.ceil((c.deadline - c.server - (performance.now() - c.at)) / 1000))); }, 100);
    return () => { stopped = true; controller.abort(); clearTimeout(timeout); clearInterval(timer); };
  }, [running, remoteSocket, remoteId]);
  async function start() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setRetry(null);
    generation.current++; latest.current = null;
    // Stop the previous polling generation before creating a fresh match.
    setView(null);
    try {
      const response = await fetch('/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'create' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      accept(data.view);
    } catch (e) { setError(e instanceof Error ? e.message : 'Antrenman başlatılamadı.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function send(action: Action) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {
      const response = remoteSocket && remoteId
        ? await remoteSocket.timeout(5000).emitWithAck('playerAction', { matchId: remoteId, action }).then(data => Response.json(data, { status: data.status }))
        : await fetch('/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
      const data = await response.json();
      if (data.view) accept(data.view, data.ranked);
      if (!response.ok) {
        const message = data.error ?? ({ 'stale-round': 'Bu tur artık kapandı.', 'already-answered': 'Cevap hakkını kullandın.', 'wrong-phase': 'Bu aşamanın süresi doldu.' }[data.receipt?.code as string] ?? 'Eylem kabul edilmedi.');
        if (response.status < 500) { setRetry(null); setError(message); return; }
        throw new Error(message);
      }
      setRetry(null);
    } catch (e) { setRetry(action); setError(e instanceof Error ? e.message : 'Eylem gönderilemedi.'); }
    finally { busy.current = false; setPending(false); }
  }
  function act(type: Action['type'], id: string) {
    const current = latest.current;
    if (!current) return;
    try { void send({ type, id, round: current.round, attempt: current.attempt, requestId: requestId() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Eylem kimliği oluşturulamadı.'); }
  }
  return { view, ranked, error, pending, remaining, teams, options: query.trim().length >= 2 && optionsKey === `${kind}:${query}` ? options : [], searching: query.trim().length >= 2 && (searching || optionsKey !== `${kind}:${query}`), query, setQuery: (value: string) => setQueryState({ key: phaseKey, value }), start, act, retry: retry ? () => void send(retry) : null };
}
