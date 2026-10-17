import { useCallback, useEffect, useRef } from 'react';
import { makePairSync } from './connected-store.js';

export function useConnectedPair({ connection, auth, previewMode, state, defaultState, setState, setLoadedPair, setAuthError }) {
  const syncRef = useRef(null);
  useEffect(() => {
    if (!connection || !auth || previewMode) return;
    let ready = false;
    let initialPair = connection.takeInitialPair?.();
    const request = (action, ...args) => { if (action === 'pair.read' && initialPair !== undefined) { const value = initialPair; initialPair = undefined; return Promise.resolve(value); } return connection.request(action, ...args); };
    const sync = makePairSync({ request, actor: auth.slot,
      onState: remote => {
        setState(previous => ({ ...defaultState, ...remote, ...(ready ? { test: previous.test, lastTestResult: previous.lastTestResult } : {}) }));
        ready = true; setLoadedPair(auth.pairId); setAuthError('');
      },
      onError: error => setAuthError(error.message + (ready ? ' 변경 내용은 이 화면에 남아 있어요. 연결되면 다시 저장해요.' : ' 연결을 다시 시도하고 있어요.')),
    });
    syncRef.current = sync; sync.sync(true);
    const tick = () => { if (document.visibilityState !== 'hidden') sync.sync(true); };
    const timer = setInterval(tick, 10000);
    const leaving = event => { if (sync.hasPending()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leaving);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); window.removeEventListener('beforeunload', leaving); sync.stop(); if (syncRef.current === sync) syncRef.current = null; };
  }, [connection, auth?.memberId, auth?.pairId, previewMode]);
  useEffect(() => {
    if (!syncRef.current) return;
    const sync = syncRef.current; sync.update(state);
    const timer = setTimeout(() => sync.sync(), 900);
    return () => clearTimeout(timer);
  }, [state, connection, auth?.memberId, previewMode]);
  return useCallback(() => syncRef.current?.flush() || Promise.resolve(), []);
}
