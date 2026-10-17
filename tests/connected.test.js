import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { makeConnection, makePairSync, pairDelta } from '../src/services/connected-store.js';

execFileSync(process.execPath, ['scripts/build-server.mjs']);
test('deployable bundle excludes unsupported logical assignments and newer array methods', () => {
  const code = readFileSync('apps-script/production/Code.gs', 'utf8');
  assert.doesNotMatch(code, /\|\|=|&&=|\?\?=|\.at\(/);
  assert.match(code, /function setupLoveMap\(/);
  assert.match(code, /function doPost\(/);
});
function server() {
  const sheets = new Map();
  const props = new Map([['SPREADSHEET_ID', 'test-sheet']]);
  const makeSheet = () => {
    const rows = [];
    return { rows, getLastRow: () => rows.length, getMaxRows: () => 10000, insertRowsAfter() {}, setFrozenRows() {}, setColumnWidths() {}, setColumnWidth() {},
      deleteRows(start, count) { rows.splice(start - 1, count); },
      getRange(row, column, height = 1, width = 1) { const range = {
        getValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => rows[row - 1 + r]?.[column - 1 + c] ?? '')),
        setValues(values) { values.forEach((line, r) => { rows[row - 1 + r] ||= []; line.forEach((value, c) => { if (typeof value === 'string' && value.startsWith('=')) throw Error('Formula injection'); rows[row - 1 + r][column - 1 + c] = value; }); }); return range; },
        setNumberFormat() { return range; }, setFontWeight() { return range; }, setBackground() { return range; },
      }; return range; },
    };
  };
  let locked = false;
  const context = vm.createContext({ console, Intl, Date, Set, Map, Uint8Array, JSON,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key), setProperty: (key, value) => props.set(key, value) }) },
    SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: key => sheets.get(key), insertSheet: key => { const value = makeSheet(); sheets.set(key, value); return value; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; }, hasLock: () => locked, releaseLock() { locked = false; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    Utilities: { getUuid: randomUUID, formatDate: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), computeHmacSha256Signature: (value, key) => [...createHmac('sha256', key).update(value).digest()] },
  });
  vm.runInContext(readFileSync('apps-script/production/Code.gs', 'utf8'), context);
  context.setupLoveMap();
  const call = (action, payload = {}, token, requestId = randomUUID()) => {
    const output = context.doPost({ postData: { contents: JSON.stringify({ action, payload, sessionToken: token, requestId }) } });
    assert.equal(typeof output.then, 'undefined', 'web handler returns synchronously');
    return JSON.parse(output.text);
  };
  return { call, sheets, context, props };
}
const register = (s, name = '사람A', pin = '1234', inviteCode = '9876') => s.call('auth.create', { name, pin, inviteCode, startedOn: '2024-01-01' }).data;
const join = s => s.call('auth.join', { name: '사람B', pin: '5678', inviteCode: '9876' }).data;

test('production handler authenticates separate members, scopes couples, and stores no raw credentials', () => {
  const s = server(), a = register(s), b = join(s), c = register(s, '다른커플', '2468', '9753');
  assert.equal(b.result.session.pairId, a.result.session.pairId);
  assert.equal(s.call('pair.read', {}, 'forged').ok, false);
  assert.equal(s.call('pair.patch', { fields: { partnerAnswers: { 'who:0': '해킹' } } }, a.sessionToken).ok, false);
  assert.equal(s.call('pair.patch', { pairId: c.result.session.pairId, fields: { answers: { 'who:0': '비밀' } }, visibility: { who: 'partner' } }, a.sessionToken).ok, true);
  assert.equal(s.call('pair.read', {}, b.sessionToken).data.answers['who:0'], '비밀');
  assert.deepEqual(s.call('pair.read', {}, c.sessionToken).data.answers, undefined);
  const rows = JSON.stringify(s.sheets.get('LoveMapData').rows);
  for (const secret of [a.result.recoveryCode, b.result.recoveryCode, a.sessionToken, b.sessionToken, '"pin":"1234"', '"inviteCode":"9876"']) assert.equal(rows.includes(secret), false);
  assert.equal(rows.includes(s.props.get('AUTH_SECRET')), false);
});

test('server preserves the other member, hides private answers, and shares a 27-question cycle across devices', () => {
  const s = server(), a = register(s), b = join(s);
  s.call('pair.patch', { fields: { answers: { 'who:0': '내 답변', 'who:1': '나만 보기' } }, visibility: { who: 'private' } }, a.sessionToken);
  assert.deepEqual(s.call('pair.read', {}, b.sessionToken).data.answers, {});
  s.call('pair.patch', { fields: {}, visibility: { who: 'after_both' } }, a.sessionToken);
  s.call('pair.patch', { fields: { partnerAnswers: { 'who:0': '짝꿍 답변' } } }, b.sessionToken);
  const visible = s.call('pair.read', {}, b.sessionToken).data;
  assert.equal(visible.answers['who:0'], '내 답변'); assert.equal(visible.answers['who:1'], undefined);
  const ids = Array.from({ length: 27 }, (_, i) => s.call('asking.draw', {}, i % 2 ? a.sessionToken : b.sessionToken).data.questionId);
  assert.equal(new Set(ids).size, 27);
  const id = randomUUID(), first = s.call('asking.draw', {}, a.sessionToken, id).data;
  assert.deepEqual(s.call('asking.draw', {}, b.sessionToken, id).data, first);
  const saved = s.call('asking.save', { entryId: first.id, answers: { 여진: '=IMPORTXML("evil")', 민재: '답변B' } }, b.sessionToken);
  assert.equal(saved.ok, true);
  assert.equal(s.call('asking.list', {}, a.sessionToken).data[0].answers.민재, '답변B');
});

