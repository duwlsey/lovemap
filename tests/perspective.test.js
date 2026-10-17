import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleFor, stateForPerson, writePersonAnswer } from '../src/services/perspective.js';

const seed = () => ({
  answers: { 'who:0': '여진의 답변' }, partnerAnswers: { 'who:0': '민재의 답변' },
  answerUpdatedAt: { 'who:0': '2026-10-17T01:00:00Z' }, partnerAnswerUpdates: { 'who:0': '2026-10-17T02:00:00Z' },
  partnerUpdates: { who: '2026-10-17T02:00:00Z' },
  scores: [{ score: 16, date: '2026-10-17' }], partnerScores: [{ score: 9, date: '2026-10-17' }],
  personReads: { 여진: { categories: { who: '2026-10-17T00:00:00Z' } }, 민재: { categories: { who: '2026-10-17T01:00:00Z' } } },
});

test('each person is first in comparisons and receives their actual score series and answers', () => {
  const state = seed();
  for (const [person, ownScore, partnerScore, ownAnswer] of [['여진', 16, 9, '여진의 답변'], ['민재', 9, 16, '민재의 답변']]) {
    const view = stateForPerson(state, person, '여진');
    assert.equal(peopleFor(person)[0], person);
    assert.equal(view.scores[0].score, ownScore);
    assert.equal(view.partnerScores[0].score, partnerScore);
    assert.equal(view.answers['who:0'], ownAnswer);
    assert.equal(view.readPartnerUpdates.who, state.personReads[person].categories.who);
  }
  assert.equal(state.scores[0].score, 16);
});

test('editing after a persona switch changes only that person and not their partner', () => {
  const state = seed();
  const updated = writePersonAnswer(state, '민재', '여진', 'who:0', '민재가 수정한 답변', '2026-10-18T01:00:00Z');
  assert.equal(updated.answers['who:0'], '여진의 답변');
  assert.equal(stateForPerson(updated, '민재', '여진').answers['who:0'], '민재가 수정한 답변');
  assert.equal(stateForPerson(updated, '여진', '여진').partnerAnswers['who:0'], '민재가 수정한 답변');
  assert.equal(updated.partnerUpdates.who, '2026-10-18T01:00:00Z');
});

test('real signed-in data already belonging to Minjae is not swapped', () => {
  const state = seed();
  const view = stateForPerson(state, '민재', '민재');
  assert.equal(view.scores, state.scores);
  assert.equal(view.answers, state.answers);
});
