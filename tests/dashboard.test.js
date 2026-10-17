import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { blankGame, boardOutcome, commitGameMove, dashboardAction, emptyDashboard, syncDailyQueue } from '../src/services/dashboard-domain.js';
import { makeDashboardStore } from '../src/services/dashboard-store.js';

const record = (date, falseIds, created_at) => ({ date, created_at, answers: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, !falseIds.includes(i)])) });
test('daily questions rotate missed days to the end, including days without a visit', () => {
  const source = record('2026-10-17', [1, 3, 8]);
  let queue = syncDailyQueue(null, source, '2026-10-17');
  assert.equal(queue.activeId, 1);
  queue = syncDailyQueue(queue, source, '2026-10-18');
  assert.equal(queue.activeId, 3);
  assert.deepEqual(queue.remaining, [3, 8, 1]);
  queue = syncDailyQueue(queue, source, '2026-10-20');
  assert.equal(queue.activeId, 1);
  assert.deepEqual(queue.remaining, [1, 3, 8]);
  const lateFirstVisit = syncDailyQueue(null, source, '2026-10-19');
  assert.equal(lateFirstVisit.activeId, 8);
});

test('answering removes a question and exposes the original question with the answer to the partner', () => {
  const state = emptyDashboard();
  const checkins = { 민재: [record('2026-10-17', [0, 2])] };
  const context = { day: '2026-10-17', id: 'reply-one', checkins };
  dashboardAction(state, '여진', 'daily.sync', {}, context);
  assert.equal(state.queues.여진.activeId, 0);
  dashboardAction(state, '여진', 'daily.answer', { questionId: 0, version: state.queues.여진.version, text: '  나의 가장 친한 친구  ' }, context);
  assert.equal(state.replies.length, 1);
  assert.equal(state.replies[0].recipient, '민재');
  assert.match(state.replies[0].question, /친구/);
  assert.equal(state.replies[0].text, '나의 가장 친한 친구');
  assert.throws(() => dashboardAction(state, '여진', 'daily.answer', { questionId: 0, version: state.queues.여진.version, text: '중복' }, context));
  dashboardAction(state, '여진', 'daily.sync', {}, { ...context, day: '2026-10-18' });
  assert.equal(state.queues.여진.activeId, 2);
  dashboardAction(state, '여진', 'daily.answer', { questionId: 2, version: state.queues.여진.version, text: '다음 답변' }, { ...context, day: '2026-10-18', id: 'reply-two' });
  dashboardAction(state, '여진', 'daily.sync', {}, { ...context, day: '2026-10-19' });
  assert.equal(state.queues.여진.activeId, null);
});

test('only the latest check-in in the current month applies and absent X entries produce no prompt', () => {
  const state = emptyDashboard();
  const context = { day: '2026-10-17', id: 'sync', checkins: { 민재: [record('2026-09-30', [5]), record('2026-10-17', [2], '2026-10-17T01:00:00Z'), record('2026-10-17', [4], '2026-10-17T02:00:00Z')] } };
  dashboardAction(state, '여진', 'daily.sync', {}, context);
  assert.equal(state.queues.여진.activeId, 4);
  assert.equal(syncDailyQueue(null, record('2026-09-30', [1]), '2026-10-17').activeId, null);
  assert.equal(syncDailyQueue(null, record('2026-10-17', []), '2026-10-17').activeId, null);
  assert.equal(syncDailyQueue(null, { date: '2026-10-17', answers: {} }, '2026-10-17').activeId, null);
  assert.equal(syncDailyQueue(state.queues.여진, null, '2026-11-01').activeId, null);
});

test('a refreshed check-in does not create a second question after an answer on the same day', () => {
  const replies = [{ author: '여진', date: '2026-10-17' }];
  const previous = syncDailyQueue(null, record('2026-10-17', [1]), '2026-10-17');
  const updated = syncDailyQueue(previous, record('2026-10-17', [2]), '2026-10-17', replies);
  assert.equal(updated.answered, true);
  assert.equal(updated.activeId, null);
  const next = syncDailyQueue(updated, record('2026-10-17', [2]), '2026-10-18', replies);
  assert.equal(next.activeId, 2);
});

test('tic tac toe alternates turns, prevents stale or occupied moves, and detects wins and draws', () => {
  let game = blankGame('tic', 'first');
  for (const [actor, move] of [['여진', 0], ['민재', 3], ['여진', 1], ['민재', 4], ['여진', 2]]) game = commitGameMove(game, actor, move, game.revision);
  assert.equal(game.winner, '여진');
  assert.equal(game.finished, true);
  assert.throws(() => commitGameMove(game, '민재', 5, game.revision));
  const fresh = commitGameMove(blankGame('tic', 'second'), '여진', 0, 0);
  assert.throws(() => commitGameMove(fresh, '여진', 1, 1));
  assert.throws(() => commitGameMove(fresh, '민재', 0, 1));
  assert.throws(() => commitGameMove(fresh, '민재', 1, 0));
  assert.equal(boardOutcome(['여진', '민재', '여진', '여진', '민재', '민재', '민재', '여진', '여진'], 3, 3, 8).winner, null);
  assert.equal(boardOutcome(['여진', '민재', '여진', '여진', '민재', '민재', '민재', '여진', '여진'], 3, 3, 8).finished, true);
});