test('server shares mini-game moves, rejects stale writes, and uses server check-ins for daily questions', () => {
  const s = server(), a = register(s), b = join(s);
  let game = s.call('dashboard.game.open', { kind: 'tic' }, b.sessionToken).data.games.tic;
  const requestId = randomUUID(), payload = { kind: 'tic', gameId: game.id, revision: game.revision, move: 0 };
  const first = s.call('dashboard.game.move', payload, b.sessionToken, requestId);
  assert.equal(first.data.games.tic.board[0], '민재');
  assert.equal(s.call('dashboard.game.move', payload, b.sessionToken, requestId).ok, true);
  assert.equal(s.call('dashboard.game.move', payload, a.sessionToken).ok, false);
  game = s.call('dashboard.read', {}, a.sessionToken).data.games.tic;
  assert.equal(s.call('dashboard.game.move', { kind: 'tic', gameId: game.id, revision: game.revision, move: 1 }, a.sessionToken).ok, true);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  s.call('pair.patch', { fields: { partnerScores: [{ date: day, score: 19, answers: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, i !== 3])) }] } }, b.sessionToken);
  const daily = s.call('dashboard.daily.sync', { checkins: {} }, a.sessionToken).data.queues.여진;
  assert.equal(daily.activeId, 3);
  assert.equal(s.call('dashboard.daily.answer', { text: '오늘의 답', questionId: 3, version: daily.version }, a.sessionToken).ok, true);
  assert.equal(s.call('dashboard.read', {}, b.sessionToken).data.replies[0].text, '오늘의 답');
});

test('server PIN changes revoke only the owner sessions and recovery works on a new device', () => {
  const s = server(), a = register(s), b = join(s);
  const second = s.call('auth.unlock', { memberId: a.result.session.memberId, pin: '1234' }).data;
  const changed = s.call('auth.changePin', { currentPin: '1234', newPin: '2222' }, a.sessionToken).data;
  assert.equal(s.call('pair.read', {}, second.sessionToken).ok, false);
  assert.equal(s.call('pair.read', {}, b.sessionToken).ok, true);
  assert.equal(s.call('pair.read', {}, changed.sessionToken).ok, true);
  const recovered = s.call('auth.recover', { code: a.result.recoveryCode, newPin: '3333' }).data;
  assert.equal(recovered.result.session.memberId, a.result.session.memberId);
  assert.equal(s.call('auth.recover', { code: a.result.recoveryCode, newPin: '3333' }).ok, false);
  assert.equal(s.call('pair.read', {}, changed.sessionToken).ok, false);
});

test('chunked storage preserves long Unicode and formula-like text while retaining only two complete snapshots', () => {
  const s = server();
  const value = { text: '가'.repeat(39990) + '=SUM(A1:A5)' + '♡'.repeat(50000) };
  for (let i = 0; i < 5; i++) s.context.serverWrite_('test', 'long', { ...value, i });
  assert.equal(s.context.serverRead_('test', 'long', null).value.text, value.text);
  const rows = s.sheets.get('LoveMapData').rows.slice(1);
  assert.equal(new Set(rows.map(row => row[2])).size, 2);
  assert.equal(rows.every(row => String(row[5]).startsWith('"') && String(row[5]).length < 50000), true);
});

test('remote auth uses separate device storage and a new browser reads the same server records', async () => {
  const s = server();
  const memory = () => { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
  const browser = () => makeConnection({ endpoint: 'https://script.google.com/macros/s/test/exec', storage: memory(), tabStorage: memory(), fetcher: async (_url, options) => { const body = JSON.parse(options.body); return { ok: true, json: async () => s.call(body.action, body.payload, body.sessionToken, body.requestId) }; } });
  const first = browser(), second = browser();
  const a = await first.auth.create({ name: 'A', pin: '1234', inviteCode: '9876', startedOn: '2024-01-01' });
  await second.auth.join({ name: 'B', pin: '5678', inviteCode: '9876' });
  await first.request('pair.patch', { fields: {}, discovery: { id: 'note-id', text: '첫 기록' } });
  assert.equal((await second.request('pair.read')).discoveries[0].text, '첫 기록');
  const third = browser();
  assert.deepEqual(third.auth.profiles().profiles, []);
  await third.auth.recover(a.recoveryCode, '2222');
  assert.equal((await third.request('pair.read')).discoveries[0].text, '첫 기록');
  assert.equal(third.auth.profiles().profiles.length, 1);
  assert.equal((await third.auth.getSession()).displayName, 'A');
});

test('pair synchronization preserves edits typed during a request and sends only owned deltas', async () => {
  assert.deepEqual(pairDelta({}, { partnerAnswers: { 'who:0': '상대' } }, '여진'), null);
  let state, resolve, call = 0;
  const sync = makePairSync({ actor: '여진', onState: value => { state = value; }, onError: error => { throw error; }, request: async (action, payload) => {
    if (action === 'pair.read') return { answers: {} };
    call++; if (call === 1) await new Promise(done => { resolve = done; });
    return { answers: { ...payload.fields.answers }, partnerAnswers: { 'who:0': '짝꿍' } };
  } });
  await sync.sync(); sync.update({ ...state, answers: { 'who:0': '첫 글' } });
  const saving = sync.sync();
  await new Promise(done => setImmediate(done));
  sync.update({ ...state, answers: { 'who:0': '수정 중' } }); resolve(); await saving;
  assert.equal(state.answers['who:0'], '수정 중'); assert.equal(state.partnerAnswers['who:0'], '짝꿍');
  sync.stop();
});
