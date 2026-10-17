import { dashboardAction, emptyDashboard, seoulDay } from './dashboard-domain.js';
export const DASHBOARD_STORAGE_KEY = 'love-map-dashboard-v1';

export function makeDashboardStore(storage, { lock = task => task(), date = seoulDay, id = () => crypto.randomUUID(), storageKey = DASHBOARD_STORAGE_KEY } = {}) {
  const read = () => {
    const raw = storage.getItem(storageKey);
    const state = raw ? JSON.parse(raw) : emptyDashboard();
    if (!state.queues || !Array.isArray(state.replies) || !state.games) throw new Error('저장된 데이터를 읽을 수 없어요.');
    return state;
  };
  return {
    async read() { return read(); },
    async act(actor, action, payload = {}, checkins = {}) {
      return lock(() => {
        const next = dashboardAction(read(), actor, action, payload, { day: date(), id: id(), checkins });
        storage.setItem(storageKey, JSON.stringify(next));
        return structuredClone(next);
      });
    },
  };
}

export function makeAppsScriptDashboardStore({ endpoint, getIdToken, fetcher = fetch }) {
  const retries = new Map();
  async function request(action, payload = {}) {
    const token = await getIdToken();
    if (!token) throw new Error('다시 로그인해주세요.');
    const key = JSON.stringify([action, payload]);
    if (!retries.has(key)) retries.set(key, crypto.randomUUID());
    const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'dashboard.' + action, payload, requestId: retries.get(key), idToken: token }), redirect: 'follow' });
    if (!response.ok) throw new Error('저장 서버에 연결할 수 없어요.');
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || '저장하지 못했어요. 다시 시도해주세요.');
    retries.delete(key);
    return result.data;
  }
  return { read: () => request('read'), act: (_actor, action, payload) => request(action, payload) };
}
