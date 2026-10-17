const DEVICE_KEY = 'love-map-connected-device-v1';
const TOKEN_KEY = 'love-map-connected-session-v1';
const copy = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function makeConnection({ endpoint, storage, tabStorage, fetcher = fetch }) {
  if (endpoint && !/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(endpoint)) throw new Error('Apps Script 배포 주소를 확인해주세요.');
  async function request(action, payload = {}, requestId) {
    if (!endpoint) throw new Error('실제 저장소를 연결하는 중이에요. 지금은 미리보기를 이용해주세요.');
    let response;
    try {
      response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, payload, requestId, sessionToken: tabStorage.getItem(TOKEN_KEY) }), redirect: 'follow' });
    } catch { throw new Error('저장 서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'); }
    if (!response.ok) throw new Error('저장 서버에 연결하지 못했어요. 다시 시도해주세요.');
    let result;
    try { result = await response.json(); } catch { throw new Error('저장 서버의 배포 권한과 주소를 확인해주세요.'); }
    if (!result.ok) throw new Error(result.error || '저장하지 못했어요. 다시 시도해주세요.');
    return result.data;
  }
  const readDevice = () => JSON.parse(storage.getItem(DEVICE_KEY) || '{"profiles":[],"selectedId":null}');
  function remember(id) { const device = readDevice(); device.selectedId = id; storage.setItem(DEVICE_KEY, JSON.stringify(device)); }
  function rememberSession(session) {
    if (!session) return;
    const device = readDevice();
    device.profiles = [...device.profiles.filter(row => row.id !== session.memberId), { id: session.memberId, name: session.displayName }];
    device.selectedId = session.memberId; storage.setItem(DEVICE_KEY, JSON.stringify(device));
  }
  async function authCall(action, payload) {
    const data = await request('auth.' + action, payload);
    if (data.sessionToken) tabStorage.setItem(TOKEN_KEY, data.sessionToken); else tabStorage.removeItem(TOKEN_KEY);
    rememberSession(data.result?.session || (data.result?.memberId ? data.result : null));
    return data.result;
  }
  const auth = {
    profiles: readDevice, remember,
    getSession: () => tabStorage.getItem(TOKEN_KEY) ? authCall('session') : Promise.resolve(null),
    create: payload => authCall('create', payload), join: payload => authCall('join', payload),
    unlock: (memberId, pin) => authCall('unlock', { memberId, pin }),
    changePin: (currentPin, newPin) => authCall('changePin', { currentPin, newPin }),
    recover: (code, newPin) => authCall('recover', { code, newPin }),
    renewRecovery: currentPin => authCall('renewRecovery', { currentPin }),
    renewInvite: (currentPin, inviteCode) => authCall('renewInvite', { currentPin, inviteCode }),
    logout: async () => { await authCall('logout'); tabStorage.removeItem(TOKEN_KEY); },
  };
  const retries = new Map();
  async function mutation(action, payload) {
    const key = JSON.stringify([action, payload]);
    if (!retries.has(key)) retries.set(key, crypto.randomUUID());
    const result = await request(action, payload, retries.get(key)); retries.delete(key); return result;
  }
  return { auth, request,
    asking: {
      list: () => request('asking.list'),
      draw: requestId => request('asking.draw', {}, requestId || crypto.randomUUID()),
      create: (question, requestId) => request('asking.create', { question }, requestId || crypto.randomUUID()),
      save: (entryId, answers) => request('asking.save', { entryId, answers }),
    },
    dashboard: { read: () => request('dashboard.read'), act: (_actor, action, payload = {}) => mutation('dashboard.' + action, payload) },
  };
}

