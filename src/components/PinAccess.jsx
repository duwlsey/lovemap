import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, X } from 'lucide-react';

export function PinField({ label, value, onChange, autoComplete = 'new-password', autoFocus = false }) {
  return <label>{label}<input className="pin-input" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete={autoComplete} autoFocus={autoFocus} value={value} onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 4))}/></label>;
}

function RecoveryReceipt({ result, onContinue }) {
  const [saved, setSaved] = useState(false), [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(result.recoveryCode); setCopied(true); } catch { setCopied(false); } }
  return <><span className="eyebrow">READY FOR TWO</span><h2>우리의 공간이<br/>준비됐어요.</h2>{result.inviteCode && <div className="pin-invite-receipt"><span>상대방에게 알려줄 연결 코드</span><strong>{result.inviteCode}</strong><small>하루 동안 사용할 수 있어요.</small></div>}<div className="pin-recovery-receipt"><span>나의 복구 코드</span><code>{result.recoveryCode}</code><button type="button" onClick={copy}>{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? '복사했어요' : '복사하기'}</button><p>비밀번호를 잊거나 새 기기에서 연결할 때 필요해요. 따로 보관해주세요.</p></div><label className="pin-confirm-saved"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/>복구 코드를 따로 보관했어요.</label><button className="button primary full" disabled={!saved} onClick={() => onContinue(result.session)}>우리의 공간으로<ArrowRight size={15}/></button></>;
}

