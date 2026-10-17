import test from 'node:test';
import assert from 'node:assert/strict';
import { makePinAuthStore, AUTH_STORAGE_KEY, AUTH_SESSION_KEY } from '../src/services/pin-auth.js';
import { displayIdentityText } from '../src/services/preview-privacy.js';

function memory() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }
function fixture() {
  const storage = memory(), aTab = memory(), bTab = memory();
  let time = Date.parse('2026-10-17T06:00:00Z'), tail = Promise.resolve();
  const lock = task => { const result = tail.then(task); tail = result.catch(() => {}); return result; };
  const options = { now: () => time, iterations: 1000, lock };
  return { storage, aTab, bTab, a: makePinAuthStore(storage, aTab, options), b: makePinAuthStore(storage, bTab, options), advance: ms => { time += ms; }, fresh: () => makePinAuthStore(storage, memory(), options) };
}
const registration = { name: '첫 사람', pin: '1234', inviteCode: '7788', startedOn: '2025-07-06' };

test('each partner has a separate PIN and the shared code cannot unlock either account', async () => {
  const { a, b, storage } = fixture();
  const first = await a.create(registration);
  const second = await b.join({ name: '둘째 사람', pin: '4321', inviteCode: '7788' });
  assert.notEqual(first.session.memberId, second.session.memberId);
  assert.equal(first.session.pairId, second.session.pairId);
  assert.equal(second.session.startedOn, '2025-07-06');
  assert.equal((await a.getSession()).names.민재, '둘째 사람');
  await a.logout(); await b.logout();
  await assert.rejects(a.unlock(first.session.memberId, '7788'));
  await assert.rejects(a.unlock(second.session.memberId, '1234'));
  assert.equal((await a.unlock(first.session.memberId, '1234')).displayName, '첫 사람');
  assert.equal((await b.unlock(second.session.memberId, '4321')).displayName, '둘째 사람');
  const raw = JSON.parse(storage.getItem(AUTH_STORAGE_KEY));
  assert.equal(raw.members[0].pin.iterations, 1000);
  assert.equal(raw.members[0].pin.hash.length, 64);
  assert(!JSON.stringify(raw).includes(first.recoveryCode));
  assert(!JSON.stringify(raw).includes(second.recoveryCode));
  assert.notEqual(raw.members[0].pin.salt, raw.members[1].pin.salt);
});

test('private PINs cannot equal a shared code or the partner PIN, while unrelated spaces may reuse PINs', async () => {
  const { a, b, fresh } = fixture();
  await assert.rejects(a.create({ ...registration, pin: '7788' }), /다르게/);
  await a.create(registration);
  await assert.rejects(b.join({ name: '상대', pin: '7788', inviteCode: '7788' }), /다르게/);
  await assert.rejects(b.join({ name: '상대', pin: '1234', inviteCode: '7788' }), /다른 네 자리/);
  const joined = await b.join({ name: '상대', pin: '4321', inviteCode: '7788' });
  await assert.rejects(b.changePin('4321', '1234'), /다른 네 자리/);
  await assert.rejects(b.changePin('4321', '7788'), /다르게/);
  assert.equal((await fresh().create({ ...registration, inviteCode: '8899' })).session.displayName, registration.name);
  assert.equal(joined.session.linked, true);
});

test('the second participant must match a live code, joins once, and inherits the relationship date', async () => {
  const { a, b, fresh, advance } = fixture();
  await a.create(registration);
  await assert.rejects(fresh().create({ ...registration, pin: '9999' }), /사용 중인 연결 코드/);
  await assert.rejects(b.join({ name: '상대', pin: '4321', inviteCode: '0000' }), /연결 코드/);
  advance(24 * 60 * 60 * 1000 + 1);
  await assert.rejects(b.join({ name: '상대', pin: '4321', inviteCode: '7788' }), /유효기간/);
  await a.unlock(a.profiles().profiles[0].id, '1234');
  await a.renewInvite('1234', '8899');
  const joined = await b.join({ name: '상대', pin: '4321', inviteCode: '8899' });
  assert.equal(joined.session.startedOn, '2025-07-06');
  await assert.rejects(fresh().join({ name: '세 번째', pin: '5678', inviteCode: '8899' }));
  await assert.rejects(a.renewInvite('1234', '9900'), /이미 두 사람/);
});

