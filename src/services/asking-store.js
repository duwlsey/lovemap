import { OPEN_QUESTIONS } from '../data/open-questions.js';

export const ASKING_STORAGE_KEY = 'love-map-asking-v1';
export const PEOPLE = ['여진', '민재'];
const dateInSeoul = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const newId = () => globalThis.crypto.randomUUID();

export function pickQuestion(usedIds, bank = OPEN_QUESTIONS, random = Math.random) {
  let available = bank.filter(q => !usedIds.includes(q.id));
  const restarted = available.length === 0;
  if (restarted) available = bank;
  const question = available[Math.floor(random() * available.length)];
  return { question, usedIds: [...(restarted ? [] : usedIds), question.id], restarted };
}

export function makeLocalAskingStore(storage, { actor = () => '여진', date = dateInSeoul, id = newId, random = Math.random, lock = task => task(), storageKey = ASKING_STORAGE_KEY } = {}) {
  function read() {
    const raw = storage.getItem(storageKey);
    if (!raw) return { usedIds: [], cycle: 1, entries: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.usedIds) || !Array.isArray(parsed.entries)) throw new Error('저장된 기록을 읽을 수 없어요.');
    return parsed;
  }
  function mutate(task) {
    return lock(() => {
      const state = read();
      const result = task(state);
      storage.setItem(storageKey, JSON.stringify(state));
      return structuredClone(result);
    });
  }
  const draft = (question, questionId, requestId) => ({ id: id(), requestId, question, questionId, answers: { 여진: '', 민재: '' }, createdBy: actor(), date: date(), createdAt: new Date().toISOString(), savedAt: null });
  return {
    async list() { return read().entries.filter(e => e.savedAt).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); },
    async draw(requestId = id()) {
      return mutate(state => {
        const existing = state.entries.find(e => e.requestId === requestId);
        if (existing) return existing;
        const selected = pickQuestion(state.usedIds, OPEN_QUESTIONS, random);
        state.usedIds = selected.usedIds;
        if (selected.restarted) state.cycle += 1;
        const entry = { ...draft(selected.question.question, selected.question.id, requestId), cycle: state.cycle };
        state.entries.push(entry);
        return entry;
      });
    },
    async create(question, requestId = id()) {
      const text = question.trim();
      if (!text || text.length > 1000) throw new Error('질문을 1,000자 이내로 적어주세요.');
      return mutate(state => {
        const existing = state.entries.find(e => e.requestId === requestId);
        if (existing) return existing;
        const entry = draft(text, null, requestId);
        state.entries.push(entry);
        return entry;
      });
    },
    async save(entryId, answers) {
      if (!PEOPLE.every(person => typeof answers[person] === 'string' && answers[person].trim() && answers[person].length <= 20000)) throw new Error('두 사람의 답변을 모두 적어주세요.');
      return mutate(state => {
        const entry = state.entries.find(e => e.id === entryId);
        if (!entry) throw new Error('질문을 찾을 수 없어요.');
        if (entry.savedAt) return entry;
        entry.answers = Object.fromEntries(PEOPLE.map(person => [person, answers[person].trim()]));
        entry.date = date();
        entry.savedAt = new Date().toISOString();
        entry.savedBy = actor();
        return entry;
      });
    },
  };
}

// The future Google sign-in flow provides a short-lived ID token in memory.
// No tokens, sheet IDs, or shared secrets are embedded in the browser bundle.
export function makeAppsScriptAskingStore({ endpoint, getIdToken, fetcher = fetch }) {
  async function request(action, payload = {}) {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('다시 로그인해주세요.');
    const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, idToken, ...payload }), redirect: 'follow' });
    if (!response.ok) throw new Error('저장 서버에 연결할 수 없어요. 다시 시도해주세요.');
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || '저장하지 못했어요. 다시 시도해주세요.');
    return result.data;
  }
  return {
    list: () => request('asking.list'),
    draw: (requestId = newId()) => request('asking.draw', { requestId }),
    create: (question, requestId = newId()) => request('asking.create', { question, requestId }),
    save: (entryId, answers) => request('asking.save', { entryId, answers }),
  };
}

export function recordsForPerson(entries, person) {
  return entries.filter(entry => entry.savedAt && entry.answers?.[person]?.trim()).map(entry => ({ id: entry.id, date: entry.date, question: entry.question, text: entry.answers[person], who: person }));
}
