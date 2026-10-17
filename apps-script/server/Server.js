// Source for the standalone Apps Script bundle. Build with npm run build:server.
const SERVER_SCHEMA = ['kind', 'id', 'version', 'part', 'parts', 'data_json'];

function setupLoveMap() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) throw new Error('스크립트 속성에 SPREADSHEET_ID를 입력해주세요.');
  if (!props.getProperty('AUTH_SECRET')) props.setProperty('AUTH_SECRET', Array.from({ length: 4 }, () => Utilities.getUuid()).join(''));
  const book = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  let sheet = book.getSheetByName('LoveMapData');
  if (!sheet) {
    sheet = book.insertSheet('LoveMapData');
    sheet.getRange(1, 1, 1, SERVER_SCHEMA.length).setValues([SERVER_SCHEMA]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#e8ecdf');
    sheet.setColumnWidths(1, 5, 140); sheet.setColumnWidth(6, 500);
  }
  return { ready: true, schema: 1 };
}

function doGet() { return serverJson_({ ok: true, service: 'Love Map', schema: 1 }); }
async function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    if (!event?.postData?.contents || event.postData.contents.length > 600000) throw new Error('요청 크기를 확인해주세요.');
    const input = JSON.parse(event.postData.contents);
    lock.waitLock(20000);
    const result = await serverRequest_(input);
    return serverJson_({ ok: true, data: result });
  } catch (error) {
    return serverJson_({ ok: false, error: error.message || '저장하지 못했어요. 다시 시도해주세요.' });
  } finally { if (lock.hasLock()) { SpreadsheetApp.flush(); lock.releaseLock(); } }
}
function serverJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function serverDay_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }
function serverSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const sheet = id && SpreadsheetApp.openById(id).getSheetByName('LoveMapData');
  if (!sheet) throw new Error('setupLoveMap을 먼저 실행해주세요.');
  return sheet;
}

// Complete snapshots are appended in one range write. Partial writes are ignored;
// a previous complete version remains available. JSON is split below cell limits.
function serverRead_(kind, id, fallback) {
  const cacheKey = 'snapshot-v2:' + kind + ':' + id;
  const cache = typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null;
  const cached = cache?.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch {} }
  const sheet = serverSheet_(), count = sheet.getLastRow() - 1;
  const rows = count > 0 ? sheet.getRange(2, 1, count, 6).getValues().filter(row => row[0] === kind && row[1] === id) : [];
  const versions = [...new Set(rows.map(row => Number(row[2])))].sort((a, b) => b - a);
  for (const version of versions) {
    const parts = rows.filter(row => Number(row[2]) === version).sort((a, b) => Number(a[3]) - Number(b[3]));
    if (parts.length && parts.length === Number(parts[0][4]) && parts.every((row, i) => Number(row[3]) === i)) {
      const result = { version, value: JSON.parse(parts.map(row => JSON.parse(row[5])).join('')) };
      const serialized = JSON.stringify(result);
      if (serialized.length < 24000) cache?.put(cacheKey, serialized, 300);
      return result;
    }
  }
  return { version: 0, value: fallback };
}
function serverWrite_(kind, id, value) {
  const previous = serverRead_(kind, id, null), json = JSON.stringify(value), chunks = [];
  for (let offset = 0; offset < json.length; offset += 20000) chunks.push(json.slice(offset, offset + 20000));
  const rows = chunks.map((chunk, i) => [kind, id, previous.version + 1, i, chunks.length, JSON.stringify(chunk)]);
  const sheet = serverSheet_(), start = sheet.getLastRow() + 1;
  if (start + rows.length - 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 100);
  // Each cell begins with a JSON quote, even when a continuation begins with
  // '='. User text can never become a sheet formula through setValues.
  sheet.getRange(start, 1, rows.length, 6).setNumberFormat('@').setValues(rows);
  SpreadsheetApp.flush();
  if (typeof CacheService !== 'undefined') {
    const cache = CacheService.getScriptCache(), key = 'snapshot-v2:' + kind + ':' + id;
    cache.remove(key);
    const serialized = JSON.stringify({ version: previous.version + 1, value });
    if (serialized.length < 24000) cache.put(key, serialized, 300);
  }
  const all = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  // Keep the newest two complete snapshots, so record growth stays bounded.
  const obsolete = all.map((row, i) => row[0] === kind && row[1] === id && Number(row[2]) < previous.version ? i + 2 : null).filter(Boolean);
  for (let i = obsolete.length - 1; i >= 0;) {
    const end = obsolete[i]; let begin = end;
    while (i > 0 && obsolete[i - 1] === begin - 1) { begin--; i--; }
    sheet.deleteRows(begin, end - begin + 1); i--;
  }
}