test('either person can start every game, then turns alternate without stealing an active turn', () => {
  for (const kind of ['tic', 'gomoku', 'punch']) {
    for (const person of ['여진', '민재']) {
      const state = emptyDashboard();
      const context = { day: '2026-10-17', id: 'open' };
      dashboardAction(state, person, 'game.open', { kind }, context);
      assert.equal(state.games[kind].turn, null);
      const first = commitGameMove(state.games[kind], person, kind === 'punch' ? 700 : 0, 0);
      assert.equal(first.startedBy, person);
      assert.notEqual(first.turn, person);
      state.games[kind] = first;
      dashboardAction(state, person, 'game.open', { kind }, context);
      assert.equal(state.games[kind].turn, first.turn);
      assert.throws(() => commitGameMove(first, person, 1, 1));
    }
  }
});

test('gomoku checks horizontal, vertical and both diagonals without wrapping edges', () => {
  for (const indexes of [[1, 2, 3, 4, 5], [3, 18, 33, 48, 63], [0, 16, 32, 48, 64], [14, 28, 42, 56, 70]]) {
    const board = Array(225).fill(null); indexes.forEach(index => { board[index] = '여진'; });
    assert.equal(boardOutcome(board, 15, 5, indexes.at(-1)).winner, '여진');
  }
  const board = Array(225).fill(null); [12, 13, 14, 15, 16].forEach(index => { board[index] = '여진'; });
  assert.equal(boardOutcome(board, 15, 5, 14).finished, false);
  assert.equal(commitGameMove(blankGame('gomoku', 'g'), '여진', 224, 0).board[224], '여진');
});

test('punch accepts 0 and 1000, rejects invalid values, and determines winners and ties', () => {
  let game = blankGame('punch', 'p');
  assert.throws(() => commitGameMove(game, '여진', 1001, 0));
  assert.throws(() => commitGameMove(game, '여진', 1.5, 0));
  game = commitGameMove(game, '여진', 0, 0);
  assert.equal(game.finished, false);
  game = commitGameMove(game, '민재', 1000, 1);
  assert.equal(game.winner, '민재');
  const tie = commitGameMove(commitGameMove(blankGame('punch', 'tie'), '여진', 500, 0), '민재', 500, 1);
  assert.equal(tie.finished, true); assert.equal(tie.winner, null);
});

test('closing a result resets the board while preserving the unseen opponent result', () => {
  const state = emptyDashboard();
  const act = (actor, action, payload, id) => dashboardAction(state, actor, action, payload, { day: '2026-10-17', id });
  act('여진', 'game.open', { kind: 'punch' }, 'match');
  act('여진', 'game.move', { kind: 'punch', gameId: 'match', revision: 0, move: 800 }, 'move-one');
  act('민재', 'game.move', { kind: 'punch', gameId: 'match', revision: 1, move: 600 }, 'move-two');
  assert.equal(state.pendingResults.민재.punch.winner, '여진');
  act('여진', 'game.dismiss', { kind: 'punch', gameId: 'match' }, 'new-match');
  assert.equal(state.games.punch.id, 'new-match');
  assert.equal(state.pendingResults.여진.punch, undefined);
  assert.equal(state.pendingResults.민재.punch.id, 'match');
  act('민재', 'game.dismiss', { kind: 'punch', gameId: 'match' }, 'unused');
  assert.equal(state.games.punch.id, 'new-match');
});

test('two stores share committed turns and persist a match across reloads', async () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const yeojin = makeDashboardStore(storage, { id: () => 'match', date: () => '2026-10-17' });
  const minjae = makeDashboardStore(storage);
  await yeojin.act('여진', 'game.open', { kind: 'tic' });
  await yeojin.act('여진', 'game.move', { kind: 'tic', gameId: 'match', revision: 0, move: 0 });
  assert.equal((await minjae.read()).games.tic.turn, '민재');
  await minjae.act('민재', 'game.move', { kind: 'tic', gameId: 'match', revision: 1, move: 4 });
  assert.equal((await makeDashboardStore(storage).read()).games.tic.board[4], '민재');
});

test('the Apps Script domain is identical to the tested browser rules', () => {
  const browser = fs.readFileSync(new URL('../src/services/dashboard-domain.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../apps-script/DashboardDomain.gs', import.meta.url), 'utf8');
  assert.equal(server.split('\n').slice(1).join('\n'), browser.replaceAll('export ', ''));
  const context = {}; vm.createContext(context); vm.runInContext(server, context);
  assert.equal(context.commitGameMove(context.blankGame('tic', 'x'), '여진', 0, 0).turn, '민재');
});