test('changing my PIN requires my old PIN, revokes my other sessions and preserves the partner session', async () => {
  const { a, b, fresh, aTab } = fixture();
  const first = await a.create(registration);
  await b.join({ name: '상대', pin: '4321', inviteCode: '7788' });
  const anotherDevice = fresh(); await anotherDevice.unlock(first.session.memberId, '1234');
  const oldToken = aTab.getItem(AUTH_SESSION_KEY);
  await assert.rejects(a.changePin('4321', '5678'), /비밀번호/);
  await a.changePin('1234', '5678');
  assert.notEqual(aTab.getItem(AUTH_SESSION_KEY), oldToken);
  assert.equal(await anotherDevice.getSession(), null);
  assert.equal((await b.getSession()).displayName, '상대');
  await a.logout();
  await assert.rejects(a.unlock(first.session.memberId, '1234'));
  assert.equal((await a.unlock(first.session.memberId, '5678')).memberId, first.session.memberId);
});

test('recovery belongs to one person, rotates its code and never recovers the partner account', async () => {
  const { a, b, fresh } = fixture();
  const first = await a.create(registration);
  const second = await b.join({ name: '상대', pin: '4321', inviteCode: '7788' });
  const recovery = fresh();
  const restored = await recovery.recover(first.recoveryCode.toLowerCase(), '5678');
  assert.equal(restored.session.memberId, first.session.memberId);
  assert.equal(await a.getSession(), null);
  assert.equal((await b.getSession()).memberId, second.session.memberId);
  await assert.rejects(fresh().recover(first.recoveryCode, '6789'));
  assert.equal((await fresh().recover(restored.recoveryCode, '6789')).session.memberId, first.session.memberId);
  const renewed = await b.renewRecovery('4321');
  await assert.rejects(fresh().recover(second.recoveryCode, '5555'));
  assert.equal((await fresh().recover(renewed.recoveryCode, '5555')).session.memberId, second.session.memberId);
});

test('five failed PIN attempts create a temporary wait and do not lock the partner', async () => {
  const { a, b, advance } = fixture();
  const first = await a.create(registration);
  const second = await b.join({ name: '상대', pin: '4321', inviteCode: '7788' });
  for (let i = 0; i < 5; i++) await assert.rejects(a.unlock(first.session.memberId, '1111'));
  await assert.rejects(a.unlock(first.session.memberId, '1234'), /5분/);
  assert.equal((await b.unlock(second.session.memberId, '4321')).displayName, '상대');
  advance(5 * 60 * 1000 + 1);
  assert.equal((await a.unlock(first.session.memberId, '1234')).displayName, '첫 사람');
});

test('session expiry still remembers the account but requires its PIN again', async () => {
  const { a, advance } = fixture();
  const first = await a.create({ ...registration, pin: '0000' });
  advance(12 * 60 * 60 * 1000 + 1);
  assert.equal(await a.getSession(), null);
  assert.equal(a.profiles().selectedId, first.session.memberId);
  assert.equal((await a.unlock(first.session.memberId, '0000')).memberId, first.session.memberId);
});

test('invalid PINs and future or impossible relationship dates are rejected before creating an account', async () => {
  const { a } = fixture();
  for (const pin of ['123', '12345', 'a123', '１２３４']) await assert.rejects(a.create({ ...registration, pin }));
  for (const startedOn of ['2026-02-30', '2027-01-01', 'invalid']) await assert.rejects(a.create({ ...registration, startedOn }));
  assert.equal(a.profiles().profiles.length, 0);
});

test('registered display names replace identity labels without rewriting personal answer prose', () => {
  const names = { 여진: 'Alice', 민재: 'Bob' };
  assert.equal(displayIdentityText('여진', false, names), 'Alice');
  assert.equal(displayIdentityText('MINJAE', false, names), 'Bob');
  assert.equal(displayIdentityText('내 친구 여진의 이야기', false, names), '내 친구 여진의 이야기');
  assert.equal(displayIdentityText('여진', true, names), '여보');
});