function serverSecurity_() {
  const secret = PropertiesService.getScriptProperties().getProperty('AUTH_SECRET');
  if (!secret) throw new Error('setupLoveMap을 먼저 실행해주세요.');
  const mac = value => Utilities.computeHmacSha256Signature(String(value), secret).map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
  const random = bytes => {
    let value = '';
    while (value.length < bytes * 2) value += mac('random:' + Utilities.getUuid() + ':' + Date.now());
    return value.slice(0, bytes * 2);
  };
  // The secret stays in Script Properties, never in the sheet or browser. A
  // per-member salt and keyed HMAC protect the tiny PIN space if a sheet leaks.
  const pinHash = async (pin, salt) => mac('pin:' + salt + ':' + pin);
  return { digest: async value => mac('digest:' + value), pinHash, random,
    recoveryCode: () => random(16).toUpperCase().match(/.{4}/g).join('-'),
    makePin: async pin => { validatePin(pin); const salt = random(16); return { salt, algorithm: 'HMAC-SHA256-server-secret-v1', hash: await pinHash(pin, salt) }; } };
}

async function serverRequest_(input) {
  if (typeof input.action !== 'string') throw new Error('잘못된 요청이에요.');
  const loaded = serverRead_('auth', 'accounts', null);
  let raw = loaded.value ? JSON.stringify(loaded.value) : null, changed = false;
  let token = typeof input.sessionToken === 'string' && input.sessionToken.length <= 256 ? input.sessionToken : null;
  const storage = { getItem: key => key === AUTH_STORAGE_KEY ? raw : null, setItem: (key, value) => { if (key === AUTH_STORAGE_KEY) { raw = value; changed = true; } } };
  const tabs = { getItem: () => token, setItem: (_key, value) => { token = value; }, removeItem: () => { token = null; } };
  const auth = makePinAuthStore(storage, tabs, { security: serverSecurity_(), id: () => Utilities.getUuid() });
  try {
    if (input.action.startsWith('auth.')) {
      const p = input.payload || {}, action = input.action.slice(5);
      let result;
      if (action === 'create') result = await auth.create(p);
      else if (action === 'join') result = await auth.join(p);
      else if (action === 'unlock') result = await auth.unlock(p.memberId, p.pin);
      else if (action === 'session') result = await auth.getSession();
      else if (action === 'changePin') result = await auth.changePin(p.currentPin, p.newPin);
      else if (action === 'recover') result = await auth.recover(p.code, p.newPin);
      else if (action === 'renewRecovery') result = await auth.renewRecovery(p.currentPin);
      else if (action === 'renewInvite') { await auth.renewInvite(p.currentPin, p.inviteCode); result = {}; }
      else if (action === 'logout') { await auth.logout(); result = {}; }
      else throw new Error('지원하지 않는 요청이에요.');
      const session = result?.session || (result?.memberId ? result : null);
      return { result, sessionToken: token, initialPair: session ? serverVisiblePair_(serverRead_('pair', session.pairId, {}).value, session) : undefined };
    }
    const session = await auth.getSession();
    if (!session) throw new Error('다시 입장해주세요.');
    // pairId and actor always come from the verified session, never the payload.
    return serverData_(input, session);
  } finally { if (changed) serverWrite_('auth', 'accounts', JSON.parse(raw)); }
}

