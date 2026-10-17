import test from 'node:test';
import assert from 'node:assert/strict';
import { previewText, relationshipDay, PREVIEW_ASKING_STORAGE_KEY, PREVIEW_DASHBOARD_STORAGE_KEY } from '../src/services/preview-privacy.js';
import { makeLocalAskingStore } from '../src/services/asking-store.js';
import { makeDashboardStore } from '../src/services/dashboard-store.js';

test('only preview replaces Korean and English names, including names in sentences', () => {
  for (const value of ['여진 / 민재', 'YEOJIN / MINJAE', 'yeojin / minjae', '여진과 민재의 기록']) {
    assert.equal(previewText(value, false), value);
    assert(!/여진|민재|yeojin|minjae/i.test(previewText(value, true)));
  }
  assert.equal(previewText('여진 / 민재', true), '여보 / 자기');
  assert.equal(relationshipDay(469, true), 1);
  assert.equal(relationshipDay(469, false), 469);
});

test('preview question drafts and answers never load or alter real records', async () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const real = makeLocalAskingStore(storage);
  const entry = await real.create('실제 기록');
  await real.save(entry.id, { 여진: '실제 답변 A', 민재: '실제 답변 B' });
  const preview = makeLocalAskingStore(storage, { storageKey: PREVIEW_ASKING_STORAGE_KEY });
  assert.deepEqual(await preview.list(), []);
  const demo = await preview.create('미리보기 기록');
  await preview.save(demo.id, { 여진: '샘플 A', 민재: '샘플 B' });
  assert.equal((await real.list()).length, 1);
  assert.equal((await real.list())[0].question, '실제 기록');
  assert.equal((await preview.list())[0].question, '미리보기 기록');
});

test('preview games and daily data have a separate namespace from real games', async () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const real = makeDashboardStore(storage, { id: () => 'real-match' });
  const preview = makeDashboardStore(storage, { storageKey: PREVIEW_DASHBOARD_STORAGE_KEY, id: () => 'demo-match' });
  await real.act('여진', 'game.open', { kind: 'tic' });
  assert.equal((await preview.read()).games.tic, undefined);
  await preview.act('민재', 'game.open', { kind: 'punch' });
  assert.equal((await real.read()).games.punch, undefined);
  assert.equal((await real.read()).games.tic.id, 'real-match');
});
