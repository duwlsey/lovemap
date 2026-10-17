import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Heart, X } from 'lucide-react';
import { DASHBOARD_STORAGE_KEY, makeDashboardStore } from '../services/dashboard-store.js';
import { usePreviewText } from './PreviewPrivacy.jsx';
import { PREVIEW_DASHBOARD_STORAGE_KEY } from '../services/preview-privacy.js';
import { peopleFor } from '../services/perspective.js';
import { DAILY_QUESTIONS, emptyDashboard, otherPerson, seoulDay } from '../services/dashboard-domain.js';

const GAME_NAMES = { tic: '틱택토', gomoku: '오목', punch: '펀치기계' };

function GameMark({ person }) { return person ? <svg className="tic-mark" viewBox="0 0 64 64" aria-hidden="true">{person === '여진' ? <circle cx="32" cy="32" r="23"/> : <path d="M9 9L55 55M55 9L9 55"/>}</svg> : null; }
function GomokuArt() { return <svg viewBox="0 0 80 80" className="gomoku-art" aria-hidden="true"><path d="M10 10H70M10 30H70M10 50H70M10 70H70M10 10V70M30 10V70M50 10V70M70 10V70" fill="none" stroke="#c9b996"/ ><circle cx="30" cy="30" r="8" fill="#56574e"/><circle cx="50" cy="30" r="8" fill="#f9f6ec" stroke="#c9b996"/><circle cx="50" cy="50" r="8" fill="#56574e"/></svg>; }

function MonthlyTrend({ mine, partner, currentName, onOpen }) {
  const label=usePreviewText();
  const day = seoulDay();
  const [year, month] = day.split('-').map(Number);
  const months = Array.from({ length: 3 }, (_, i) => new Date(Date.UTC(year, month - 3 + i, 1)).toISOString().slice(0, 7));
  const values = rows => months.map(key => rows.filter(row => row.date.startsWith(key)).sort((a, b) => String(a.created_at || a.date).localeCompare(String(b.created_at || b.date))).at(-1));
  const series = [values(mine || []), values(partner || [])];
  return <button className="dash-trend" onClick={onOpen} aria-label="월별 점검 추이, 돌아보기 열기">
    <div className="dash-card-heading"><div><span className="eyebrow">OUR GROWTH</span><h2>점검의 흐름</h2></div><ArrowRight size={17}/></div>
    <svg viewBox="0 0 330 140" role="img" aria-label="최근 세 달의 두 사람 점검 점수, 20점 만점">
      {[0, 10, 20].map(value => <g key={value}><line x1="30" x2="310" y1={110 - value * 4} y2={110 - value * 4}/><text x="4" y={114 - value * 4}>{value}</text></g>)}
      {series.map((rows, seriesIndex) => <g className={`trend-series series-${seriesIndex}`} key={seriesIndex}><path d={rows.map((row, i) => row ? `${i && rows[i - 1] ? 'L' : 'M'} ${40 + i * 125} ${110 - row.score * 4}` : '').join(' ')}/>{rows.map((row, i) => row && <circle key={i} cx={40 + i * 125} cy={110 - row.score * 4} r={seriesIndex ? 3 : 4}><title>{`${months[i]} ${label(seriesIndex ? otherPerson(currentName) : currentName)} ${row.score}점`}</title></circle>)}</g>)}
      {months.map((key, i) => <text className="trend-month" key={key} x={40 + i * 125} y="133" textAnchor="middle">{Number(key.slice(5))}월</text>)}
    </svg>
    <div className="trend-legend"><span><i/>{label(currentName)}</span><span><i/>{label(otherPerson(currentName))}</span></div>
    {!series.flat().some(Boolean) && <p className="dash-empty">점검 기록이 쌓이면 변화를 볼 수 있어요.</p>}
  </button>;
}

