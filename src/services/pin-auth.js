export const AUTH_STORAGE_KEY = 'love-map-pin-accounts-v1';
export const AUTH_SESSION_KEY = 'love-map-pin-session-v1';
export const AUTH_DEVICE_KEY = 'love-map-pin-device-v1';
const PIN_PATTERN = /^\d{4}$/;
const SESSION_MS = 12 * 60 * 60 * 1000;
const INVITE_MS = 24 * 60 * 60 * 1000;
const WAIT_MS = 5 * 60 * 1000;
const text = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const random = bytes => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', text.encode(value)));
const normalizeRecovery = value => String(value || '').replace(/[\s-]/g, '').toUpperCase();
const recoveryCode = () => random(16).toUpperCase().match(/.{4}/g).join('-');

function validatePin(pin) {
  if (!PIN_PATTERN.test(pin)) throw new Error('비밀번호는 숫자 4자리로 입력해주세요.');
}
function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 20) throw new Error('이름을 20자 이내로 적어주세요.');
  return name.trim();
}
async function pinHash(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', text.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: text.encode(salt), iterations, hash: 'SHA-256' }, key, 256));
}
async function makePin(pin, iterations) {
  validatePin(pin);
  const salt = random(16);
  return { salt, iterations, hash: await pinHash(pin, salt, iterations) };
}

