// Generated from src/services/dashboard-domain.js. Keep the two files in sync.
const DASH_PEOPLE = ['여진', '민재'];
const DAILY_QUESTIONS = [
  '가장 친한 친구는 누구인가요?', '요즘 무엇 때문에 스트레스를 받고 있나요?',
  '최근 마음을 불편하게 하는 사람이나 관계가 있나요?', '지금 이루고 싶은 일은 무엇인가요?',
  '종교에 대해 어떤 믿음과 생각을 가지고 있나요?', '삶에서 중요하게 여기는 철학은 무엇인가요?',
  '가족이나 친척 중 함께하기 어려운 사람이 있나요?', '가장 좋아하는 음악은 무엇인가요?',
  '가장 좋아하는 영화 세 편은 무엇인가요?', '인생에서 가장 특별했던 사건 세 가지는 무엇인가요?',
  '어린 시절 가장 힘들었던 경험은 무엇인가요?', '가장 큰 꿈과 소망은 무엇인가요?',
  '지금 가장 걱정되는 것은 무엇인가요?', '복권에 당첨된다면 무엇을 하고 싶나요?',
  '처음 만났을 때 나의 첫인상은 어땠나요?', '요즘 일상에서 내가 알아주었으면 하는 일은 무엇인가요?',
  '요즘 내가 알아주었으면 하는 스트레스는 무엇인가요?', '내가 기억해주었으면 하는 친구들은 누구인가요?',
  '내가 아직 잘 모르는 당신의 모습은 무엇인가요?', '내가 더 알아주었으면 하는 꿈과 희망은 무엇인가요?',
];
const otherPerson = person => person === '여진' ? '민재' : '여진';
const cloneDashboard = value => JSON.parse(JSON.stringify(value));
const seoulDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const dayNumber = day => Date.parse(day + 'T00:00:00Z') / 86400000;
const emptyDashboard = () => ({ queues: {}, replies: [], games: {}, readUpdates: {}, pendingResults: { 여진: {}, 민재: {} } });

function syncDailyQueue(previous, record, day, replies = []) {
  const month = day.slice(0, 7);
  const eligible = record && record.date.slice(0, 7) === month ? record : null;
  const ids = eligible ? DAILY_QUESTIONS.map((_, i) => i).filter(i => eligible.answers?.[i] === false) : [];
  const version = eligible ? JSON.stringify([eligible.created_at || eligible.date, ids]) : month + ':empty';
  const alreadyAnswered = replies.some(reply => reply.date === day);
  if (!previous || previous.month !== month || previous.version !== version) {
    if (ids.length && eligible) {
      const elapsed = Math.max(0, dayNumber(day) - dayNumber(eligible.date));
      const shift = elapsed % ids.length;
      ids.push(...ids.splice(0, shift));
    }
    return { month, version, remaining: ids, day, activeId: alreadyAnswered ? null : (ids[0] ?? null), answered: alreadyAnswered };
  }
  if (previous.day === day) return previous;
  const remaining = [...previous.remaining];
  const elapsed = Math.max(0, dayNumber(day) - dayNumber(previous.day));
  const skipped = Math.max(0, elapsed - (previous.answered ? 1 : 0));
  if (remaining.length) {
    const shift = skipped % remaining.length;
    remaining.push(...remaining.splice(0, shift));
  }
  return { ...previous, remaining, day, activeId: alreadyAnswered ? null : (remaining[0] ?? null), answered: alreadyAnswered };
}

function blankGame(kind, id) {
  if (!['tic', 'gomoku', 'punch'].includes(kind)) throw new Error('게임을 찾을 수 없어요.');
  return { id, kind, revision: 0, turn: null, startedBy: null, board: kind === 'punch' ? [] : Array(kind === 'tic' ? 9 : 225).fill(null), scores: { 여진: null, 민재: null }, winner: null, finished: false, winningCells: [] };
}

function boardOutcome(board, size, needed, lastIndex) {
  const person = board[lastIndex];
  if (!person) return { finished: false, winner: null, winningCells: [] };
  const row = Math.floor(lastIndex / size), column = lastIndex % size;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [lastIndex];
    for (const direction of [-1, 1]) {
      let r = row + dr * direction, c = column + dc * direction;
      while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === person) {
        cells.push(r * size + c); r += dr * direction; c += dc * direction;
      }
    }
    if (cells.length >= needed) return { finished: true, winner: person, winningCells: cells };
  }
  return { finished: board.every(Boolean), winner: null, winningCells: [] };
}