function MiniGame({ kind, actor, data, act, onClose, previewMode, onSwitch }) {
  const label=usePreviewText();
  const active = data.pendingResults?.[actor]?.[kind] || data.games[kind];
  const [selection, setSelection] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [punch, setPunch] = useState(0), [running, setRunning] = useState(false);
  const meterRef = useRef(0), animationRef = useRef(0);
  const dialogRef = useRef(null);
  const finished = active?.finished;
  const ownTurn = Boolean(active) && (active.turn === null || active.turn === actor) && !finished;
  const outcome = finished ? !active.winner ? 'draw' : active.winner === actor ? 'win' : 'lose' : '';
  useEffect(() => { setSelection(null); setPunch(0); setRunning(false); setError(''); }, [actor, active?.id, active?.revision]);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const frame = now => { const phase = ((now - start) % 620) / 620; const value = Math.round((phase < .5 ? phase * 2 : (1 - phase) * 2) * 1000); meterRef.current = value; setPunch(value); animationRef.current = requestAnimationFrame(frame); };
    animationRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationRef.current);
  }, [running]);
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    (dialogRef.current?.querySelector('button:not([disabled])') || dialogRef.current)?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const elements = dialogRef.current?.querySelectorAll('button:not([disabled]),[tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); previousFocus?.focus(); };
  }, [active?.id, finished, actor, busy]);
  function close() {
    onClose();
    if (finished) act('game.dismiss', { kind, gameId: active.id }).catch(() => {});
  }
  async function pass() {
    if (busy || selection === null || !ownTurn) return;
    setBusy(true); setError('');
    try { await act('game.move', { kind, gameId: active.id, revision: active.revision, move: selection }); setSelection(null); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!active) return <div className="mini-game-backdrop" onClick={onClose}><section className="mini-game-dialog" role="dialog" aria-modal="true" aria-label={GAME_NAMES[kind]} onClick={e => e.stopPropagation()}><header className="mini-game-header"><h2>{GAME_NAMES[kind]}</h2><button className="mini-close" onClick={onClose} aria-label="게임 닫기"><X size={19}/></button></header><p role="status">게임을 불러오고 있어요…</p></section></div>;
  const size = kind === 'tic' ? 3 : 15;
  return <div className="mini-game-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} tabIndex={-1} className={`mini-game-dialog theme-${kind} outcome-${outcome}`} role="dialog" aria-modal="true" aria-labelledby="mini-game-name">
      <header className="mini-game-header"><div><span>LOVE GAME</span><h2 id="mini-game-name">{GAME_NAMES[kind]}</h2></div><button className="mini-close" onClick={close} aria-label="게임 닫기"><X size={19}/></button></header>
      <div className="mini-game-people">{peopleFor(actor).map(person=><span key={label(person)} className={actor===person?'is-me':''}>{label(person)} {kind==='punch'?active.scores[person]??'—':kind==='tic'?(person==='여진'?'○':'×'):(person==='여진'?'●':'○')}</span>)}</div>
      {finished ? <div className="mini-game-result" aria-live="polite"><span className="result-word">{outcome}</span><p>{!active.winner ? '마음도 실력도 닮았네요.' : `${label(active.winner)}의 승리`}</p>{kind === 'punch' && <div className="punch-final">{peopleFor(actor).map(person=><span key={label(person)}>{label(person)} <b>{active.scores[person]}</b></span>)}</div>}{outcome === 'win' && <div className="heart-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <Heart key={i} size={10 + i % 4 * 3} style={{ '--x': `${(i * 37) % 100}%`, '--delay': `-${i % 7 * .39}s`, '--gentle-delay': `-${i * .875}s`, '--drift': `${(i % 5 - 2) * 22}px` }}/>)}</div>}{outcome==='lose'&&<div className="tear-rain" aria-hidden="true">{Array.from({length:30},(_,i)=><i key={i} style={{'--x':`${(i*37+7)%100}%`,'--delay':`-${i%9*.23}s`,'--gentle-delay':`-${i*.875}s`,'--duration':`${1.4+i%5*.18}s`,'--drop-size':`${3+i%3}px`}}/>)}</div>}<small>바깥을 누르면 게임이 초기화돼요.</small></div> : <>
        <p className="mini-turn" aria-live="polite">{ownTurn ? `${label(actor)}의 차례` : `${active.turn}의 차례를 기다려요`}</p>
        {kind === 'punch' ? <div className={`punch-machine ${running?'machine-running':''} ${selection!==null?'machine-hit':''}`}><div className="punch-marquee" aria-hidden="true"><i/><span>HEART STRIKER</span><i/></div><div className="punch-display-frame"><small>POWER SCORE</small><div className="punch-display">{String(punch).padStart(4, '0')}</div></div><div className="punch-target" aria-hidden="true"><div className="punch-target-arm"/><div className="punch-bag"><svg width="35" height="35" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 28c-5-2-7-6-6-10l1-5c1-5 5-7 11-7 7 0 12 4 12 10v7c0 3-2 6-5 7"/><path d="M10 22c-3-5-1-9 2-9 3 0 4 3 4 7l3 3M13 28h13v7H13zM18 9v5M23 10v4"/></svg><i/></div><div className="punch-target-base"/></div><div className="punch-meter"><div style={{ width: `${punch / 10}%` }}/><i style={{ left: `${punch / 10}%` }}/></div><div className="punch-scale"><span>0</span><span>1000</span></div><button className="punch-hit" disabled={!ownTurn || busy || (selection !== null && !running)} onClick={() => { if (running) { cancelAnimationFrame(animationRef.current); setRunning(false); setSelection(meterRef.current); setPunch(meterRef.current); } else { setRunning(true); } }}>{running ? 'PUNCH!' : selection !== null ? 'LOCKED' : 'START'}</button></div> : <div className={`mini-board board-${kind}`} style={{ '--size': size }} aria-label={GAME_NAMES[kind] + ' 게임판'}>{active.board.map((person, index) => <button key={index} aria-label={`${Math.floor(index / size) + 1}행 ${index % size + 1}열${person ? ' ' + label(person) : ''}`} disabled={!ownTurn || Boolean(person) || busy} className={`${person || (selection === index ? actor : '')} ${selection === index ? 'pending-move' : ''}`} onClick={() => setSelection(index)}>{kind === 'tic' ? <GameMark person={person || (selection === index ? actor : null)}/> : (person || selection === index) && <i/>}</button>)}</div>}
        <button className="mini-pass" disabled={!ownTurn || selection === null || busy || running} onClick={pass}>{busy ? '저장 중…' : '상대에게 넘기기'}<ArrowRight size={16}/></button>
      </>}
      {error && <p className="asking-error" role="alert">{error}</p>}
      {previewMode && <button className="mini-preview-switch" onClick={onSwitch} disabled={busy}>미리보기 · {label(otherPerson(actor))}로 보기</button>}
    </section>
  </div>;
}

export default function DashboardPanel({ state, sections, currentName, dashboardStorageKey, connectedDashboard, previewMode, onPreviewSwitch, onExplore, onHistory, onGame, onArchive }) {
  const label=usePreviewText();
  const actor = currentName;
  const [day, setDay] = useState(seoulDay), [data, setData] = useState(emptyDashboard), [error, setError] = useState(''), [text, setText] = useState(''), [busy, setBusy] = useState(false), [activeGame, setActiveGame] = useState(null);
  const store = useMemo(() => !previewMode && connectedDashboard ? connectedDashboard : makeDashboardStore(localStorage, { storageKey:previewMode?PREVIEW_DASHBOARD_STORAGE_KEY:(dashboardStorageKey||DASHBOARD_STORAGE_KEY), lock: task => navigator.locks ? navigator.locks.request('love-map-dashboard', task) : Promise.resolve().then(task) }), [previewMode,dashboardStorageKey,connectedDashboard]);
  const checkins = useMemo(() => ({ [currentName]: state.scores || [], [otherPerson(currentName)]: state.partnerScores || [] }), [state.scores, state.partnerScores, currentName]);
  const mutationVersion = useRef(0);
  const checkinsKey = JSON.stringify(checkins);
  useEffect(() => { const timer = setInterval(() => setDay(seoulDay()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let mounted = true;
    let reading = false;
    const refresh = () => { if (reading) return; reading = true; const version = mutationVersion.current; return store.read().then(next => { if (mounted && version === mutationVersion.current) { setData(next); setError(''); } }).catch(e => { if (mounted) setError(e.message); }).finally(() => { reading = false; }); };
    refresh();
    const storage = event => { if (event.key === (previewMode?PREVIEW_DASHBOARD_STORAGE_KEY:(dashboardStorageKey||DASHBOARD_STORAGE_KEY))) store.read().then(next => { if (mounted) setData(next); }).catch(e => { if (mounted) setError(e.message); }); };
    const timer = !previewMode && connectedDashboard ? setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, activeGame ? 800 : 10000) : null;
    window.addEventListener('storage', storage); window.addEventListener('focus', refresh);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('storage', storage); window.removeEventListener('focus', refresh); };
  }, [store, actor, day, checkinsKey, Boolean(activeGame)]);
  useEffect(() => {
    let mounted = true; const version = mutationVersion.current;
    store.act(actor, 'daily.sync', {}, checkins).then(next => { if (mounted && version === mutationVersion.current) setData(next); }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, [store, actor, day, checkinsKey]);
  const queue = data.queues[actor];
  useEffect(() => { setText(''); }, [actor, queue?.day, queue?.activeId, queue?.version]);
  async function act(action, payload) { mutationVersion.current++; try { const next = await store.act(actor, action, payload, checkins); setData(next); return next; } catch (e) { setError(e.message); throw e; } finally { mutationVersion.current++; } }
  async function saveAnswer() { if (busy || !text.trim()) return; setBusy(true); setError(''); try { await act('daily.answer', { text, questionId: queue.activeId, version: queue.version }); setText(''); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function openGame(kind) { setError(''); setActiveGame(kind); if (data.games[kind] || data.pendingResults?.[actor]?.[kind]) return; try { await act('game.open', { kind }); } catch (e) { setError(e.message); } }
  const incoming = data.replies.find(reply => reply.recipient === actor && reply.date === day);
  const outgoing = data.replies.find(reply => reply.author === actor && reply.date === day);
  const updateTimes = actor === currentName ? state.partnerUpdates || {} : Object.fromEntries(sections.map(section => [section.id, Object.entries(state.answerUpdatedAt || {}).filter(([key]) => key.startsWith(section.id + ':')).map(([, time]) => time).sort().at(-1)]));
  const updates = sections.filter(section => { const updated = updateTimes[section.id]; const read = [actor === currentName ? state.readPartnerUpdates?.[section.id] : '', data.readUpdates?.[actor]?.[section.id]].filter(Boolean).sort().at(-1); return updated && (!read || updated > read); });
  async function readUpdate(section) { try { await act('updates.read', { categoryId: section.id, updatedAt: updateTimes[section.id] }); onExplore(section); } catch (e) { setError(e.message); } }
  return <div className="dashboard-new">
    <div className="dash-section-top"><span className="eyebrow">A LITTLE CLOSER, TODAY</span></div>
    <section className="dash-updates"><div className="dash-card-heading"><div><span className="eyebrow">SOMETHING NEW</span><h2>오늘의 소식</h2></div><span className="dash-update-count">{updates.length ? `${updates.length}개의 새로운 이야기` : '모두 읽었어요'}</span></div><div className="dash-update-list">{updates.length ? updates.map(section => <button key={section.id} onClick={() => readUpdate(section)}><i/><span>{section.title}</span><small>{label(otherPerson(actor))}의 답변이 달라졌어요</small><ArrowRight size={16}/></button>) : <p className="dash-empty">새롭게 업데이트된 답변이 없어요.</p>}</div></section>
    <div className="dash-daily-grid"><section className="dash-daily-question"><div className="dash-card-heading"><div><span className="eyebrow">A QUESTION FOR YOU</span><h2>오늘의 질문</h2></div><span className="dash-person">TO. {label(actor)}</span></div>{queue?.answered && outgoing ? <div className="dash-submitted"><Check size={20}/><p>오늘의 마음을 전달했어요.</p><small>{label(outgoing.question)}</small></div> : queue?.activeId !== null && queue?.activeId !== undefined ? <><h3>{label(DAILY_QUESTIONS[queue.activeId])}</h3><textarea rows={4} maxLength={20000} value={text} onChange={event => setText(event.target.value)} aria-label="오늘의 질문 답변"/><div className="dash-answer-action"><button disabled={busy || !text.trim()} onClick={saveAnswer}>{busy ? '전달 중…' : '답변 보내기'}<ArrowRight size={15}/></button></div></> : <p className="dash-empty">오늘은 질문이 없어요.</p>}</section>
    <section className="dash-daily-answer"><div className="dash-card-heading"><div><span className="eyebrow">A LITTLE MORE OF YOU</span><h2>오늘의 답변</h2></div><span className="dash-person">FROM. {label(otherPerson(actor))}</span></div>{incoming ? <><h3>{label(incoming.question)}</h3><p className="dash-reply-text">{label(incoming.text)}</p></> : <div className="dash-answer-wait"><Heart size={20} strokeWidth={1.2}/><p>아직 도착한 답변이 없어요.</p></div>}</section></div>
    {error && <p className="asking-error" role="alert">{error}</p>}
    <div className="dash-lower-grid"><MonthlyTrend mine={state.scores} partner={state.partnerScores} currentName={currentName} onOpen={onHistory}/><button className="dash-archive" onClick={onArchive}><span className="eyebrow">OUR LITTLE ARCHIVE</span><div className="archive-drawing" aria-hidden="true"><Heart size={29} strokeWidth={1}/><i/><i/><i/></div><h2>함께 쌓아온 마음들</h2><span className="archive-open">기록 열어보기<ArrowRight size={17}/></span></button></div>
    <section className="dash-game-zone"><header className="dash-card-heading"><div><span className="eyebrow">A LITTLE PLAY, A LOT OF LOVE</span><h2>love game</h2></div><button className="dash-map-game" onClick={onGame}>애정 지도 게임하기<ArrowRight size={16}/></button></header><div className="dash-games">{Object.entries(GAME_NAMES).map(([kind, label], index) => <button className={`dash-game-tile tile-${kind}`} key={kind} onClick={() => openGame(kind)}><span className="game-tile-top"><span className="game-tile-number">0{index + 1}</span><span className="game-tile-status">{data.pendingResults?.[actor]?.[kind]?'결과 도착':data.games[kind]?.revision?(data.games[kind].turn===actor?'내 차례':'기다리는 중'):''}</span></span><div className={`game-tile-art art-${kind}`} aria-hidden="true">{kind === 'tic' ? <><GameMark person="여진"/><GameMark person="민재"/></> : kind === 'gomoku' ? <GomokuArt/> : <><span>1000</span><i/></>}</div><span className="game-tile-footer"><b>{label}</b><ArrowRight size={17}/></span></button>)}</div></section>
    {activeGame && <MiniGame kind={activeGame} actor={actor} data={data} act={act} onClose={() => setActiveGame(null)} previewMode={previewMode} onSwitch={() => onPreviewSwitch(otherPerson(actor))}/>}
  </div>;
}
