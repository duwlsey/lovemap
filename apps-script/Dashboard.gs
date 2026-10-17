// Requires DashboardDomain.gs, generated from src/services/dashboard-domain.js.
// One durable event per action keeps the two accounts on the same game and queue.
function setupLoveMapDashboard() {
  return withLock_(function () {
    const book = spreadsheet_();
    if (!book.getSheetByName('DashboardEvents')) {
      const events = book.insertSheet('DashboardEvents');
      events.appendRow(['id', 'data_json']);
      events.setFrozenRows(1);
    }
    if (!book.getSheetByName('CheckInResults')) {
      const checkins = book.insertSheet('CheckInResults');
      checkins.appendRow(['id', 'person', 'data_json']);
      checkins.setFrozenRows(1);
    }
  });
}

function dashboardCheckins_() {
  const result = { '여진': [], '민재': [] };
  const sheet = spreadsheet_().getSheetByName('CheckInResults');
  if (!sheet || sheet.getLastRow() < 2) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(function (row) {
    if (Object.prototype.hasOwnProperty.call(result, row[1])) result[row[1]].push(JSON.parse(row[2]));
  });
  return result;
}

function dashboardDispatch_(input, actor) {
  const sheet = spreadsheet_().getSheetByName('DashboardEvents');
  if (!sheet) throw new Error('대시보드 저장 시트 초기 설정이 필요해요.');
  const events = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().map(function (row) { return JSON.parse(row[1]); }) : [];
  let state = emptyDashboard();
  events.forEach(function (event) {
    state = dashboardAction(state, event.actor, event.action, event.payload, event.context);
  });
  const action = input.action.slice('dashboard.'.length);
  if (action === 'read') return state;
  validateRequestId_(input.requestId);
  if (events.some(function (event) { return event.id === input.requestId && event.actor === actor.name; })) return state;
  const payload = input.payload || {};
  const before = JSON.stringify(state);
  const context = { day: seoulDate_(), id: input.requestId, checkins: action === 'daily.sync' ? dashboardCheckins_() : {} };
  state = dashboardAction(state, actor.name, action, payload, context);
  if (JSON.stringify(state) !== before) {
    sheet.appendRow([input.requestId, JSON.stringify({ id: input.requestId, actor: actor.name, action: action, payload: payload, context: context })]);
  }
  return state;
}