export default function PinAccess({ store, onAuthenticated, onPreview, externalError }) {
  const [profiles, setProfiles] = useState(() => { try { return store.profiles(); } catch { return { profiles: [], selectedId: null }; } });
  const [page, setPage] = useState('enter'), [selectedId, setSelectedId] = useState(profiles.selectedId || profiles.profiles[0]?.id || ''), [name, setName] = useState(''), [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [invite, setInvite] = useState(''), [startedOn, setStartedOn] = useState(''), [recovery, setRecovery] = useState(''), [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const selected = profiles.profiles.find(profile => profile.id === selectedId);
  function go(next) { setPage(next); setPin(''); setConfirm(''); setError(''); setInvite(''); setResult(null); }
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      if (page !== 'enter' && pin !== confirm) throw new Error('비밀번호가 서로 달라요. 다시 확인해주세요.');
      if (page === 'enter') { onAuthenticated(await store.unlock(selectedId, pin)); return; }
      const receipt = page === 'create' ? await store.create({ name, pin, inviteCode: invite, startedOn }) : page === 'join' ? await store.join({ name, pin, inviteCode: invite }) : await store.recover(recovery, pin);
      setPin(''); setConfirm(''); setResult(receipt); setProfiles(store.profiles());
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <section className="landing-login pin-access">
    {result ? <RecoveryReceipt result={result} onContinue={onAuthenticated}/> : <>
      {page !== 'enter' && <button className="back-link pin-back" disabled={busy} onClick={() => go('enter')}><ArrowLeft size={14}/>돌아가기</button>}
      <span className="eyebrow">{page === 'enter' ? 'WELCOME BACK' : page === 'create' ? 'OUR BEGINNING' : page === 'join' ? 'BETTER TOGETHER' : 'WELCOME AGAIN'}</span>
      <h2>{page === 'enter' ? <>우리의 공간에<br/>입장해요.</> : page === 'create' ? <>우리의 이야기를<br/>시작해요.</> : page === 'join' ? <>같은 공간으로<br/>연결해요.</> : <>나의 공간을<br/>다시 찾아요.</>}</h2>
      {page === 'enter' ? selected ? <p>{selected.name}님, 비밀번호 네 자리를 입력해주세요.</p> : <p>처음이라면 새로운 공간을 만들어주세요.</p> : page === 'join' ? <p>상대방이 정한 연결 코드를 입력해주세요.</p> : page === 'recover' ? <p>보관한 복구 코드로 비밀번호를 다시 정해요.</p> : <p>서로를 알아갈 작은 공간을 만들어요.</p>}
      <form onSubmit={submit}>
        {page === 'enter' && profiles.profiles.length > 1 && <label>이 기기에서 입장할 사람<select className="pin-profile-select" value={selectedId} onChange={event => { setSelectedId(event.target.value); setPin(''); setError(''); store.remember(event.target.value); }}>{profiles.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>}
        {['create', 'join'].includes(page) && <label>내 이름<input value={name} onChange={event => setName(event.target.value)} required maxLength={20} autoComplete="nickname"/></label>}
        {page === 'recover' && <label>복구 코드<textarea className="pin-recovery-input" value={recovery} onChange={event => setRecovery(event.target.value)} required spellCheck={false} autoComplete="off" rows={2}/></label>}
        {(page !== 'enter' || selected) && <PinField label={page === 'recover' ? '새 비밀번호 4자리' : '나의 비밀번호 4자리'} value={pin} onChange={setPin} autoComplete={page === 'enter' ? 'current-password' : 'new-password'}/>}
        {page !== 'enter' && <PinField label="비밀번호 확인" value={confirm} onChange={setConfirm}/>}
        {['create', 'join'].includes(page) && <PinField label="두 사람의 연결 코드 4자리" value={invite} onChange={setInvite} autoComplete="off"/>}
        {page === 'create' && <label>사귀기 시작한 날<input type="date" required value={startedOn} max={today} onChange={event => setStartedOn(event.target.value)}/></label>}
        {(error || externalError) && <p className="form-error" role="alert">{error || externalError}</p>}
        {(page !== 'enter' || selected) && <button className="button primary full" disabled={busy}>{busy ? '확인 중…' : page === 'enter' ? '입장하기' : page === 'create' ? '시작하기' : page === 'join' ? '연결하기' : '비밀번호 다시 정하기'}<ArrowRight size={15}/></button>}
      </form>
      {page === 'enter' && <div className="pin-entry-actions"><button disabled={busy} onClick={() => go('create')}>새로 시작하기<ArrowRight size={14}/></button><button disabled={busy} onClick={() => go('join')}>상대방 연결하기<ArrowRight size={14}/></button><button className="pin-recover-link" disabled={busy} onClick={() => go('recover')}>비밀번호를 잊었나요? · 새 기기 연결</button></div>}
    </>}
    {!result && <div className="preview-entry"><button type="button" disabled={busy} onClick={onPreview}>로그인 없이 앱 둘러보기<ArrowRight size={14}/></button></div>}
  </section>;
}

export function AccountSettings({ store, session, onSession, onClose, onLogout }) {
  const [page, setPage] = useState('menu'), [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState(''), [invite, setInvite] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [newRecovery, setNewRecovery] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      if (page === 'pin') {
        if (next !== confirm) throw new Error('새 비밀번호가 서로 달라요.');
        onSession(await store.changePin(current, next));
        setNotice('비밀번호를 변경했어요.');
      } else if (page === 'recovery') { const receipt = await store.renewRecovery(current); setNewRecovery(receipt.recoveryCode); setNotice('복구 코드를 따로 보관해주세요. 이전 코드는 만료됐어요.'); }
      else { await store.renewInvite(current, invite); setNotice('연결 코드를 새로 정했어요. 하루 동안 사용할 수 있어요.'); }
      setCurrent(''); setNext(''); setConfirm(''); setInvite(''); setPage('menu');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="modal pin-settings" role="dialog" aria-modal="true" aria-labelledby="pin-settings-title"><button className="modal-close" disabled={busy} onClick={onClose} aria-label="닫기"><X size={18}/></button><span className="eyebrow">MY SPACE</span><h2 id="pin-settings-title">{session.displayName}의 계정</h2><p>{session.linked ? '두 사람이 같은 공간에 연결되어 있어요.' : '상대방과 연결할 준비가 되었어요.'}</p>{page === 'menu' ? <div className="pin-settings-actions"><button onClick={() => { setPage('pin'); setNotice(''); }}>비밀번호 변경<ArrowRight size={15}/></button>{!session.linked && <button onClick={() => { setPage('invite'); setNotice(''); }}>연결 코드 다시 정하기<ArrowRight size={15}/></button>}<button onClick={()=>{setPage('recovery');setNotice('');setNewRecovery('')}}>복구 코드 다시 발급<ArrowRight size={15}/></button><button onClick={onLogout}>로그아웃<ArrowRight size={15}/></button></div> : <form onSubmit={submit}><PinField label="현재 비밀번호" value={current} onChange={setCurrent} autoComplete="current-password"/>{page === 'pin' ? <><PinField label="새 비밀번호 4자리" value={next} onChange={setNext}/><PinField label="새 비밀번호 확인" value={confirm} onChange={setConfirm}/></> : page==='invite'&&<PinField label="새 연결 코드 4자리" value={invite} onChange={setInvite}/>}<button className="button primary full" disabled={busy}>{busy ? '변경 중…' : '변경하기'}</button><button type="button" className="text-button" disabled={busy} onClick={() => { setPage('menu'); setError(''); }}>돌아가기</button></form>}{error && <p className="form-error" role="alert">{error}</p>}{newRecovery&&<div className="pin-recovery-receipt"><code>{newRecovery}</code></div>}{notice && <p className="pin-notice" role="status">{notice}</p>}</section></div>;
}