// Local prototype. The final connected version must run these operations on the
// server; browser storage and client-side throttling are not a security boundary.
export function makePinAuthStore(storage, tabStorage, { now = Date.now, iterations = 600000, lock = task => task() } = {}) {
  const read = () => {
    const raw = storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { version: 1, pairs: [], members: [], sessions: [], attempts: {} };
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.pairs) || !Array.isArray(data.members) || !Array.isArray(data.sessions)) throw new Error('계정 정보를 읽지 못했어요.');
    return data;
  };
  const write = data => storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
  const remember = memberId => storage.setItem(AUTH_DEVICE_KEY, memberId);
  const publicSession = (data, member) => {
    const pair = data.pairs.find(item => item.id === member.pairId);
    const members = data.members.filter(item => item.pairId === pair.id);
    return { memberId: member.id, pairId: pair.id, slot: member.slot, displayName: member.name, startedOn: pair.startedOn, linked: members.length === 2, names: Object.fromEntries(['여진', '민재'].map(slot => [slot, members.find(item => item.slot === slot)?.name || '상대방'])) };
  };
  async function startSession(data, member) {
    const token = random(32);
    data.sessions = data.sessions.filter(session => session.expiresAt > now());
    data.sessions.push({ tokenHash: await digest(token), memberId: member.id, expiresAt: now() + SESSION_MS });
    write(data);
    tabStorage.setItem(AUTH_SESSION_KEY, token);
    remember(member.id);
    return publicSession(data, member);
  }
  async function requireSession(data) {
    const token = tabStorage.getItem(AUTH_SESSION_KEY);
    if (!token) throw new Error('다시 입장해주세요.');
    const tokenHash = await digest(token);
    const session = data.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > now());
    const member = session && data.members.find(item => item.id === session.memberId);
    if (!member) { tabStorage.removeItem(AUTH_SESSION_KEY); throw new Error('다시 입장해주세요.'); }
    return member;
  }
  function checkWait(data, key) {
    if (data.attempts[key]?.blockedUntil > now()) throw new Error('잠시 쉬었다가 다시 시도해주세요. 5분 뒤에 입장할 수 있어요.');
  }
  function fail(data, key, message) {
    const previous = data.attempts[key];
    const count = previous?.blockedUntil && previous.blockedUntil <= now() ? 1 : (previous?.count || 0) + 1;
    data.attempts[key] = { count, blockedUntil: count >= 5 ? now() + WAIT_MS : 0 };
    write(data);
    throw new Error(count >= 5 ? '다섯 번 틀렸어요. 5분 뒤에 다시 시도해주세요.' : message);
  }
  async function verifyPin(data, member, pin) {
    validatePin(pin);
    const key = 'pin:' + member.id;
    checkWait(data, key);
    if (await pinHash(pin, member.pin.salt, member.pin.iterations) !== member.pin.hash) fail(data, key, '비밀번호를 확인해주세요.');
    delete data.attempts[key];
  }
  async function memberRecord(name, pin, pairId, slot) {
    const code = recoveryCode();
    return { member: { id: crypto.randomUUID(), pairId, slot, name, pin: await makePin(pin, iterations), recoveryHash: await digest(normalizeRecovery(code)) }, code };
  }
  async function requirePrivatePin(data, pair, pin, memberId) {
    if ((pair.sharedCodeHashes || []).includes(await digest('invite:' + pin))) throw new Error('개인 비밀번호와 두 사람의 연결 코드는 다르게 정해주세요.');
    for (const other of data.members.filter(item => item.pairId === pair.id && item.id !== memberId)) {
      if (await pinHash(pin, other.pin.salt, other.pin.iterations) === other.pin.hash) throw new Error('이 개인 비밀번호는 사용할 수 없어요. 다른 네 자리로 정해주세요.');
    }
  }
  return {
    profiles() {
      const data = read();
      return { selectedId: storage.getItem(AUTH_DEVICE_KEY), profiles: data.members.map(member => ({ id: member.id, name: member.name })) };
    },
    remember,
    async getSession() {
      const data = read();
      try { return publicSession(data, await requireSession(data)); }
      catch (error) { if (error.message === '다시 입장해주세요.') return null; throw error; }
    },
    async create({ name, pin, inviteCode, startedOn }) {
      name = validateName(name); validatePin(pin); validatePin(inviteCode);
      if (pin === inviteCode) throw new Error('개인 비밀번호와 두 사람의 연결 코드는 다르게 정해주세요.');
      const day = new Date(startedOn + 'T00:00:00Z');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now()));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== startedOn || startedOn > today) throw new Error('사귀기 시작한 날짜를 확인해주세요.');
      return lock(async () => {
        const data = read(), inviteHash = await digest('invite:' + inviteCode);
        if (data.pairs.some(pair => pair.inviteHash === inviteHash && pair.inviteExpiresAt > now())) throw new Error('사용 중인 연결 코드예요. 상대방 연결하기를 이용해주세요.');
        const pair = { id: crypto.randomUUID(), startedOn, inviteHash, sharedCodeHashes: [inviteHash], inviteExpiresAt: now() + INVITE_MS };
        const { member, code } = await memberRecord(name, pin, pair.id, '여진');
        data.pairs.push(pair); data.members.push(member);
        return { session: await startSession(data, member), recoveryCode: code, inviteCode };
      });
    },
    async join({ name, pin, inviteCode }) {
      name = validateName(name); validatePin(pin); validatePin(inviteCode);
      return lock(async () => {
        const data = read(); checkWait(data, 'join');
        const inviteHash = await digest('invite:' + inviteCode);
        const pair = data.pairs.find(item => item.inviteHash === inviteHash && item.inviteExpiresAt > now());
        if (!pair) fail(data, 'join', '연결 코드를 확인해주세요. 코드의 유효기간은 하루예요.');
        const members = data.members.filter(item => item.pairId === pair.id);
        if (members.length >= 2) throw new Error('이미 두 사람이 연결된 공간이에요.');
        if (members.some(member => member.name === name)) throw new Error('상대방과 다른 표시 이름을 적어주세요.');
        await requirePrivatePin(data, pair, pin);
        const { member, code } = await memberRecord(name, pin, pair.id, '민재');
        data.members.push(member); pair.inviteHash = null; pair.inviteExpiresAt = 0; delete data.attempts.join;
        return { session: await startSession(data, member), recoveryCode: code };
      });
    },
    async unlock(memberId, pin) {
      return lock(async () => {
        const data = read(), member = data.members.find(item => item.id === memberId);
        if (!member) throw new Error('이 기기에서 사용할 계정을 먼저 연결해주세요.');
        await verifyPin(data, member, pin);
        return startSession(data, member);
      });
    },
    async changePin(currentPin, newPin) {
      validatePin(newPin);
      return lock(async () => {
        const data = read(), member = await requireSession(data);
        await verifyPin(data, member, currentPin);
        await requirePrivatePin(data, data.pairs.find(pair => pair.id === member.pairId), newPin, member.id);
        member.pin = await makePin(newPin, iterations);
        data.sessions = data.sessions.filter(session => session.memberId !== member.id);
        return startSession(data, member);
      });
    },
    async recover(code, newPin) {
      validatePin(newPin);
      return lock(async () => {
        const data = read(); checkWait(data, 'recovery');
        const hash = await digest(normalizeRecovery(code));
        const member = data.members.find(item => item.recoveryHash === hash);
        if (!member) fail(data, 'recovery', '복구 코드를 확인해주세요.');
        await requirePrivatePin(data, data.pairs.find(pair => pair.id === member.pairId), newPin, member.id);
        const nextCode = recoveryCode();
        member.recoveryHash = await digest(normalizeRecovery(nextCode));
        member.pin = await makePin(newPin, iterations);
        data.sessions = data.sessions.filter(session => session.memberId !== member.id);
        delete data.attempts.recovery; delete data.attempts['pin:' + member.id];
        return { session: await startSession(data, member), recoveryCode: nextCode };
      });
    },
    async renewRecovery(currentPin) {
      return lock(async () => {
        const data = read(), member = await requireSession(data);
        await verifyPin(data, member, currentPin);
        const code = recoveryCode();
        member.recoveryHash = await digest(normalizeRecovery(code));
        write(data);
        return { recoveryCode: code };
      });
    },
    async renewInvite(currentPin, inviteCode) {
      validatePin(inviteCode);
      return lock(async () => {
        const data = read(), member = await requireSession(data);
        await verifyPin(data, member, currentPin);
        const pair = data.pairs.find(item => item.id === member.pairId);
        if (data.members.filter(item => item.pairId === pair.id).length >= 2) throw new Error('이미 두 사람이 연결되어 있어요.');
        const hash = await digest('invite:' + inviteCode);
        if (await pinHash(inviteCode, member.pin.salt, member.pin.iterations) === member.pin.hash) throw new Error('연결 코드는 개인 비밀번호와 다르게 정해주세요.');
        if (data.pairs.some(item => item.id !== pair.id && item.inviteHash === hash && item.inviteExpiresAt > now())) throw new Error('다른 연결 코드를 정해주세요.');
        pair.inviteHash = hash; pair.sharedCodeHashes = [...new Set([...(pair.sharedCodeHashes || []), hash])]; pair.inviteExpiresAt = now() + INVITE_MS; write(data);
      });
    },
    async logout() {
      return lock(async () => {
        const data = read(), token = tabStorage.getItem(AUTH_SESSION_KEY);
        if (token) { const hash = await digest(token); data.sessions = data.sessions.filter(item => item.tokenHash !== hash); write(data); }
        tabStorage.removeItem(AUTH_SESSION_KEY);
      });
    },
  };
}
