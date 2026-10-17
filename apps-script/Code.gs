// Prepared for a later connection. Do not deploy until the app's Google login is ready.
// Script properties: SPREADSHEET_ID, GOOGLE_CLIENT_ID,
// MEMBERS_JSON = {"yeojin@example.com":"여진","minjae@example.com":"민재"}
const CONVERSATION_HEADERS = ['id', 'request_id', 'data_json'];

function doPost(event) {
  try {
    if (!event || !event.postData || event.postData.contents.length > 100000) throw new Error('잘못된 요청이에요.');
    const input = JSON.parse(event.postData.contents);
    const actor = authenticate_(input.idToken);
    const data = withLock_(function () { return input.action && input.action.indexOf('dashboard.') === 0 ? dashboardDispatch_(input, actor) : dispatch_(input, actor); });
    return json_({ ok: true, data: data });
  } catch (error) {
    return json_({ ok: false, error: error.message || '요청을 처리하지 못했어요.' });
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return operation(); }
  finally { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
}

function authenticate_(idToken) {
  const config = PropertiesService.getScriptProperties();
  const clientId = config.getProperty('GOOGLE_CLIENT_ID');
  const members = JSON.parse(config.getProperty('MEMBERS_JSON') || '{}');
  if (!clientId || Object.keys(members).length !== 2 || new Set(Object.values(members)).size !== 2 || !Object.values(members).every(name => ['여진', '민재'].includes(name))) throw new Error('로그인 연결 설정이 필요해요.');
  if (typeof idToken !== 'string' || !idToken || idToken.length > 10000) throw new Error('다시 로그인해주세요.');
  // Google verifies the signature. The client cannot choose the actor's name.
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('다시 로그인해주세요.');
  const identity = JSON.parse(response.getContentText());
  const email = String(identity.email || '').toLowerCase();
  if (identity.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(identity.iss) || Number(identity.exp) <= Date.now() / 1000 || String(identity.email_verified) !== 'true' || !Object.prototype.hasOwnProperty.call(members, email)) throw new Error('이 공간에 접근할 수 없어요.');
  return { id: identity.sub, name: members[email] };
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('저장 시트 연결 설정이 필요해요.');
  return SpreadsheetApp.openById(id);
}

// Run manually once, after the connection is explicitly requested.
function setupLoveMapAsking() {
  return withLock_(function () {
    const book = spreadsheet_();
    let bank = book.getSheetByName('AskingQuestions');
    if (!bank) {
      bank = book.insertSheet('AskingQuestions');
      bank.getRange(1, 1, 1, 2).setValues([['id', 'question']]);
      bank.getRange(2, 1, QUESTION_BANK.length, 2).setValues(QUESTION_BANK.map(q => [q.id, q.question]));
      bank.setFrozenRows(1);
    }
    if (!book.getSheetByName('AskingConversations')) {
      const sheet = book.insertSheet('AskingConversations');
      sheet.getRange(1, 1, 1, 3).setValues([CONVERSATION_HEADERS]);
      sheet.setFrozenRows(1);
    }
    return { questions: bank.getLastRow() - 1 };
  });
}

function conversations_() {
  const sheet = spreadsheet_().getSheetByName('AskingConversations');
  if (!sheet) throw new Error('저장 시트 초기 설정이 필요해요.');
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues() : [];
  return { sheet: sheet, entries: rows.map(row => JSON.parse(row[2])) };
}

function questionBank_() {
  const sheet = spreadsheet_().getSheetByName('AskingQuestions');
  if (!sheet || sheet.getLastRow() !== 28) throw new Error('27개 질문 데이터 설정을 확인해주세요.');
  const questions = sheet.getRange(2, 1, 27, 2).getValues().map(row => ({ id: String(row[0]), question: String(row[1]) }));
  if (questions.some(q => !q.id || !q.question) || new Set(questions.map(q => q.id)).size !== 27) throw new Error('질문 데이터가 올바르지 않아요.');
  return questions;
}

function validateRequestId_(requestId) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) throw new Error('잘못된 요청이에요.');
}

function seoulDate_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

function dispatch_(input, actor) {
  const store = conversations_();
  if (input.action === 'asking.list') return store.entries.filter(entry => entry.savedAt).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  if (input.action === 'asking.draw' || input.action === 'asking.create') {
    validateRequestId_(input.requestId);
    const existing = store.entries.find(entry => entry.requestId === input.requestId);
    if (existing) return existing;
    let question, questionId = null, cycle = null;
    if (input.action === 'asking.draw') {
      const bank = questionBank_();
      const draws = store.entries.filter(entry => entry.questionId);
      cycle = draws.reduce((latest, entry) => Math.max(latest, entry.cycle), 1);
      const usedIds = new Set(draws.filter(entry => entry.cycle === cycle).map(entry => entry.questionId));
      let available = bank.filter(entry => !usedIds.has(entry.id));
      if (!available.length) { cycle += 1; available = bank; }
      const selected = available[Math.floor(Math.random() * available.length)];
      question = selected.question;
      questionId = selected.id;
    } else {
      question = typeof input.question === 'string' ? input.question.trim() : '';
      if (!question || question.length > 1000) throw new Error('질문을 1,000자 이내로 적어주세요.');
    }
    const entry = { id: Utilities.getUuid(), requestId: input.requestId, question: question, questionId: questionId, cycle: cycle, answers: { '여진': '', '민재': '' }, createdBy: actor.name, createdById: actor.id, date: seoulDate_(), createdAt: new Date().toISOString(), savedAt: null };
    // JSON cells prevent user-entered questions or answers from becoming formulas.
    store.sheet.appendRow([entry.id, entry.requestId, JSON.stringify(entry)]);
    return entry;
  }
  if (input.action === 'asking.save') {
    const index = store.entries.findIndex(entry => entry.id === input.entryId);
    if (index < 0) throw new Error('질문을 찾을 수 없어요.');
    const entry = store.entries[index];
    if (entry.savedAt) return entry;
    const answers = input.answers || {};
    if (!['여진', '민재'].every(person => typeof answers[person] === 'string' && answers[person].trim() && answers[person].length <= 20000)) throw new Error('두 사람의 답변을 모두 적어주세요.');
    entry.answers = { '여진': answers['여진'].trim(), '민재': answers['민재'].trim() };
    entry.date = seoulDate_();
    entry.savedAt = new Date().toISOString();
    entry.savedBy = actor.name;
    entry.savedById = actor.id;
    store.sheet.getRange(index + 2, 3).setValue(JSON.stringify(entry));
    return entry;
  }
  throw new Error('지원하지 않는 요청이에요.');
}