function safeObject_(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function plainCopy_(value) { return JSON.parse(JSON.stringify(value)); }
function serverVisiblePair_(value, session) {
  const state = plainCopy_(value), partner = session.slot === '여진' ? '민재' : '여진';
  const otherKey = session.slot === '여진' ? 'partnerAnswers' : 'answers';
  const ownKey = session.slot === '여진' ? 'answers' : 'partnerAnswers';
  const timesKey = session.slot === '여진' ? 'partnerAnswerUpdates' : 'answerUpdatedAt';
  const visibility = state.visibility?.[partner] || {};
  for (const key of Object.keys(state[otherKey] || {})) {
    const rule = visibility[key.split(':')[0]] || 'partner';
    if (rule !== 'partner' && !(rule === 'after_both' && state[ownKey]?.[key]?.trim())) {
      delete state[otherKey][key]; if (state[timesKey]) delete state[timesKey][key];
    }
  }
  state.partnerUpdates = categoryUpdates(state.partnerAnswerUpdates || {});
  state.game = state.memberGames?.[session.slot] || null;
  delete state.memberGames;
  return state;
}

function serverData_(input, session) {
  const pairId = session.pairId, actor = session.slot, p = input.payload || {};
  if (input.action === 'pair.read') return serverVisiblePair_(serverRead_('pair', pairId, {}).value, session);
  if (input.action === 'pair.patch') {
    const state = serverRead_('pair', pairId, {}).value;
    const ownKeys = actor === '여진' ? ['answers', 'answerUpdatedAt', 'scores', 'readPartnerUpdates', 'readPartnerAnswers'] : ['partnerAnswers', 'partnerAnswerUpdates', 'partnerScores'];
    const patch = safeObject_(p.fields);
    for (const key of Object.keys(patch)) {
      if (!ownKeys.includes(key)) throw new Error('본인의 기록만 수정할 수 있어요.');
      if (key === 'scores' || key === 'partnerScores') {
        if (!Array.isArray(patch[key]) || patch[key].length > 1200 || patch[key].some(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isInteger(row.score) || row.score < 0 || row.score > 20)) throw new Error('점검 기록을 확인해주세요.');
        const months = Object.fromEntries((state[key] || []).map(row => [row.date.slice(0, 7), row]));
        for (const row of patch[key]) {
          if (!row.answers || Object.values(row.answers).some(value => typeof value !== 'boolean')) throw new Error('점검 답변을 확인해주세요.');
          const checked = { ...row, score: Object.values(row.answers).filter(Boolean).length };
          const old = months[row.date.slice(0, 7)];
          if (!old || String(row.created_at || row.date) >= String(old.created_at || old.date)) months[row.date.slice(0, 7)] = checked;
        }
        state[key] = Object.values(months).sort((a, b) => a.date.localeCompare(b.date));
      } else {
        const items = safeObject_(patch[key]);
        for (const entryKey of Object.keys(items)) {
          if (!/^[a-zA-Z0-9_:-]{1,100}$/.test(entryKey) || typeof items[entryKey] !== 'string' || items[entryKey].length > 20000) throw new Error('기록 내용을 확인해주세요.');
        }
        state[key] = { ...state[key], ...items };
      }
    }
    if (p.reads) {
      state.personReads ||= {}; const old = state.personReads[actor] || {};
      state.personReads[actor] = { categories: { ...old.categories, ...safeObject_(p.reads.categories) }, questions: { ...old.questions, ...safeObject_(p.reads.questions) } };
    }
    if (p.visibility) {
      if (Object.values(p.visibility).some(value => !['private', 'partner', 'after_both'].includes(value))) throw new Error('공개 설정을 확인해주세요.');
      state.visibility ||= {}; state.visibility[actor] = { ...state.visibility[actor], ...p.visibility };
    }
    if (p.discovery) {
      if (typeof p.discovery.text !== 'string' || !p.discovery.text.trim() || p.discovery.text.length > 20000 || !/^[a-zA-Z0-9-]{1,100}$/.test(String(p.discovery.id))) throw new Error('메모 내용을 확인해주세요.');
      state.discoveries ||= [];
      if (!state.discoveries.some(row => String(row.id) === String(p.discovery.id))) state.discoveries.unshift({ id: p.discovery.id, text: p.discovery.text.trim(), who: actor, date: serverDay_() });
    }
    if (p.mainGame) {
      if (JSON.stringify(p.mainGame).length > 30000) throw new Error('게임 기록을 확인해주세요.');
      state.memberGames ||= {}; state.memberGames[actor] = p.mainGame;
      if (p.mainGame.id && p.mainGame.step === p.mainGame.picks?.length && p.mainGame.rounds?.length === p.mainGame.picks?.length) {
        state.gameHistory ||= [];
        if (!state.gameHistory.some(game => game.id === p.mainGame.id)) state.gameHistory.push({ ...p.mainGame, savedBy: actor, date: serverDay_() });
      }
    }
    serverWrite_('pair', pairId, state);
    return serverVisiblePair_(state, session);
  }
  if (input.action.startsWith('asking.')) return serverAsking_(input, session);
  if (input.action.startsWith('dashboard.')) {
    const stored = serverRead_('dashboard', pairId, { state: emptyDashboard(), requests: [] }).value;
    const action = input.action.slice(10);
    if (action === 'read') return stored.state;
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(input.requestId)) throw new Error('잘못된 요청이에요.');
    if (stored.requests.includes(input.requestId)) return stored.state;
    if (p.kind && !['tic', 'gomoku', 'punch'].includes(p.kind)) throw new Error('게임을 확인해주세요.');
    const pair = action.startsWith('daily.') ? serverRead_('pair', pairId, {}).value : {};
    const checkins = { 여진: pair.scores || [], 민재: pair.partnerScores || [] };
    if (action === 'daily.answer') stored.state = dashboardAction(stored.state, actor, 'daily.sync', {}, { day: serverDay_(), id: Utilities.getUuid(), checkins });
    const before = JSON.stringify(stored.state);
    stored.state = dashboardAction(stored.state, actor, action, p, { day: serverDay_(), id: Utilities.getUuid(), checkins });
    if (action === 'daily.sync' && before === JSON.stringify(stored.state)) return stored.state;
    stored.requests = [...stored.requests.slice(-199), input.requestId];
    serverWrite_('dashboard', pairId, stored);
    return stored.state;
  }
  throw new Error('지원하지 않는 요청이에요.');
}

