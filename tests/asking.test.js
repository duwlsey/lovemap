import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { OPEN_QUESTIONS } from '../src/data/open-questions.js';
import { makeLocalAskingStore, makeAppsScriptAskingStore, recordsForPerson, ASKING_STORAGE_KEY } from '../src/services/asking-store.js';

const memoryStorage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test('27 questions are distinct and repeat only after a complete cycle, across two actors and reloads', async () => {
  assert.equal(OPEN_QUESTIONS.length, 27);
  assert.equal(new Set(OPEN_QUESTIONS.map(q => q.id)).size, 27);
  const storage = memoryStorage();
  let serial = 0;
  const create = actor => makeLocalAskingStore(storage, { actor: () => actor, id: () => `entry-${++serial}`, random: () => 0.4 });
  const seen = new Set();
  for (let i = 0; i < 27; i++) {
    const store = create(i % 2 ? '민재' : '여진');
    const entry = await store.draw(`request-${i}`);
    assert.equal(seen.has(entry.questionId), false);
    seen.add(entry.questionId);
    assert.equal(entry.cycle, 1);
  }
  assert.equal(seen.size, 27);
  const next = await create('민재').draw('request-next');
  assert.equal(next.cycle, 2);
  assert.equal(JSON.parse(storage.getItem(ASKING_STORAGE_KEY)).usedIds.length, 1);
});

test('draw and save retries are idempotent; custom questions leave the deck untouched', async () => {
  const storage = memoryStorage();
  const store = makeLocalAskingStore(storage);
  const first = await store.draw('request-first');
  assert.equal((await store.draw('request-first')).id, first.id);
  const custom = await store.create('  우리만의 질문?  ', 'request-custom');
  assert.equal((await store.create('우리만의 질문?', 'request-custom')).id, custom.id);
  assert.equal(JSON.parse(storage.getItem(ASKING_STORAGE_KEY)).usedIds.length, 1);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.save(custom.id, { 여진: '답변', 민재: '' }));
  const saved = await store.save(custom.id, { 여진: ' 여진의 이야기 ', 민재: '민재의 이야기' });
  await store.save(custom.id, { 여진: 'retry', 민재: 'retry' });
  const entries = await store.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].answers.여진, '여진의 이야기');
  assert.equal(recordsForPerson(entries, '여진')[0].question, '우리만의 질문?');
  assert.equal(recordsForPerson(entries, '민재')[0].text, '민재의 이야기');
  assert.equal(saved.date.length, 10);
});

test('storage failures are surfaced and corrupt data is never silently replaced', async () => {
  const storage = memoryStorage();
  storage.setItem(ASKING_STORAGE_KEY, '{broken');
  await assert.rejects(makeLocalAskingStore(storage).draw());
  assert.equal(storage.getItem(ASKING_STORAGE_KEY), '{broken');
  const full = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  await assert.rejects(makeLocalAskingStore(full).draw(), /full/);
});

test('Apps Script adapter requires a login token, retains request IDs and propagates server errors', async () => {
  const calls = [];
  const store = makeAppsScriptAskingStore({ endpoint: 'https://example.invalid/exec', getIdToken: async () => 'test-token', fetcher: async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, data: { id: 'entry' } }) }; } });
  await store.draw('request-once');
  await store.create('질문', 'request-custom');
  await store.save('entry', { 여진: 'a', 민재: 'b' });
  assert.equal(calls[0].requestId, 'request-once');
  assert.equal(calls[2].answers.민재, 'b');
  const denied = makeAppsScriptAskingStore({ endpoint: '', getIdToken: async () => null });
  await assert.rejects(denied.list(), /로그인/);
  const failed = makeAppsScriptAskingStore({ endpoint: '', getIdToken: async () => 'token', fetcher: async () => ({ ok: true, json: async () => ({ ok: false, error: '저장 실패' }) }) });
  await assert.rejects(failed.list(), /저장 실패/);
});