// Send only this member's changed fields. Other devices' changes to unrelated
// answers and the partner's records are never replaced by an old whole snapshot.
export function pairDelta(base, next, actor) {
  const fields = {}, own = actor === '여진';
  for (const key of own ? ['answers', 'answerUpdatedAt', 'scores', 'readPartnerUpdates', 'readPartnerAnswers'] : ['partnerAnswers', 'partnerAnswerUpdates', 'partnerScores']) {
    if (key === 'scores' || key === 'partnerScores') {
      if (!equal(base[key] || [], next[key] || [])) fields[key] = next[key] || [];
    } else {
      const changes = Object.fromEntries(Object.entries(next[key] || {}).filter(([id, value]) => !equal(base[key]?.[id], value)));
      if (Object.keys(changes).length) fields[key] = changes;
    }
  }
  const result = { fields };
  if (!equal(base.personReads?.[actor], next.personReads?.[actor]) && next.personReads?.[actor]) result.reads = next.personReads[actor];
  const visibility = Object.fromEntries(Object.keys(next).filter(key => key.startsWith('vis_') && next[key] !== base[key]).map(key => [key.slice(4), next[key]]));
  if (Object.keys(visibility).length) result.visibility = visibility;
  const discovery = (next.discoveries || []).find(row => row.who === actor && !(base.discoveries || []).some(old => String(old.id) === String(row.id)));
  if (discovery) result.discovery = discovery;
  if (!equal(base.game, next.game) && next.game) result.mainGame = next.game;
  return Object.keys(fields).length || result.reads || result.visibility || result.discovery || result.mainGame ? result : null;
}
function applyDelta(state, delta, actor) {
  if (!delta) return state;
  for (const [key, value] of Object.entries(delta.fields)) state[key] = Array.isArray(value) ? value : { ...state[key], ...value };
  if (delta.reads) state.personReads = { ...state.personReads, [actor]: delta.reads };
  if (delta.visibility) for (const [key, value] of Object.entries(delta.visibility)) state['vis_' + key] = value;
  if (delta.discovery && !(state.discoveries || []).some(row => String(row.id) === String(delta.discovery.id))) state.discoveries = [delta.discovery, ...(state.discoveries || [])];
  if (delta.mainGame) state.game = delta.mainGame;
  return state;
}
export function makePairSync({ request, actor, onState, onError, onSaved = () => {} }) {
  let base = {}, latest = {}, stopped = false, loaded = false, chain = Promise.resolve();
  const normalize = state => {
    state = copy(state);
    for (const [key, value] of Object.entries(state.visibility?.[actor] || {})) state['vis_' + key] = value;
    return state;
  };
  function publish(remote, sent = latest) {
    const pending = pairDelta(sent, latest, actor);
    base = normalize(remote); latest = applyDelta(copy(base), pending, actor);
    if (!stopped) onState(copy(latest));
  }
  async function run(refresh) {
    if (stopped) return;
    if (!loaded) { base = normalize(await request('pair.read')); latest = copy(base); loaded = true; if (!stopped) onState(copy(latest)); return; }
    let delta, count = 0;
    while ((delta = pairDelta(base, latest, actor)) && count++ < 50 && !stopped) {
      const sent = copy(latest), remote = await request('pair.patch', delta);
      // One discovery is appended per request; preserve remaining unsent notes.
      const unsent = (latest.discoveries || []).filter(row => row.who === actor && !(remote.discoveries || []).some(saved => String(saved.id) === String(row.id)));
      publish(remote, sent);
      latest.discoveries = [...unsent, ...(latest.discoveries || [])];
      if (!stopped && unsent.length) onState(copy(latest));
      if (!stopped) onSaved();
    }
    if (refresh && !stopped) { const sent = copy(latest); publish(await request('pair.read'), sent); }
  }
  return {
    update: value => { if (loaded && !stopped) latest = copy(value); },
    sync(refresh = false) { chain = chain.catch(() => {}).then(() => run(refresh)).catch(error => { if (!stopped) onError(error); }); return chain; },
    flush() { chain = chain.catch(() => {}).then(() => run(false)); return chain; },
    hasPending() { return loaded && Boolean(pairDelta(base, latest, actor)); },
    stop() { stopped = true; },
  };
}