function commitGameMove(game, actor, move, expectedRevision) {
  if (game.revision !== expectedRevision) throw new Error('상대방의 새 수가 있어요. 화면을 다시 확인해주세요.');
  if (game.finished || (game.turn !== null && game.turn !== actor)) throw new Error('지금은 상대방 차례예요.');
  const next = cloneDashboard(game);
  if (game.kind === 'punch') {
    if (!Number.isInteger(move) || move < 0 || move > 1000 || next.scores[actor] !== null) throw new Error('점수를 다시 확인해주세요.');
    next.scores[actor] = move;
    next.finished = DASH_PEOPLE.every(person => next.scores[person] !== null);
    if (next.finished) next.winner = next.scores.여진 === next.scores.민재 ? null : (next.scores.여진 > next.scores.민재 ? '여진' : '민재');
  } else {
    if (!Number.isInteger(move) || move < 0 || move >= next.board.length || next.board[move]) throw new Error('빈 곳을 골라주세요.');
    next.board[move] = actor;
    Object.assign(next, boardOutcome(next.board, game.kind === 'tic' ? 3 : 15, game.kind === 'tic' ? 3 : 5, move));
  }
  next.turn = otherPerson(actor);
  next.startedBy ||= actor;
  next.revision += 1;
  return next;
}

function dashboardAction(state, actor, action, payload, { day, id, checkins = {} }) {
  if (!DASH_PEOPLE.includes(actor)) throw new Error('계정을 확인해주세요.');
  state.pendingResults ||= { 여진: {}, 민재: {} };
  if (action === 'daily.sync') {
    const records = (checkins[otherPerson(actor)] || []).filter(record => record.date.slice(0, 7) === day.slice(0, 7)).sort((a, b) => String(a.created_at || a.date).localeCompare(String(b.created_at || b.date)));
    state.queues[actor] = syncDailyQueue(state.queues[actor], records.at(-1), day, state.replies.filter(reply => reply.author === actor));
  } else if (action === 'daily.answer') {
    const queue = state.queues[actor];
    if (!queue || queue.day !== day || queue.activeId !== payload.questionId || queue.answered || queue.version !== payload.version) throw new Error('오늘의 질문을 다시 확인해주세요.');
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text || text.length > 20000) throw new Error('답변을 20,000자 이내로 적어주세요.');
    if (state.replies.some(reply => reply.author === actor && reply.date === day)) throw new Error('오늘의 답변은 이미 전달했어요.');
    state.replies.push({ id, author: actor, recipient: otherPerson(actor), questionId: queue.activeId, question: DAILY_QUESTIONS[queue.activeId], text, date: day, sourceVersion: queue.version });
    queue.remaining = queue.remaining.filter(questionId => questionId !== queue.activeId);
    queue.answered = true;
  } else if (action === 'updates.read') {
    if (typeof payload.categoryId !== 'string' || typeof payload.updatedAt !== 'string') throw new Error('업데이트 정보를 확인해주세요.');
    state.readUpdates ||= {};
    state.readUpdates[actor] ||= {};
    state.readUpdates[actor][payload.categoryId] = payload.updatedAt;
  } else if (action === 'game.open') {
    if (!state.games[payload.kind]) state.games[payload.kind] = blankGame(payload.kind, id);
    else if (state.games[payload.kind].revision === 0) state.games[payload.kind].turn = null;
  } else if (action === 'game.move') {
    const game = state.games[payload.kind];
    if (!game || game.id !== payload.gameId) throw new Error('게임이 새로 시작되었어요.');
    if (state.pendingResults[actor]?.[payload.kind]) throw new Error('지난 게임 결과를 먼저 확인해주세요.');
    const next = commitGameMove(game, actor, payload.move, payload.revision);
    state.games[payload.kind] = next;
    if (next.finished) DASH_PEOPLE.forEach(person => { state.pendingResults[person][payload.kind] = cloneDashboard(next); });
  } else if (action === 'game.dismiss') {
    const result = state.pendingResults[actor]?.[payload.kind];
    if (result && result.id === payload.gameId) {
      delete state.pendingResults[actor][payload.kind];
      if (state.games[payload.kind]?.id === result.id) state.games[payload.kind] = blankGame(payload.kind, id);
    }
  } else throw new Error('지원하지 않는 동작이에요.');
  return state;
}