function appsScriptHarness() {
  const sheets = new Map();
  function newSheet() {
    const cells = [];
    return {
      getLastRow: () => cells.length,
      setFrozenRows() {},
      appendRow: row => cells.push([...row]),
      getRange(row, column, rows = 1, columns = 1) {
        return {
          setValues(values) { values.forEach((valuesRow, i) => { cells[row - 1 + i] ||= []; valuesRow.forEach((value, j) => { cells[row - 1 + i][column - 1 + j] = value; }); }); },
          getValues() { return Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (_, j) => cells[row - 1 + i]?.[column - 1 + j] ?? '')); },
          setValue(value) { cells[row - 1][column - 1] = value; },
        };
      },
    };
  }
  const book = { getSheetByName: name => sheets.get(name), insertSheet: name => { const sheet = newSheet(); sheets.set(name, sheet); return sheet; } };
  let released = 0, locks = 0;
  const properties = { SPREADSHEET_ID: 'test', GOOGLE_CLIENT_ID: 'client', MEMBERS_JSON: JSON.stringify({ 'yeojin@example.com': '여진', 'minjae@example.com': '민재' }) };
  let email = 'yeojin@example.com';
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] }) },
    SpreadsheetApp: { openById: () => book, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() { locks++; }, releaseLock() { released++; } }) },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate: () => '2026-10-17' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ aud: 'client', iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 300, email_verified: 'true', email, sub: email }) }) },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Questions.gs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/DashboardDomain.gs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../apps-script/Dashboard.gs', import.meta.url), 'utf8'), context);
  context.setupLoveMapAsking();
  context.setupLoveMapDashboard();
  const call = input => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ idToken: 'valid', ...input }) } }).text);
  return { context, call, setActor: value => { email = value; }, counts: () => ({ released, locks }) };
}

test('prepared Apps Script uses one shared cycle, saves two voices, and locks every request', () => {
  const { call, context, counts, setActor } = appsScriptHarness();
  const questions = new Set();
  let first;
  for (let i = 0; i < 27; i++) {
    setActor(i % 2 ? 'minjae@example.com' : 'yeojin@example.com');
    const result = call({ action: 'asking.draw', requestId: `request-${i}` });
    assert.equal(result.ok, true);
    assert.equal(result.data.createdBy, i % 2 ? '민재' : '여진');
    assert.equal(questions.has(result.data.questionId), false);
    questions.add(result.data.questionId);
    first ||= result.data;
  }
  assert.equal(call({ action: 'asking.draw', requestId: 'request-0' }).data.id, first.id);
  assert.equal(call({ action: 'asking.draw', requestId: 'request-next' }).data.cycle, 2);
  const custom = call({ action: 'asking.create', requestId: 'custom-question', question: '=질문도 수식이 아님' });
  assert.equal(custom.ok, true);
  assert.equal(custom.data.questionId, null);
  assert.equal(call({ action: 'asking.list' }).data.length, 0);
  setActor('minjae@example.com');
  const saved = call({ action: 'asking.save', entryId: first.id, answers: { 여진: '=1+1', 민재: '민재 답변' } });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.answers.여진, '=1+1');
  assert.equal(saved.data.savedBy, '민재');
  setActor('yeojin@example.com');
  assert.equal(call({ action: 'asking.list' }).data.length, 1);
  assert.equal(call({ action: 'asking.save', entryId: 'missing', answers: {} }).ok, false);
  context.UrlFetchApp.fetch = () => ({ getResponseCode: () => 401 });
  assert.equal(call({ action: 'asking.list' }).ok, false);
  assert.deepEqual(counts().released, counts().locks);
});

test('Apps Script event replay shares moves across actors and makes network retries idempotent', () => {
  const { call, setActor, counts } = appsScriptHarness();
  let result = call({ action: 'dashboard.game.open', requestId: 'dashboard-game-open', payload: { kind: 'tic' } });
  assert.equal(result.ok, true);
  const gameId = result.data.games.tic.id;
  const move = { action: 'dashboard.game.move', requestId: 'dashboard-first-move', payload: { kind: 'tic', gameId, revision: 0, move: 0 } };
  assert.equal(call(move).data.games.tic.revision, 1);
  assert.equal(call(move).data.games.tic.revision, 1);
  setActor('minjae@example.com');
  result = call({ action: 'dashboard.read' });
  assert.equal(result.data.games.tic.turn, '민재');
  result = call({ action: 'dashboard.game.move', requestId: 'dashboard-second-move', payload: { kind: 'tic', gameId, revision: 1, move: 4 } });
  assert.equal(result.data.games.tic.board[4], '민재');
  assert.equal(call({ action: 'dashboard.read' }).data.games.tic.revision, 2);
  assert.equal(counts().released, counts().locks);
});