function serverAsking_(input, session) {
  const state = serverRead_('asking', session.pairId, { usedIds: [], cycle: 1, entries: [] }).value;
  if (input.action === 'asking.list') return state.entries.filter(row => row.savedAt).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const p = input.payload || {};
  if (input.action === 'asking.draw' || input.action === 'asking.create') {
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(input.requestId)) throw new Error('잘못된 요청이에요.');
    const existing = state.entries.find(row => row.requestId === input.requestId);
    if (existing) return existing;
    let question = p.question, questionId = null;
    if (input.action === 'asking.draw') {
      let pool = OPEN_QUESTIONS.filter(row => !state.usedIds.includes(row.id));
      if (!pool.length) { state.usedIds = []; state.cycle++; pool = OPEN_QUESTIONS; }
      const selected = pool[Math.floor(Math.random() * pool.length)];
      question = selected.question; questionId = selected.id; state.usedIds.push(questionId);
    }
    if (typeof question !== 'string' || !question.trim() || question.length > 1000) throw new Error('질문을 1,000자 이내로 적어주세요.');
    const entry = { id: Utilities.getUuid(), requestId: input.requestId, question: question.trim(), questionId, cycle: state.cycle, answers: { 여진: '', 민재: '' }, createdBy: session.slot, createdAt: new Date().toISOString(), date: serverDay_(), savedAt: null };
    state.entries.push(entry); serverWrite_('asking', session.pairId, state); return entry;
  }
  if (input.action === 'asking.save') {
    const entry = state.entries.find(row => row.id === p.entryId);
    if (!entry) throw new Error('질문을 찾을 수 없어요.');
    if (!entry.savedAt) {
      if (!['여진', '민재'].every(person => typeof p.answers?.[person] === 'string' && p.answers[person].trim() && p.answers[person].length <= 20000)) throw new Error('두 사람의 답변을 모두 적어주세요.');
      entry.answers = { 여진: p.answers.여진.trim(), 민재: p.answers.민재.trim() }; entry.savedBy = session.slot; entry.savedAt = new Date().toISOString(); entry.date = serverDay_();
      serverWrite_('asking', session.pairId, state);
    }
    return entry;
  }
  throw new Error('지원하지 않는 요청이에요.');
}
