export const partnerOf = person => person === '민재' ? '여진' : '민재';
export const peopleFor = person => [person, partnerOf(person)];

export function categoryUpdates(answerTimes = {}) {
  return Object.entries(answerTimes).reduce((updates, [key, time]) => {
    const category = key.split(':')[0];
    if (!updates[category] || time > updates[category]) updates[category] = time;
    return updates;
  }, {});
}

// The preview sample belongs to Yeojin. Swap the actual records, not just labels.
export function stateForPerson(state, person, owner) {
  const own = person === owner;
  const reads = state.personReads?.[person];
  return {
    ...state,
    answers: (own ? state.answers : state.partnerAnswers) || {},
    partnerAnswers: (own ? state.partnerAnswers : state.answers) || {},
    answerUpdatedAt: (own ? state.answerUpdatedAt : state.partnerAnswerUpdates) || {},
    partnerAnswerUpdates: (own ? state.partnerAnswerUpdates : state.answerUpdatedAt) || {},
    partnerUpdates: own ? state.partnerUpdates || {} : categoryUpdates(state.answerUpdatedAt),
    scores: (own ? state.scores : state.partnerScores) || [],
    partnerScores: (own ? state.partnerScores : state.scores) || [],
    readPartnerUpdates: reads?.categories || (own ? state.readPartnerUpdates : {}) || {},
    readPartnerAnswers: reads?.questions || (own ? state.readPartnerAnswers : {}) || {},
  };
}

export function writePersonAnswer(state, person, owner, key, value, updatedAt) {
  const answersKey = person === owner ? 'answers' : 'partnerAnswers';
  const timesKey = person === owner ? 'answerUpdatedAt' : 'partnerAnswerUpdates';
  const next = { ...state, [answersKey]: { ...state[answersKey], [key]: value }, [timesKey]: { ...state[timesKey], [key]: updatedAt } };
  if (person !== owner) next.partnerUpdates = categoryUpdates(next.partnerAnswerUpdates);
  return next;
}
