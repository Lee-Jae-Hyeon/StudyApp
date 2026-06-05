'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Icon, formatMinutes, recentDays, SUBJECTS, calculateCharacter, buildSampleSessions,
  SAMPLE_SUMMARIES, SAMPLE_MATERIALS, SAMPLE_NOTES, SAMPLE_QUIZZES,
  MarkdownPreview, summarizeLocally, usePrevious, pushToast, ToastHost, createId,
  StudySession, LearningMaterial, Summary, StudyNote, Quiz, User, Character,
} from './data';
import {
  AnkiCard, AnkiAppState, AnkiGrade,
  createAId, newCard, addBasicNote, addReversedNote, addClozeNote,
  schedule, peekLabel, getDeckCounts, buildQueue, getCardFB,
  makeDefaultAnkiState, loadAnkiFromStorage, saveAnkiToStorage,
} from './anki-engine';

/* ── Constants ── */
const NAV_ITEMS = [
  { id: 'overview',   icon: 'bar-chart-3',    label: '대시보드' },
  { id: 'timetable',  icon: 'calendar-days',  label: '시간표' },
  { id: 'timer',      icon: 'clock',          label: '포모도로' },
  { id: 'notes',      icon: 'book-open-text', label: '학습 노트' },
  { id: 'materials',  icon: 'upload-cloud',   label: '자료/요약' },
  { id: 'anki',       icon: 'layers',         label: 'Anki' },
  { id: 'stats',      icon: 'flame',          label: '통계' },
];
const TAB_TITLES: Record<string, string> = {
  overview: '학습 대시보드', timetable: '시간표', materials: '자료 / 요약',
  notes: '학습 노트', anki: 'Anki 스케줄러', timer: '포모도로', stats: '학습 통계',
};
const TAB_ROUTES = ['overview','timetable','materials','notes','anki','timer','stats'];
const NOTIFICATIONS = [
  { id: 'n1', icon: 'layers',        title: '오늘 복습할 Anki 카드가 기다리고 있어요.', time: '방금 전', unread: true },
  { id: 'n2', icon: 'flame',         title: '어제 학습으로 연속 출석이 이어졌어요.',    time: '어제',    unread: true },
  { id: 'n3', icon: 'sparkles',      title: '루미가 새로운 단계에 도달했어요.',         time: '2일 전',  unread: false },
  { id: 'n4', icon: 'check-circle-2',title: '지난주 학습 요약 리포트가 준비되었습니다.',time: '3일 전',  unread: false },
];
const SCHED_COLORS = ['#e0533a','#e8902f','#d9b008','#3fa45b','#3b78d9','#9a59c2'];
const MIN_WAGE = 10030;
const STAT_PALETTE = ['#c2613e','#3a9d6b','#4a78c4','#cc6a5a','#7a6cc4','#c267a8'];

/* ── Hooks ── */
function usePersistent<T>(key: string, initial: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>] {
  const K = 'hak.' + key;
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(K);
      return raw != null ? JSON.parse(raw) : typeof initial === 'function' ? (initial as () => T)() : initial;
    } catch { return typeof initial === 'function' ? (initial as () => T)() : initial; }
  });
  useEffect(() => { try { localStorage.setItem(K, JSON.stringify(val)); } catch {} }, [val]);
  return [val, setVal];
}

function parseHash(fb: string): string {
  const h = (location.hash || '').replace(/^#\/?/, '');
  return TAB_ROUTES.includes(h) ? h : fb;
}
function useHashRoute(fb: string): [string, (t: string) => void] {
  const [tab, setTab] = useState(() => parseHash(fb));
  useEffect(() => {
    const onHash = () => setTab(parseHash(fb));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (t: string) => {
    const next = '#/' + t;
    if (location.hash !== next) location.hash = next; else setTab(t);
  };
  return [tab, navigate];
}

/* ── CategoryManager ── */
function CategoryManager({ categories, counts, onAdd, onRename, onDelete, onClose }: {
  categories: string[]; counts: Record<string,number>; onAdd: (n:string)=>boolean;
  onRename: (o:string,n:string)=>void; onDelete: (n:string)=>void; onClose: ()=>void;
}) {
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<string|null>(null);
  const [editVal, setEditVal] = useState('');
  const [confirmDel, setConfirmDel] = useState<string|null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (confirmDel) setConfirmDel(null); else if (editing) setEditing(null); else onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmDel, editing]);
  return (
    <div className="anki-dialog-overlay" onClick={onClose}>
      <div className="anki-dialog cat-manager" role="dialog" aria-label="카테고리 관리" onClick={e => e.stopPropagation()}>
        <div className="cat-manager-head">
          <h3 className="dialog-title" style={{ margin: 0 }}>카테고리 관리</h3>
          <button className="icon-button" aria-label="닫기" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <p className="dialog-hint">여기서 만든 카테고리는 포모도로 · 학습 노트 · 자료/요약 · Anki 덱에서 함께 사용됩니다.</p>
        <div className="cat-list">
          {categories.map(name => {
            const used = counts?.[name] || 0;
            const isEditing = editing === name;
            return (
              <div className={`cat-row ${isEditing ? 'editing' : ''}`} key={name}>
                {isEditing
                  ? <input className="cat-edit-input" autoFocus value={editVal} maxLength={20}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => { if (e.key==='Enter') { onRename(editing!,editVal); setEditing(null); } if (e.key==='Escape') setEditing(null); }} />
                  : <span className="cat-name"><span className="cat-dot" />{name}</span>
                }
                {!isEditing && <span className="cat-count">{used > 0 ? `${used}곳 사용` : '사용 안 함'}</span>}
                {isEditing
                  ? <div className="cat-row-actions">
                      <button className="chip-button" onClick={() => { onRename(editing!,editVal); setEditing(null); }}><Icon name="check" size={13} />저장</button>
                      <button className="icon-button" onClick={() => setEditing(null)}><Icon name="x" size={14} /></button>
                    </div>
                  : <div className="cat-row-actions">
                      <button className="icon-button" onClick={() => { setEditing(name); setEditVal(name); }}><Icon name="pencil" size={14} /></button>
                      <button className="icon-button danger" disabled={categories.length <= 1} onClick={() => setConfirmDel(name)}><Icon name="trash-2" size={14} /></button>
                    </div>
                }
              </div>
            );
          })}
        </div>
        <div className="cat-add-row">
          <input className="cat-edit-input" placeholder="새 카테고리 이름" maxLength={20} value={adding}
            onChange={e => setAdding(e.target.value)}
            onKeyDown={e => { if (e.key==='Enter' && onAdd(adding)) setAdding(''); }} />
          <button className="primary-button" disabled={!adding.trim()} onClick={() => { if(onAdd(adding)) setAdding(''); }}>
            <Icon name="plus" size={15} color="#fff" />추가
          </button>
        </div>
        {confirmDel && (
          <div className="cat-confirm" onClick={e => e.stopPropagation()}>
            <p><strong>{confirmDel}</strong> 카테고리를 삭제할까요?<br />이 카테고리를 쓰던 항목은 다른 카테고리로 옮겨집니다.</p>
            <div className="dialog-actions">
              <button className="ghost-button" onClick={() => setConfirmDel(null)}>취소</button>
              <button className="danger-button" onClick={() => { onDelete(confirmDel!); setConfirmDel(null); }}>삭제</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryField({ categories, value, onChange, onManage, label='과목', style }: {
  categories: string[]; value: string; onChange: (v:string)=>void;
  onManage: ()=>void; label?: string; style?: React.CSSProperties;
}) {
  return (
    <div className="cat-field" style={style}>
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
        {value && !categories.includes(value) && <option value={value}>{value}</option>}
      </select>
      <button type="button" className="cat-manage-btn" title="카테고리 관리" aria-label="카테고리 관리" onClick={onManage}>
        <Icon name="settings-2" size={15} />
      </button>
    </div>
  );
}

/* ── Heatmap helpers ── */
function buildHeatDates(view: string, refDate: Date): (Date|null)[] {
  if (view === 'year') {
    const start = new Date(refDate.getFullYear(), 0, 1), end = new Date(refDate.getFullYear(), 11, 31);
    const dates: (Date|null)[] = Array.from({ length: start.getDay() }, () => null);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) dates.push(new Date(d));
    return dates;
  }
  if (view === 'month') {
    const start = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    const end = new Date(refDate.getFullYear(), refDate.getMonth()+1, 0);
    const dates: (Date|null)[] = Array.from({ length: start.getDay() }, () => null);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) dates.push(new Date(d));
    return dates;
  }
  const start = new Date(refDate); start.setDate(refDate.getDate() - refDate.getDay());
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d; });
}
function dateKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function heatTitle(view: string, date: Date) {
  if (view === 'year') return `${date.getFullYear()}`;
  if (view === 'month') return `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}`;
  const start = new Date(date); start.setDate(date.getDate()-date.getDay());
  const end = new Date(start); end.setDate(start.getDate()+6);
  return `${start.getMonth()+1}.${start.getDate()}-${end.getMonth()+1}.${end.getDate()}`;
}
function heatLevel(m: number) { if (m>=180) return 'l4'; if (m>=120) return 'l3'; if (m>=60) return 'l2'; if (m>0) return 'l1'; return ''; }
function isSameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

function ActivityHeatmap({ sessions }: { sessions: StudySession[] }) {
  const [view, setView] = useState('year');
  const [refDate, setRefDate] = useState(() => new Date());
  const minutesByDate = useMemo(() => {
    const map = new Map<string,number>();
    sessions.forEach(s => { const k = s.endTime.slice(0,10); map.set(k, (map.get(k)??0)+s.durationMinutes); });
    return map;
  }, [sessions]);
  const visibleDates = useMemo(() => buildHeatDates(view, refDate), [view, refDate]);
  const totalVisible = visibleDates.reduce((sum,it) => sum+(it ? minutesByDate.get(dateKey(it))??0 : 0), 0);
  function moveHeat(delta: number) {
    setRefDate(cur => {
      const n = new Date(cur);
      if (view==='year') n.setFullYear(cur.getFullYear()+delta);
      if (view==='month') n.setMonth(cur.getMonth()+delta);
      if (view==='week') n.setDate(cur.getDate()+delta*7);
      return n;
    });
  }
  return (
    <section className="header-heatmap" aria-label="학습 활동">
      <div className="hh-head">
        <div className="hh-nav">
          <button className="hh-arrow" aria-label="이전" onClick={() => moveHeat(-1)}>‹</button>
          <button className="hh-title-btn" title="클릭해서 연·월·주 전환"
            onClick={() => setView(v => v==='year'?'month':v==='month'?'week':'year')}>
            {heatTitle(view, refDate)}
          </button>
          <button className="hh-arrow" aria-label="다음" onClick={() => moveHeat(1)}>›</button>
        </div>
        <div className="hh-title"><span className="dot" />학습 활동</div>
      </div>
      <div className={`hh-body is-${view}`}>
        <div className="heat-days">{['일','월','화','수','목','금','토'].map(d => <span key={d}>{d}</span>)}</div>
        <div className={`heat-grid view-${view}`}>
          {visibleDates.map((it,idx) => {
            if (!it) return <div key={`e${idx}`} className="heat-cell empty" />;
            const k = dateKey(it), minutes = minutesByDate.get(k)??0;
            return (
              <div key={k} className={`heat-cell ${heatLevel(minutes)} ${isSameDay(it,new Date())?'today':''}`}
                data-date={k} title={`${k} · ${formatMinutes(minutes)}`}>
                {view==='month' && <><span className="hc-d">{it.getDate()}</span><span className="hc-m">{minutes>0?formatMinutes(minutes):''}</span></>}
                {view==='week' && <><span className="hc-dow">{['일','월','화','수','목','금','토'][it.getDay()]}</span><span className="hc-d">{it.getMonth()+1}/{it.getDate()}</span><span className="hc-m">{formatMinutes(minutes)}</span></>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="heat-legend">
        <span>{formatMinutes(totalVisible)}</span><span className="heat-sep">·</span><span>적음</span>
        <span className="swatch s0"/><span className="swatch s1"/><span className="swatch s2"/><span className="swatch s3"/><span className="swatch s4"/>
        <span>많음</span>
      </div>
    </section>
  );
}

function SessionClock({ sessions }: { sessions: StudySession[] }) {
  const todayStr = new Date().toISOString().slice(0,10);
  const SK = 'hak.sessStart.' + todayStr;
  const [startMs] = useState(() => {
    const v = localStorage.getItem(SK);
    if (v) return parseInt(v,10);
    const t = Date.now(); localStorage.setItem(SK, String(t)); return t;
  });
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(n => n+1), 1000); return () => clearInterval(id); }, []);
  const [acc, setAcc] = useState(() => {
    const existing = localStorage.getItem('hak.accKRW');
    if (existing != null) return parseInt(existing,10)||0;
    const totalMin = (sessions||[]).reduce((a,s) => a+s.durationMinutes, 0);
    const seed = Math.floor(totalMin/60)*MIN_WAGE;
    localStorage.setItem('hak.accKRW', String(seed));
    return seed;
  });
  const elapsedMs = Date.now()-startMs;
  const totalSec = Math.floor(elapsedMs/1000);
  const hh = Math.floor(totalSec/3600), mm = Math.floor(totalSec%3600/60), ss = totalSec%60;
  const timeStr = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  const todayValue = Math.floor(elapsedMs/3600000)*MIN_WAGE;
  useEffect(() => {
    const creditedKey = 'hak.accCredited.' + todayStr;
    const credited = parseInt(localStorage.getItem(creditedKey)||'0',10);
    if (todayValue > credited) {
      const base = parseInt(localStorage.getItem('hak.accKRW')||'0',10);
      const next = base+(todayValue-credited);
      localStorage.setItem('hak.accKRW', String(next));
      localStorage.setItem(creditedKey, String(todayValue));
      setAcc(next);
    }
  }, [todayValue, todayStr]);
  return (
    <div className="session-clock">
      <div className="sc-timer">{timeStr}</div>
      <div className="sc-value">오늘 학습가치 <strong>{todayValue>0 ? todayValue.toLocaleString('ko-KR')+'원' : '집계 중'}</strong></div>
      <div className="sc-acc">누적 {acc.toLocaleString('ko-KR')}원</div>
    </div>
  );
}

function CharacterFace({ level }: { level: number }) {
  const happy = level>=6, vhappy = level>=11;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="18" cy="18" r="15" fill="rgba(255,255,255,.65)" stroke="rgba(0,0,0,.08)" strokeWidth="1.5" />
      {vhappy ? <>
        <path d="M11 14 l2-2 2 2" stroke="rgba(0,0,0,.5)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M21 14 l2-2 2 2" stroke="rgba(0,0,0,.5)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M11 22 Q18 28 25 22" stroke="rgba(0,0,0,.5)" strokeWidth="1.9" fill="none" strokeLinecap="round" />
      </> : happy ? <>
        <circle cx="13" cy="16" r="1.9" fill="rgba(0,0,0,.45)" />
        <circle cx="23" cy="16" r="1.9" fill="rgba(0,0,0,.45)" />
        <path d="M12 22 Q18 26 24 22" stroke="rgba(0,0,0,.45)" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      </> : <>
        <circle cx="13" cy="16" r="1.6" fill="rgba(0,0,0,.4)" />
        <circle cx="23" cy="16" r="1.6" fill="rgba(0,0,0,.4)" />
        <path d="M13 23 Q18 21 23 23" stroke="rgba(0,0,0,.4)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </>}
    </svg>
  );
}

function CharacterCard({ character }: { character: Character }) {
  const prevLevel = usePrevious(character.level);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (prevLevel != null && character.level > prevLevel) {
      setCelebrate(true);
      pushToast(`루미가 레벨 ${character.level} · ${character.rankName}(으)로 성장했어요!`, { accent: true, icon: 'sparkles' });
      const t = setTimeout(() => setCelebrate(false), 1500);
      return () => clearTimeout(t);
    }
  }, [character.level]);
  return (
    <div className={`rumi ${celebrate ? 'levelup' : ''}`}>
      <div className="rumi-spark">
        {Array.from({ length: 8 }).map((_,i) => (
          <span key={i} style={{ left:`${10+i*11}%`, top:'60%', animationDelay:`${i*0.05}s`,
            background: i%2 ? 'oklch(0.78 0.14 50)' : 'oklch(0.85 0.15 95)' }} />
        ))}
      </div>
      <div className="rumi-head">
        <span className="rumi-tag">Lv.{character.level} · {character.rankName}</span>
        <span className="rumi-atd">{character.attendanceDays}일 출석</span>
      </div>
      <div className="rumi-row">
        <div className="rumi-face"><CharacterFace level={character.level} /></div>
        <div><h3 className="rumi-name">루미</h3><p className="rumi-desc">{character.desc}</p></div>
      </div>
      <div className="rumi-bar"><i style={{ width:`${character.progress}%` }} /></div>
      <div className="rumi-exp">{character.progress}%{character.nextInfo && <span> · 다음 계급 ?</span>}</div>
    </div>
  );
}

function AnkiWidget({ anki, onStart }: { anki: AnkiAppState; onStart: ()=>void }) {
  const totalNew = anki.decks.reduce((a,d) => a+getDeckCounts(anki,d.deckId).new, 0);
  const totalLearn = anki.decks.reduce((a,d) => a+getDeckCounts(anki,d.deckId).learn, 0);
  const totalDue = anki.decks.reduce((a,d) => a+getDeckCounts(anki,d.deckId).review, 0);
  const done = anki.todayCounts.new+anki.todayCounts.learn+anki.todayCounts.review;
  const total = totalNew+totalLearn+totalDue+done;
  const pct = total ? Math.round(done/total*100) : 0;
  return (
    <section className="anki" aria-label="Anki 스케줄러">
      <div className="anki-head">
        <div className="anki-title"><span className="dot" />ANKI 스케줄러</div>
        <div className="anki-due">오늘 마감 · 23:59</div>
      </div>
      <div className="anki-stats-row">
        <div className="anki-stat new"><span className="n">{totalNew}</span><span className="l">신규</span></div>
        <div className="anki-stat learn"><span className="n">{totalLearn}</span><span className="l">학습 중</span></div>
        <div className="anki-stat due"><span className="n">{totalDue}</span><span className="l">복습</span></div>
      </div>
      <div className="anki-foot">
        <div className="anki-progress"><i style={{ width:`${pct}%` }} /></div>
        <button className="anki-cta" onClick={onStart}>복습 시작 →</button>
      </div>
    </section>
  );
}

interface Sched { id: string; text: string; color: string; }
function CalDayCell({ day, isToday, isSel, hasSession, scheds, onClick }: {
  day: number; isToday: boolean; isSel: boolean; hasSession: boolean; scheds: Sched[]; onClick: ()=>void;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(scheds.length);
  useEffect(() => {
    const el = cellRef.current; if (!el) return;
    const BAR=8, GAP=3, HEADER=30;
    const measure = () => { const avail = el.clientHeight-HEADER; if (avail<=0) return; setFit(Math.max(1,Math.floor((avail+GAP)/(BAR+GAP)))); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const overflow = scheds.length > fit;
  const shown = overflow ? Math.max(1,fit-1) : scheds.length;
  return (
    <div ref={cellRef} className={`cal-cell ${isToday?'today':''} ${isSel?'cal-sel':''}`} onClick={onClick}>
      <span className="cal-date">{day}</span>
      {hasSession && <span className="cal-session-dot" title="학습 기록" />}
      <div className="cal-bars">
        {scheds.slice(0,shown).map(sc => <span key={sc.id} className="cal-bar" style={{ background:sc.color }} title={sc.text} />)}
        {overflow && <span className="cal-bar-more">+{scheds.length-shown}</span>}
      </div>
    </div>
  );
}

function CalendarWidget({ sessions }: { sessions: StudySession[] }) {
  const [cal, setCal] = useState(() => new Date());
  const [selDay, setSelDay] = useState<string|null>(null);
  const [schedules, setScheds] = useState<Record<string,Sched[]>>(() => {
    try { return JSON.parse(localStorage.getItem('hak.scheds')||'{}'); } catch { return {}; }
  });
  const [newText, setNewText] = useState('');
  const [newColor, setNewColor] = useState(SCHED_COLORS[3]);
  useEffect(() => { try { localStorage.setItem('hak.scheds', JSON.stringify(schedules)); } catch {} }, [schedules]);
  const year = cal.getFullYear(), month = cal.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay()+6)%7;
  const today = new Date();
  const sessionDays = new Set(sessions.filter(s => s.endTime.slice(0,7)===`${year}-${String(month+1).padStart(2,'0')}`).map(s => parseInt(s.endTime.slice(8,10),10)));
  const dayKey = (d: number) => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  function selectDay(d: number) { const k = dayKey(d); setSelDay(cur => cur===k?null:k); setNewText(''); }
  function addSchedule() {
    if (!newText.trim()||!selDay) return;
    setScheds(s => ({ ...s, [selDay]: [...(s[selDay]||[]), { id: String(Date.now()), text: newText.trim(), color: newColor }] }));
    setNewText('');
  }
  function removeSchedule(day: string, id: string) { setScheds(s => ({ ...s, [day]: (s[day]||[]).filter(x => x.id!==id) })); }
  function getDayStats(dateStr: string) {
    const ds = sessions.filter(s => s.endTime.slice(0,10)===dateStr);
    return { totalMin: ds.reduce((a,s) => a+s.durationMinutes, 0), count: ds.length };
  }
  const cells: React.ReactNode[] = [];
  for (let i=0; i<firstDow; i++) cells.push(<div key={`e${i}`} className="cal-cell empty" />);
  for (let d=1; d<=daysInMonth; d++) {
    const isToday = today.getFullYear()===year && today.getMonth()===month && today.getDate()===d;
    const k = dayKey(d), isSel = selDay===k, daySched = schedules[k]||[];
    cells.push(<CalDayCell key={d} day={d} isToday={isToday} isSel={isSel} hasSession={sessionDays.has(d)} scheds={daySched} onClick={() => selectDay(d)} />);
  }
  const trailing = (7-(firstDow+daysInMonth)%7)%7;
  for (let i=0; i<trailing; i++) cells.push(<div key={`t${i}`} className="cal-cell empty" />);
  const dayScheds = selDay ? schedules[selDay]||[] : [];
  const dayStats = selDay ? getDayStats(selDay) : null;
  return (
    <>
      <section className="panel">
        <div className="cal-head">
          <h3 className="panel-title">{year}년 {month+1}월</h3>
          <div className="cal-nav">
            <button className="cal-btn" aria-label="이전 달" onClick={() => setCal(d => new Date(d.getFullYear(),d.getMonth()-1,1))}>‹</button>
            <button className="cal-btn" onClick={() => setCal(new Date())}>오늘</button>
            <button className="cal-btn" aria-label="다음 달" onClick={() => setCal(d => new Date(d.getFullYear(),d.getMonth()+1,1))}>›</button>
          </div>
        </div>
        <div className="cal">
          {['월','화','수','목','금','토','일'].map(d => <div key={d} className="cal-dow">{d}</div>)}
          {cells}
        </div>
      </section>
      {selDay && (
        <div className="cal-modal-overlay" onClick={() => setSelDay(null)}>
          <div className="cal-day-panel" onClick={e => e.stopPropagation()}>
            <div className="cal-day-header">
              <h4>{selDay}</h4>
              <button className="icon-button" onClick={() => setSelDay(null)} aria-label="닫기"><Icon name="x" size={14} /></button>
            </div>
            <div className="cal-day-stats">
              <div className="cal-stat-item"><span>타이머</span><b>{dayStats ? formatMinutes(dayStats.totalMin) : '0분'}</b></div>
              <div className="cal-stat-item"><span>세션</span><b>{dayStats?.count??0}회</b></div>
              <div className="cal-stat-item"><span>노트</span><b>0건</b></div>
              <div className="cal-stat-item"><span>Anki</span><b>0개</b></div>
            </div>
            <div className="cal-schedule-section">
              <h5>스케줄</h5>
              {dayScheds.length===0 && <p className="empty-text" style={{ padding:'8px 0' }}>등록된 스케줄이 없습니다.</p>}
              {dayScheds.map(sc => (
                <div key={sc.id} className="cal-schedule-row">
                  <span className="cal-mark" style={{ background:sc.color }} />
                  <span className="cal-sc-text">{sc.text}</span>
                  <button className="cal-sc-del" onClick={() => removeSchedule(selDay,sc.id)} aria-label="삭제"><Icon name="x" size={12} /></button>
                </div>
              ))}
              <div className="cal-schedule-add">
                <div className="cal-color-swatches">
                  {SCHED_COLORS.map(c => <button key={c} type="button" className={`cal-swatch${newColor===c?' active':''}`} style={{ background:c }} onClick={() => setNewColor(c)} aria-label={c} />)}
                </div>
                <input type="text" className="cal-text-input" placeholder="스케줄 추가…" value={newText}
                  onChange={e => setNewText(e.target.value)} onKeyDown={e => { if (e.key==='Enter') addSchedule(); }} />
                <button className="chip-button" disabled={!newText.trim()} onClick={addSchedule}><Icon name="plus" size={13} />추가</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Overview({ character, sessions, anki, onGoAnki }: {
  character: Character; sessions: StudySession[]; anki: AnkiAppState; onGoAnki: ()=>void;
}) {
  const total = sessions.reduce((a,s) => a+s.durationMinutes, 0);
  const todayStr = new Date().toISOString().slice(0,10);
  const todayMin = sessions.filter(s => s.endTime.slice(0,10)===todayStr).reduce((a,s) => a+s.durationMinutes, 0);
  const weekStart = recentDays(7)[0];
  const weekMin = sessions.filter(s => s.endTime.slice(0,10)>=weekStart).reduce((a,s) => a+s.durationMinutes, 0);
  const dates = new Set(sessions.map(s => s.endTime.slice(0,10)));
  let streak = 0;
  for (let i=0; i<365; i++) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const k = d.toISOString().slice(0,10);
    if (dates.has(k)) streak++; else if (i>0) break;
  }
  return (
    <div className="overview-grid">
      <div className="overview-main"><CalendarWidget sessions={sessions} /></div>
      <aside className="rail">
        <CharacterCard character={character} />
        <section className="today-stats">
          <h4>오늘 / 누적</h4>
          <div className="ts-row"><span>오늘 학습</span><span className="v">{formatMinutes(todayMin)}</span></div>
          <div className="ts-row"><span>이번 주</span><span className="v">{formatMinutes(weekMin)}</span></div>
          <div className="ts-row"><span>총 학습 시간</span><span className="v">{formatMinutes(total)}</span></div>
          <div className="ts-row"><span>연속 학습</span><span className="v">{streak}일</span></div>
        </section>
        <AnkiWidget anki={anki} onStart={onGoAnki} />
      </aside>
    </div>
  );
}

/* ── Shell ── */
function LoginScreen({ onLogin }: { onLogin: (provider: string, nick: string) => void }) {
  const [nick, setNick] = useState('');
  return (
    <main className="auth-shell">
      <div className="auth-aurora" />
      <section className="auth-panel">
        <div className="brand-mark"><Icon name="sparkles" size={28} /></div>
        <h1>AI 학습 어시스턴트</h1>
        <p>자료 요약, 노트 복습, Anki 카드, 타이머 기록, 캐릭터 성장까지 한 흐름으로 관리합니다.</p>
        <div className="nickname-row">
          <label htmlFor="nickname">닉네임</label>
          <input id="nickname" type="text" placeholder="화면에 표시할 이름" maxLength={20} value={nick}
            onChange={e => setNick(e.target.value)}
            onKeyDown={e => { if (e.key==='Enter') onLogin('KAKAO', nick); }} />
          <span className="nickname-hint">비우고 진행하면 기본 이름이 사용됩니다.</span>
        </div>
        <div className="auth-actions">
          <button className="provider-button google" onClick={() => onLogin('GOOGLE', nick)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M21.35 11.1H12v3.8h5.32c-.23 1.49-1.7 4.36-5.32 4.36-3.2 0-5.81-2.65-5.81-5.92s2.61-5.92 5.81-5.92c1.82 0 3.04.78 3.74 1.44l2.55-2.46C16.78 4.74 14.62 3.7 12 3.7c-4.79 0-8.67 3.88-8.67 8.67S7.21 21.04 12 21.04c5 0 8.32-3.51 8.32-8.46 0-.57-.06-1-.13-1.48z" /></svg>
            Google 계정으로 로그인
          </button>
          <button className="provider-button kakao" onClick={() => onLogin('KAKAO', nick)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#2c2100"><path d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.84 5.32 4.6 6.74-.2.71-.73 2.57-.83 2.97-.13.5.18.5.39.36.16-.1 2.55-1.73 3.58-2.43.74.11 1.5.16 2.26.16 5.52 0 10-3.58 10-8s-4.48-7.8-10-7.8z" /></svg>
            Kakao로 시작
          </button>
          <button className="provider-button naver" onClick={() => onLogin('NAVER', nick)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M16.273 12.845 7.376 0H0v24h7.726V11.155L16.624 24H24V0h-7.727z" /></svg>
            Naver로 시작
          </button>
        </div>
        <p className="footer-note">로그인 정보는 이 브라우저에만 저장됩니다 (데모용).<br />실제 OAuth 연동은 백엔드 설정 후 가능합니다.</p>
      </section>
    </main>
  );
}

function NotifyButton() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(NOTIFICATIONS);
  const unread = notes.filter(n => n.unread).length;
  return (
    <div className="notify-wrap">
      <button className="topbar-icon-btn" aria-label="알림" title="알림" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="bell" size={18} />{unread>0 && <span className="notify-dot" />}
      </button>
      {open && <>
        <div className="notify-scrim" onClick={() => setOpen(false)} />
        <div className="notify-panel" role="dialog" aria-label="알림">
          <div className="notify-head">
            <span className="notify-title">알림{unread>0 ? ` · ${unread}` : ''}</span>
            <button className="notify-readall" onClick={() => setNotes(ns => ns.map(n => ({ ...n, unread:false })))} disabled={unread===0}>모두 읽음</button>
          </div>
          <ul className="notify-list">
            {notes.map(n => (
              <li key={n.id} className={`notify-item ${n.unread?'is-unread':''}`}>
                <span className="notify-ico"><Icon name={n.icon} size={16} /></span>
                <div className="notify-body"><p className="notify-text">{n.title}</p><span className="notify-time">{n.time}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </>}
    </div>
  );
}

function Sidebar({ activeTab, onTab, user, onLogout, attendance }: {
  activeTab: string; onTab: (t:string)=>void; user: User; onLogout: ()=>void; attendance: number;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel = NAV_ITEMS.find(it => it.id===activeTab)?.label ?? '대시보드';
  const pick = (id: string) => { onTab(id); setOpen(false); };
  return (
    <>
      <header className="mobile-bar">
        <div className="mobile-left">
          <button className="hamburger" aria-label="메뉴 열기" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" size={22} /></button>
          <span className="mobile-title">{activeLabel}</span>
        </div>
        <div className="mobile-actions">
          <span className="attend-badge"><strong>{user.nickname}</strong>님 {attendance}번째 출석!</span>
          <NotifyButton />
          <button className="topbar-icon-btn" aria-label="로그아웃" title="로그아웃" onClick={onLogout}><Icon name="log-out" size={18} /></button>
        </div>
      </header>
      {open && <div className="drawer-scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open?'is-open':''}`}>
        <div>
          <div className="brand">
            <span className="brand-mark"><Icon name="sparkles" size={22} /></span>
            <span>AI 학습 어시스턴트</span>
            <button className="drawer-close" aria-label="메뉴 닫기" onClick={() => setOpen(false)}><Icon name="x" size={20} /></button>
          </div>
          <nav className="nav">
            {NAV_ITEMS.map(it => (
              <button key={it.id} className={`nav-button ${activeTab===it.id?'active':''}`} onClick={() => pick(it.id)}>
                <Icon name={it.icon} size={18} />{it.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="user">
          <span className="user-avatar">{user.nickname.slice(0,1).toUpperCase()}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div className="user-name">{user.nickname}</div>
            <div className="user-sub">{user.provider} 로그인</div>
          </div>
          <button className="user-logout" title="로그아웃" aria-label="로그아웃" onClick={onLogout}><Icon name="log-out" size={16} /></button>
        </div>
      </aside>
    </>
  );
}

/* ── Views ── */
function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe/3600), m = Math.floor(safe%3600/60), s = safe%60;
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function SessionList({ sessions, selected=[], onToggle }: {
  sessions: StudySession[]; selected?: string[]; onToggle?: (id:string)=>void;
}) {
  if (sessions.length===0) return <p className="empty-text">아직 기록된 학습 시간이 없습니다.</p>;
  return (
    <div className="session-list">
      {sessions.map(s => (
        <div className={`session-row ${selected.includes(s.sessionId)?'is-selected':''}`} key={s.sessionId}>
          {onToggle && <input type="checkbox" className="row-check" checked={selected.includes(s.sessionId)} onChange={() => onToggle(s.sessionId)} aria-label={`${s.subject} 기록 선택`} />}
          <Icon name="clock" size={17} />
          <div>
            <strong>{s.subject}</strong>
            <span>{s.timerType==='POMODORO'?'포모도로':s.timerType==='TIMER'?'타이머':'스톱워치'} · {new Date(s.endTime).toLocaleString('ko-KR')}</span>
          </div>
          <b>{formatMinutes(s.durationMinutes)}</b>
        </div>
      ))}
    </div>
  );
}

function SessionPanel({ sessions, onDeleteSession }: { sessions: StudySession[]; onDeleteSession: (ids:string[])=>void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected(s => s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  return (
    <>
      <div className="section-heading">
        <h3>자동 기록</h3>
        {selected.length>0
          ? <div style={{ display:'flex', gap:6 }}>
              <button className="chip-button danger" onClick={() => { onDeleteSession(selected); setSelected([]); }}><Icon name="trash-2" size={13} />삭제 ({selected.length})</button>
              <button className="chip-button" onClick={() => setSelected([])}><Icon name="x" size={13} />취소</button>
            </div>
          : <span>{sessions.length}개</span>
        }
      </div>
      <SessionList sessions={sessions} selected={selected} onToggle={toggle} />
    </>
  );
}

function MaterialsView({ summaries, materials, categories, onManageCategories, selectedSummary, selectedSummaryId, uploadStatus, isSummarizing, onUpload, onSelectSummary, onDeleteSummary, pinnedMaterials=[], onTogglePinMaterial }: {
  summaries: Summary[]; materials: LearningMaterial[]; categories: string[];
  onManageCategories: ()=>void; selectedSummary?: Summary; selectedSummaryId: string;
  uploadStatus: string; isSummarizing: boolean;
  onUpload: (e:React.ChangeEvent<HTMLInputElement>, cat:string)=>void;
  onSelectSummary: (id:string)=>void; onDeleteSummary: (id:string)=>void;
  pinnedMaterials?: string[]; onTogglePinMaterial: (id:string)=>void;
}) {
  const [selMats, setSelMats] = useState<string[]>([]);
  const [selSums, setSelSums] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [uploadCat, setUploadCat] = useState(categories[0]||'기타');
  const [filterCat, setFilterCat] = useState('all');
  const [openMCats, setOpenMCats] = useState(new Set<string>());
  useEffect(() => { if (!categories.includes(uploadCat)) setUploadCat(categories[0]||'기타'); }, [categories]);
  const toggleMat = (id:string) => setSelMats(s => s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const toggleMCat = (cat:string) => setOpenMCats(s => { const n=new Set(s); n.has(cat)?n.delete(cat):n.add(cat); return n; });
  const toggleSum = (id:string) => setSelSums(s => s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const togglePin = (id:string) => setPinned(p => p.includes(id)?p.filter(x=>x!==id):p.length<5?[...p,id]:p);
  const canPin = selSums.length>0 && (selSums.every(id=>pinned.includes(id))||pinned.length<5);
  const visibleSums = filterCat==='all'?summaries:summaries.filter(s=>s.category===filterCat);
  const sortedSums = [...visibleSums.filter(s=>pinned.includes(s.summaryId)),...visibleSums.filter(s=>!pinned.includes(s.summaryId))];
  const extraCats = [...new Set(materials.map(m=>m.category||'기타'))].filter(c=>!categories.includes(c));
  const allMatCats = [...categories,...extraCats];
  const filteredCats = filterCat==='all'?allMatCats:allMatCats.filter(c=>c===filterCat);
  return (
    <div className="two-column view-enter">
      <section className="panel">
        <div className="section-heading"><h3>학습 자료 업로드</h3><span>PDF · TXT · MD · CSV · JSON</span></div>
        <div className="upload-cat-row">
          <span className="upload-cat-label">카테고리</span>
          <CategoryField categories={categories} value={uploadCat} onChange={setUploadCat} onManage={onManageCategories} style={{ flex:1 }} />
        </div>
        <label className={`upload-zone ${isSummarizing?'busy':''}`}>
          <Icon name="upload-cloud" size={36} />
          <strong>{isSummarizing?'요약 생성 중':'파일 선택'}</strong>
          <span>{uploadStatus}</span>
          <span className="upload-cat-pill">{uploadCat} 카테고리로 저장</span>
          <input type="file" accept=".pdf,.txt,.md,.csv,.json,.py,.js,.ts,.html" onChange={e=>onUpload(e,uploadCat)} disabled={isSummarizing} />
        </label>
        <div className="list-block-sep" />
        <div className="list-block">
          <div className="list-block-head">
            <h4>업로드 자료</h4>
            {selMats.length>0 && <button className="chip-button danger" onClick={()=>setSelMats([])}><Icon name="trash-2" size={13} />삭제 ({selMats.length})</button>}
          </div>
          {(() => {
            const favMats = materials.filter(m=>pinnedMaterials.includes(m.materialId));
            return (
              <div className="mat-cat-group">
                <button className="mat-cat-header" onClick={()=>toggleMCat('__fav__')}>
                  <span className="mat-cat-chevron" style={{transform:openMCats.has('__fav__')?'rotate(90deg)':'rotate(0deg)'}}><Icon name="star" size={13} /></span>
                  <span className="mat-cat-name" style={{color:'oklch(0.68 0.15 78)'}}>즐겨찾기</span>
                  <span className="mat-cat-count">{favMats.length}</span>
                </button>
                {openMCats.has('__fav__') && favMats.length===0 && <p className="note-empty-cat" style={{paddingLeft:28}}>즐겨찾기한 자료가 없습니다</p>}
                {openMCats.has('__fav__') && favMats.map(m=>(
                  <div className={`list-row mat-row mat-indent ${selMats.includes(m.materialId)?'is-selected':''}`} key={m.materialId}>
                    <input type="checkbox" className="row-check" checked={selMats.includes(m.materialId)} onChange={()=>toggleMat(m.materialId)} aria-label={`${m.fileName} 선택`} />
                    <Icon name="file-text" size={17} />
                    <div><strong>{m.fileName}</strong><span>{m.fileType} · {new Date(m.uploadedAt).toLocaleString('ko-KR')}</span></div>
                    <button className="note-ctx-btn" style={{opacity:1,color:'oklch(0.68 0.15 78)'}} onClick={()=>onTogglePinMaterial(m.materialId)} aria-label="즐겨찾기 해제"><Icon name="star" size={13} /></button>
                  </div>
                ))}
              </div>
            );
          })()}
          {materials.length===0 ? <p className="empty-text">아직 업로드한 자료가 없습니다.</p>
          : filteredCats.map(cat=>{
            const catMats = materials.filter(m=>(m.category||'기타')===cat);
            const isOpen = openMCats.has(cat);
            return (
              <div key={cat} className="mat-cat-group">
                <button className="mat-cat-header" onClick={()=>toggleMCat(cat)}>
                  <span className="mat-cat-chevron" style={{transform:isOpen?'rotate(90deg)':'rotate(0deg)'}}><Icon name="chevron-right" size={13} /></span>
                  <span className="mat-cat-name">{cat}</span>
                  <span className="mat-cat-count">{catMats.length}</span>
                </button>
                {isOpen && catMats.length===0 && <p className="note-empty-cat" style={{paddingLeft:28}}>자료가 없습니다</p>}
                {isOpen && catMats.map(m=>(
                  <div className={`list-row mat-row mat-indent ${selMats.includes(m.materialId)?'is-selected':''}`} key={m.materialId}>
                    <input type="checkbox" className="row-check" checked={selMats.includes(m.materialId)} onChange={()=>toggleMat(m.materialId)} aria-label={`${m.fileName} 선택`} />
                    <Icon name="file-text" size={17} />
                    <div><strong>{m.fileName}</strong><span>{m.fileType} · {new Date(m.uploadedAt).toLocaleString('ko-KR')}</span></div>
                    <button className="note-ctx-btn"
                      style={{opacity:pinnedMaterials.includes(m.materialId)?1:undefined,color:pinnedMaterials.includes(m.materialId)?'oklch(0.68 0.15 78)':undefined}}
                      onClick={()=>onTogglePinMaterial(m.materialId)} aria-label={pinnedMaterials.includes(m.materialId)?'즐겨찾기 해제':'즐겨찾기 추가'}>
                      <Icon name="star" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h3>저장된 요약</h3>
          <div className="sum-toolbar">
            {selSums.length>0 && <>
              <button className="chip-button" disabled={!canPin} onClick={()=>{selSums.forEach(id=>togglePin(id));setSelSums([]);}}>
                <Icon name="pin" size={13} />{selSums.every(id=>pinned.includes(id))?'고정 해제':`고정 ${pinned.length}/5`}
              </button>
              <button className="chip-button danger" onClick={()=>setSelSums([])}><Icon name="trash-2" size={13} />삭제 ({selSums.length})</button>
            </>}
            <select className="cat-filter" value={filterCat} onChange={e=>setFilterCat(e.target.value)} aria-label="카테고리 필터">
              <option value="all">전체 카테고리</option>
              {categories.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <span className="sum-count">{sortedSums.length}개</span>
          </div>
        </div>
        <div className="split-list">
          <div className="summary-list">
            {summaries.length===0 ? <p className="empty-text">요약이 생성되면 이곳에 저장됩니다.</p>
            : sortedSums.map(s=>(
              <div key={s.summaryId} className={`sum-row ${selSums.includes(s.summaryId)?'is-selected':''}`}>
                <input type="checkbox" className="row-check" checked={selSums.includes(s.summaryId)} onChange={()=>toggleSum(s.summaryId)} aria-label={`${s.title} 선택`} />
                <button className={`summary-item ${s.summaryId===selectedSummaryId?'active':''}`} onClick={()=>onSelectSummary(s.summaryId)}>
                  {pinned.includes(s.summaryId) && <span className="pin-dot"><Icon name="pin" size={10} /></span>}
                  <strong>{s.title}</strong>
                  <span className="sum-meta">{s.category&&<span className="cat-chip">{s.category}</span>}{s.sourceType==='material'?'자료 요약':'노트 요약'}</span>
                </button>
              </div>
            ))}
          </div>
          <div className="split-divider" />
          <article className="summary-detail">
            {selectedSummary ? <>
              <div className="detail-title">
                <div><h4>{selectedSummary.title}</h4><span>{selectedSummary.category?selectedSummary.category+' · ':''}{new Date(selectedSummary.createdAt).toLocaleString('ko-KR')}</span></div>
                <button className="icon-button danger" aria-label="요약 삭제" onClick={()=>onDeleteSummary(selectedSummary.summaryId)}><Icon name="trash-2" size={17} /></button>
              </div>
              <MarkdownPreview content={selectedSummary.content} />
            </> : <p className="empty-text">조회할 요약을 선택하세요.</p>}
          </article>
        </div>
      </section>
    </div>
  );
}

function NotesView({ notes, categories, onManageCategories, selectedNote, selectedNoteId, noteDraft, quizzes, onSelectNote, onDraftChange, onSave, onNew, onDelete, onSummarize, onQuiz, onAddCategory, onRenameCategory, onDeleteCategory, onRenameNote, pinnedNotes=[], onTogglePinNote, summaries=[], onGoToSummary, onDeleteSummary }: {
  notes: StudyNote[]; categories: string[]; onManageCategories: ()=>void;
  selectedNote?: StudyNote; selectedNoteId: string;
  noteDraft: { title:string; subject:string; markdownContent:string };
  quizzes: Quiz[];
  onSelectNote: (id:string)=>void; onDraftChange: (d:any)=>void;
  onSave: ()=>void; onNew: ()=>void; onDelete: (id:string)=>void;
  onSummarize: ()=>void; onQuiz: ()=>void;
  onAddCategory: (n:string)=>boolean; onRenameCategory: (o:string,n:string)=>void; onDeleteCategory: (n:string)=>void;
  onRenameNote: (id:string,t:string)=>void;
  pinnedNotes?: string[]; onTogglePinNote?: (id:string)=>void;
  summaries?: Summary[]; onGoToSummary?: (id:string)=>void; onDeleteSummary?: (id:string)=>void;
}) {
  const allCats = useMemo(() => {
    const extra = [...new Set(notes.map(n=>n.subject||'기타'))].filter(k=>!categories.includes(k));
    return [...categories,...extra];
  }, [categories,notes]);
  const grouped = useMemo(() => {
    const map: Record<string,StudyNote[]> = {};
    notes.forEach(n => { const k=n.subject||'기타'; if(!map[k]) map[k]=[]; map[k].push(n); });
    return map;
  }, [notes]);
  const summariesByCategory = useMemo(() => {
    const map: Record<string,Summary[]> = {};
    (summaries||[]).forEach(s => { const k=s.category||'기타'; if(!map[k]) map[k]=[]; map[k].push(s); });
    return map;
  }, [summaries]);
  const pinnedNoteObjects = useMemo(() => notes.filter(n=>(pinnedNotes||[]).includes(n.noteId)), [notes,pinnedNotes]);
  const [openCats, setOpenCats] = useState(() => new Set(['__fav__']));
  const toggleCat = (cat:string) => setOpenCats(s=>{const n=new Set(s);n.has(cat)?n.delete(cat):n.add(cat);return n;});
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current=true; return; }
    if (selectedNote) setOpenCats(s=>{const n=new Set(s);n.add(selectedNote.subject||'기타');return n;});
  }, [selectedNoteId]);
  const [editingCat, setEditingCat] = useState<{name:string;value:string}|null>(null);
  const [editingNote, setEditingNote] = useState<{noteId:string;value:string}|null>(null);
  const [openMenu, setOpenMenu] = useState<string|null>(null);
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  useEffect(() => {
    if (!openMenu) return;
    const close = (e:MouseEvent) => { if (!(e.target as Element).closest('.note-ctx-wrap')) setOpenMenu(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);
  return (
    <div className="notes-layout view-enter">
      <section className="panel note-index">
        <div className="section-heading">
          <h3>노트 목록</h3>
          <div style={{ display:'flex', gap:4 }}>
            <button className="icon-button" aria-label="카테고리 추가" onClick={()=>{setAddingCat(true);setNewCatName('');}}><Icon name="folder-plus" size={15} /></button>
            <button className="icon-button" aria-label="새 노트" onClick={onNew}><Icon name="plus" size={17} /></button>
          </div>
        </div>
        <div className="note-cat-group">
          <div className={`note-cat-header ${pinnedNoteObjects.some(n=>n.noteId===selectedNoteId)?'has-active':''}`}>
            <button className="note-cat-toggle" onClick={()=>toggleCat('__fav__')}>
              <span className="note-cat-chevron" style={{transform:openCats.has('__fav__')?'rotate(90deg)':'rotate(0deg)'}}><Icon name="star" size={13} /></span>
            </button>
            <button className="note-cat-label-btn" onClick={()=>toggleCat('__fav__')}>
              <span className="note-cat-name" style={{color:'oklch(0.68 0.15 78)'}}>즐겨찾기</span>
              <span className="note-cat-count">{pinnedNoteObjects.length}</span>
            </button>
          </div>
          {openCats.has('__fav__') && pinnedNoteObjects.map(note=>(
            <div key={note.noteId} className={`note-list-row ${note.noteId===selectedNoteId?'active':''}`}>
              <button className="note-list-item" onClick={()=>onSelectNote(note.noteId)}>
                <strong>{note.title}</strong>
                <span>{note.subject} · {new Date(note.updatedAt).toLocaleDateString('ko-KR')}</span>
              </button>
              <button className="note-ctx-btn" style={{opacity:1,color:'oklch(0.68 0.15 78)'}} onClick={()=>onTogglePinNote&&onTogglePinNote(note.noteId)} aria-label="즐겨찾기 해제"><Icon name="star" size={13} /></button>
            </div>
          ))}
          {openCats.has('__fav__') && pinnedNoteObjects.length===0 && <p className="note-empty-cat">즐겨찾기한 노트가 없습니다</p>}
        </div>
        {allCats.map(cat=>{
          const catNotes = grouped[cat]||[];
          const isOpen = openCats.has(cat);
          const hasActive = catNotes.some(n=>n.noteId===selectedNoteId);
          const isEditingCat = editingCat?.name===cat;
          const catMenuKey = `cat:${cat}`;
          return (
            <div key={cat} className="note-cat-group">
              <div className={`note-cat-header ${hasActive?'has-active':''}`}>
                <button className="note-cat-toggle" onClick={()=>toggleCat(cat)}>
                  <span className="note-cat-chevron" style={{transform:isOpen?'rotate(90deg)':'rotate(0deg)'}}><Icon name="chevron-right" size={13} /></span>
                </button>
                {isEditingCat
                  ? <input className="note-inline-input" autoFocus value={editingCat!.value}
                      onChange={e=>setEditingCat({...editingCat!,value:e.target.value})}
                      onBlur={()=>{if(editingCat?.value.trim())onRenameCategory(editingCat.name,editingCat.value.trim());setEditingCat(null);}}
                      onKeyDown={e=>{if(e.key==='Enter'){if(editingCat?.value.trim())onRenameCategory(editingCat!.name,editingCat!.value.trim());setEditingCat(null);}if(e.key==='Escape')setEditingCat(null);}} />
                  : <button className="note-cat-label-btn" onClick={()=>toggleCat(cat)}>
                      <span className="note-cat-name">{cat}</span>
                      <span className="note-cat-count">{catNotes.length}</span>
                    </button>
                }
                <div className="note-ctx-wrap">
                  <button className="note-ctx-btn" aria-label="카테고리 옵션" onClick={()=>setOpenMenu(openMenu===catMenuKey?null:catMenuKey)}><Icon name="more-horizontal" size={14} /></button>
                  {openMenu===catMenuKey && (
                    <div className="note-ctx-menu">
                      <button onClick={()=>{setEditingCat({name:cat,value:cat});setOpenMenu(null);}}><Icon name="pencil" size={13} />이름 변경</button>
                      <button className="danger" onClick={()=>{onDeleteCategory(cat);setOpenMenu(null);}}><Icon name="trash-2" size={13} />삭제</button>
                    </div>
                  )}
                </div>
              </div>
              {isOpen && catNotes.map(note=>{
                const isEditingNote = editingNote?.noteId===note.noteId;
                const noteMenuKey = `note:${note.noteId}`;
                return (
                  <div key={note.noteId} className={`note-list-row ${note.noteId===selectedNoteId?'active':''}`}>
                    {isEditingNote
                      ? <input className="note-inline-input note-inline-note" autoFocus value={editingNote!.value}
                          onChange={e=>setEditingNote({...editingNote!,value:e.target.value})}
                          onBlur={()=>{if(editingNote?.value.trim())onRenameNote(editingNote!.noteId,editingNote!.value.trim());setEditingNote(null);}}
                          onKeyDown={e=>{if(e.key==='Enter'){if(editingNote?.value.trim())onRenameNote(editingNote!.noteId,editingNote!.value.trim());setEditingNote(null);}if(e.key==='Escape')setEditingNote(null);}} />
                      : <button className="note-list-item" onClick={()=>onSelectNote(note.noteId)}>
                          <strong>{note.title}</strong>
                          <span>{new Date(note.updatedAt).toLocaleDateString('ko-KR')}</span>
                        </button>
                    }
                    <div className="note-ctx-wrap">
                      <button className="note-ctx-btn" aria-label="노트 옵션" onClick={()=>setOpenMenu(openMenu===noteMenuKey?null:noteMenuKey)}><Icon name="more-horizontal" size={14} /></button>
                      {openMenu===noteMenuKey && (
                        <div className="note-ctx-menu">
                          <button onClick={()=>{onTogglePinNote&&onTogglePinNote(note.noteId);setOpenMenu(null);}}><Icon name="star" size={13} />{(pinnedNotes||[]).includes(note.noteId)?'즐겨찾기 해제':'즐겨찾기 추가'}</button>
                          <button onClick={()=>{setEditingNote({noteId:note.noteId,value:note.title});setOpenMenu(null);}}><Icon name="pencil" size={13} />이름 변경</button>
                          <button className="danger" onClick={()=>{onDelete(note.noteId);setOpenMenu(null);}}><Icon name="trash-2" size={13} />삭제</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {isOpen && catNotes.length===0 && <p className="note-empty-cat">노트가 없습니다</p>}
              {isOpen && (summariesByCategory[cat]||[]).map(sum=>(
                <div key={sum.summaryId} className="note-sum-row">
                  <Icon name="scroll" size={13} />
                  <button className="note-sum-btn" onClick={()=>onGoToSummary&&onGoToSummary(sum.summaryId)}>
                    <strong>{sum.title}</strong>
                    <span>{sum.sourceType==='note'?'노트 요약':'자료 요약'}</span>
                  </button>
                  {onDeleteSummary && <button className="note-ctx-btn" onClick={()=>onDeleteSummary(sum.summaryId)} aria-label="요약 삭제"><Icon name="trash-2" size={12} /></button>}
                </div>
              ))}
            </div>
          );
        })}
        {addingCat && (
          <div className="note-add-cat-row">
            <Icon name="folder-plus" size={14} />
            <input className="note-inline-input" autoFocus placeholder="새 카테고리 이름" value={newCatName}
              onChange={e=>setNewCatName(e.target.value)}
              onBlur={()=>{if(newCatName.trim())onAddCategory(newCatName.trim());setAddingCat(false);setNewCatName('');}}
              onKeyDown={e=>{if(e.key==='Enter'){if(newCatName.trim())onAddCategory(newCatName.trim());setAddingCat(false);setNewCatName('');}if(e.key==='Escape'){setAddingCat(false);setNewCatName('');}}} />
          </div>
        )}
        {notes.length===0 && allCats.length===0 && <p className="empty-text">첫 학습 노트를 작성해 보세요.</p>}
      </section>
      <section className="panel note-editor">
        <div className="editor-toolbar">
          <input value={noteDraft.title} onChange={e=>onDraftChange({...noteDraft,title:e.target.value})} aria-label="노트 제목" />
          <CategoryField categories={categories} value={noteDraft.subject} onChange={v=>onDraftChange({...noteDraft,subject:v})} onManage={onManageCategories} style={{minWidth:140}} />
          <button className="primary-button" onClick={onSave}><Icon name="save" size={16} color="#fff" /> 저장</button>
        </div>
        <div className="inline-actions">
          <button className="secondary-button" disabled={!selectedNote} onClick={onSummarize}><Icon name="bot" size={16} /> 노트 요약</button>
          <button className="secondary-button" disabled={!selectedNote} onClick={onQuiz}><Icon name="sparkles" size={16} /> 문제 생성</button>
          {selectedNote && <button className="danger-button" onClick={()=>onDelete(selectedNote.noteId)}><Icon name="trash-2" size={16} /> 삭제</button>}
        </div>
        <textarea className="markdown-input" value={noteDraft.markdownContent} onChange={e=>onDraftChange({...noteDraft,markdownContent:e.target.value})} aria-label="마크다운 노트 내용" />
      </section>
      <section className="panel note-preview">
        <div className="section-heading"><h3>미리보기</h3><span>Markdown</span></div>
        <MarkdownPreview content={noteDraft.markdownContent} />
        <div className="quiz-box">
          <h4>복습 문제</h4>
          {quizzes.length===0 ? <p className="empty-text">문제를 생성하면 이곳에 표시됩니다.</p>
          : quizzes.map(q=><details key={q.quizId}><summary>{q.question}</summary><p>{q.answer}</p></details>)}
        </div>
      </section>
    </div>
  );
}

/* ── Timer ── */
interface TimerCfg { timerH:number; timerM:number; timerS:number; pomoStudySec:number; pomoBreakSec:number; pomoRepeat:number; pomoRound:number; }

function PomoClock({ kind, label, hms, totalSec, active, running, liveSeconds, totalSeconds, onSet }: {
  kind:string; label:string; hms:{m:number;s:number}; totalSec:number;
  active:boolean; running:boolean; liveSeconds:number; totalSeconds:number;
  onSet:(part:string,val:string,max:number)=>void;
}) {
  const R=82, C=2*Math.PI*R;
  const showLive = running&&active;
  const faceSec = showLive ? liveSeconds : totalSec;
  const pct = showLive&&totalSeconds>0 ? Math.min(1,1-liveSeconds/totalSeconds) : 0;
  const dash = C*(1-pct);
  const editable = !running;
  const stateCls = running?(active?'is-active':'is-idle'):'';
  return (
    <div className={`pomo-clock ${kind} ${stateCls}`}>
      <div className="pomo-clock-label"><span className={`pomo-clock-dot ${kind}`}/>{label}</div>
      <div className={`timer-ring pomo ${kind==='break'?'break':''} ${showLive?'running-ring':''}`}>
        <svg viewBox="0 0 200 200">
          <circle className="ring-track" cx="100" cy="100" r={R}/>
          <circle className="ring-fill" cx="100" cy="100" r={R} strokeDasharray={C} strokeDashoffset={dash}/>
        </svg>
        {editable
          ? <div className="timer-face timer-face-edit pomo-face">
              <div className="timer-hms">
                <input className="thms-input pomo-thms" type="number" min={0} max={99} value={hms.m}
                  onChange={e=>onSet('m',e.target.value,99)} onFocus={e=>e.target.select()} aria-label={`${label} 분`}/>
                <span className="thms-sep">:</span>
                <input className="thms-input pomo-thms" type="number" min={0} max={59} value={hms.s}
                  onChange={e=>onSet('s',e.target.value,59)} onFocus={e=>e.target.select()} aria-label={`${label} 초`}/>
              </div>
            </div>
          : <div className="timer-face pomo-face">{formatTimer(faceSec)}</div>
        }
      </div>
    </div>
  );
}

function TimerView({ timerType, seconds, isRunning, subject, categories, onManageCategories, sessions, totalSeconds, pomoPhase, onTypeChange, onSubjectChange, onStart, onPause, onFinish, onReset, onRecordLap, onStopAndReset, onDeleteSession, timerCfg, setTimerCfg }: {
  timerType:string; seconds:number; isRunning:boolean; subject:string; categories:string[];
  onManageCategories:()=>void; sessions:StudySession[]; totalSeconds:number; pomoPhase:string;
  onTypeChange:(t:string)=>void; onSubjectChange:(s:string)=>void;
  onStart:()=>void; onPause:()=>void; onFinish:()=>void; onReset:()=>void;
  onRecordLap:()=>void; onStopAndReset:()=>void; onDeleteSession:(ids:string[])=>void;
  timerCfg:TimerCfg; setTimerCfg:React.Dispatch<React.SetStateAction<TimerCfg>>;
}) {
  const [presets, setPresets] = useState<{id:string;name:string;study:number;brk:number;repeat:number}[]>(() => {
    try { return JSON.parse(localStorage.getItem('hak.presets')||'null')||[{id:'p1',name:'기본 25/5',study:25,brk:5,repeat:4},{id:'p2',name:'딥워크 50/10',study:50,brk:10,repeat:3}]; }
    catch { return []; }
  });
  useEffect(()=>{ try{localStorage.setItem('hak.presets',JSON.stringify(presets));}catch{} },[presets]);
  const [timerFavs, setTimerFavs] = useState<{id:string;name:string;h:number;m:number;s:number}[]>(() => {
    try { return JSON.parse(localStorage.getItem('hak.timerFavs')||'null')||[{id:'t1',name:'25분 집중',h:0,m:25,s:0},{id:'t2',name:'5분 휴식',h:0,m:5,s:0},{id:'t3',name:'50분 딥워크',h:0,m:50,s:0}]; }
    catch { return []; }
  });
  useEffect(()=>{ try{localStorage.setItem('hak.timerFavs',JSON.stringify(timerFavs));}catch{} },[timerFavs]);
  const applyFav=(f:{h:number;m:number;s:number})=>{ setTimerCfg(c=>({...c,timerH:f.h,timerM:f.m,timerS:f.s})); onReset(); };
  const saveFav=()=>{
    if(timerFavs.length>=10)return;
    const h=timerCfg.timerH||0,m=timerCfg.timerM||0,s=timerCfg.timerS||0;
    if(h+m+s===0)return;
    const name=[h?`${h}시간`:'',m?`${m}분`:'',s?`${s}초`:''].filter(Boolean).join(' ');
    setTimerFavs(fs=>[...fs,{id:'t'+Date.now(),name,h,m,s}]);
  };
  const favSecs=(f:{h:number;m:number;s:number})=>f.h*3600+f.m*60+f.s;
  const applyPreset=(p:{study:number;brk:number;repeat:number})=>{ setTimerCfg(c=>({...c,pomoStudySec:(p.study||0)*60,pomoBreakSec:(p.brk||0)*60,pomoRepeat:p.repeat})); onReset(); };
  const savePreset=()=>{
    if(presets.length>=10)return;
    const sMin=Math.round(timerCfg.pomoStudySec/60),bMin=Math.round(timerCfg.pomoBreakSec/60);
    setPresets(ps=>[...ps,{id:'p'+Date.now(),name:`${sMin}분/${bMin}분×${timerCfg.pomoRepeat}`,study:sMin,brk:bMin,repeat:timerCfg.pomoRepeat}]);
  };
  const secToHMS=(t:number)=>({h:Math.floor(t/3600),m:Math.floor(t%3600/60),s:t%60});
  const pomoStudyHMS=secToHMS(timerCfg.pomoStudySec||0);
  const pomoBreakHMS=secToHMS(timerCfg.pomoBreakSec||0);
  const setPomoHMS=(key:'pomoStudySec'|'pomoBreakSec',part:string,val:string,max:number)=>setTimerCfg(c=>{
    const cur=secToHMS(c[key]||0) as Record<string,number>;
    cur[part]=Math.max(0,Math.min(max,Math.floor(+val)||0));
    return {...c,[key]:Math.max(0,cur.h*3600+cur.m*60+cur.s)};
  });
  const R=110,C=2*Math.PI*R;
  const pct=totalSeconds>0?Math.min(1,1-seconds/totalSeconds):0;
  const dashOffset=C*(1-pct);
  const isCountdown=timerType==='POMODORO'||timerType==='TIMER';
  const editableTimer=timerType==='TIMER'&&!isRunning;
  const setHMS=(key:string,val:string,max:number)=>setTimerCfg(c=>({...c,[key]:Math.max(0,Math.min(max,Math.floor(+val)||0))}));
  return (
    <div className="timer-layout view-enter">
      <section className={`panel timer-panel ${isRunning?'timer-running':''}`}>
        <div className="segmented">
          <button className={timerType==='STOPWATCH'?'active':''} onClick={()=>onTypeChange('STOPWATCH')}>스톱워치</button>
          <button className={timerType==='TIMER'?'active':''} onClick={()=>onTypeChange('TIMER')}>타이머</button>
          <button className={timerType==='POMODORO'?'active':''} onClick={()=>onTypeChange('POMODORO')}>포모도로</button>
        </div>
        <CategoryField categories={categories} value={subject} onChange={onSubjectChange} onManage={onManageCategories} style={{maxWidth:260}}/>
        {timerType==='POMODORO'
          ? <div className="pomo-clocks">
              <div className="pomo-cycle-rep pomo-repeat-top">
                <button className="pomo-step" disabled={isRunning} onClick={()=>setTimerCfg(c=>({...c,pomoRepeat:Math.max(1,c.pomoRepeat-1)}))}>−</button>
                <span className="pomo-cycle-text"><strong>{timerCfg.pomoRound}</strong> / {timerCfg.pomoRepeat} 회 반복</span>
                <button className="pomo-step" disabled={isRunning} onClick={()=>setTimerCfg(c=>({...c,pomoRepeat:Math.min(12,c.pomoRepeat+1)}))}>+</button>
              </div>
              <div className="pomo-clocks-row">
                <PomoClock kind="study" label="학습시간" hms={pomoStudyHMS} totalSec={timerCfg.pomoStudySec}
                  active={pomoPhase==='study'} running={isRunning} liveSeconds={seconds} totalSeconds={totalSeconds}
                  onSet={(p,v,mx)=>setPomoHMS('pomoStudySec',p,v,mx)}/>
                <div className="pomo-cycle"><div className="pomo-divider"/></div>
                <PomoClock kind="break" label="휴게시간" hms={pomoBreakHMS} totalSec={timerCfg.pomoBreakSec}
                  active={pomoPhase==='break'} running={isRunning} liveSeconds={seconds} totalSeconds={totalSeconds}
                  onSet={(p,v,mx)=>setPomoHMS('pomoBreakSec',p,v,mx)}/>
              </div>
            </div>
          : <div className={`timer-ring ${editableTimer?'editable':''}`}>
              <svg viewBox="0 0 240 240">
                <circle className="ring-track" cx="120" cy="120" r={R}/>
                {isCountdown&&<circle className="ring-fill" cx="120" cy="120" r={R} strokeDasharray={C} strokeDashoffset={dashOffset}/>}
              </svg>
              {editableTimer
                ? <div className="timer-face timer-face-edit">
                    <div className="timer-hms">
                      <input className="thms-input" type="number" min={0} max={23} value={timerCfg.timerH} onChange={e=>setHMS('timerH',e.target.value,23)} onFocus={e=>e.target.select()} aria-label="시간"/>
                      <span className="thms-sep">:</span>
                      <input className="thms-input" type="number" min={0} max={59} value={timerCfg.timerM} onChange={e=>setHMS('timerM',e.target.value,59)} onFocus={e=>e.target.select()} aria-label="분"/>
                      <span className="thms-sep">:</span>
                      <input className="thms-input" type="number" min={0} max={59} value={timerCfg.timerS} onChange={e=>setHMS('timerS',e.target.value,59)} onFocus={e=>e.target.select()} aria-label="초"/>
                    </div>
                  </div>
                : <div className="timer-face">{formatTimer(seconds)}</div>
              }
            </div>
        }
        <div className="timer-actions">
          {isRunning
            ? <button className="secondary-button" onClick={onPause}><Icon name="pause" size={17}/> 일시정지</button>
            : <button className="primary-button" onClick={onStart}><Icon name="play" size={17} color="#fff"/> 시작</button>
          }
          <button className="secondary-button" onClick={timerType==='STOPWATCH'?onRecordLap:onFinish}><Icon name="bookmark-plus" size={17}/> 기록</button>
          <button className="ghost-button" onClick={timerType==='STOPWATCH'?onStopAndReset:onReset}><Icon name="timer-reset" size={17}/> 종료/초기화</button>
        </div>
      </section>
      <div className="timer-right">
        {timerType==='POMODORO'&&(
          <section className="panel">
            <div className="section-heading">
              <h3>포모도로 프리셋</h3>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{color:'var(--muted)',fontSize:11}}>{presets.length}/10</span>
                <button className="chip-button" disabled={presets.length>=10} onClick={savePreset}><Icon name="pin" size={13}/>현재 고정</button>
              </div>
            </div>
            <div className="preset-list">
              {presets.length===0&&<p className="empty-text">저장된 프리셋이 없습니다.</p>}
              {presets.map(p=>(
                <div key={p.id} className="preset-row">
                  <button className="preset-btn" onClick={()=>applyPreset(p)}><strong>{p.name}</strong><span>{p.study}분 학습 · {p.brk}분 휴식 · {p.repeat}회</span></button>
                  <button className="icon-button" onClick={()=>setPresets(ps=>ps.filter(x=>x.id!==p.id))} aria-label="삭제"><Icon name="x" size={14}/></button>
                </div>
              ))}
            </div>
          </section>
        )}
        {timerType==='TIMER'&&(
          <section className="panel">
            <div className="section-heading">
              <h3>타이머 즐겨찾기</h3>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{color:'var(--muted)',fontSize:11}}>{timerFavs.length}/10</span>
                <button className="chip-button" disabled={timerFavs.length>=10||(timerCfg.timerH||0)+(timerCfg.timerM||0)+(timerCfg.timerS||0)===0} onClick={saveFav}><Icon name="pin" size={13}/>현재 시간 저장</button>
              </div>
            </div>
            <div className="preset-list">
              {timerFavs.length===0&&<p className="empty-text">저장된 타이머가 없습니다.</p>}
              {timerFavs.map(f=>(
                <div key={f.id} className="preset-row">
                  <button className="preset-btn" onClick={()=>applyFav(f)}><strong>{f.name}</strong><span>{formatTimer(favSecs(f))}</span></button>
                  <button className="icon-button" onClick={()=>setTimerFavs(fs=>fs.filter(x=>x.id!==f.id))} aria-label="삭제"><Icon name="x" size={14}/></button>
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="panel">
          <SessionPanel sessions={sessions} onDeleteSession={onDeleteSession}/>
        </section>
      </div>
    </div>
  );
}

function StatsView({ sessions, categories }: { sessions:StudySession[]; categories:string[] }) {
  const todayStr=new Date().toISOString().slice(0,10);
  const monthStr=new Date().toISOString().slice(0,7);
  const monthly=sessions.filter(s=>s.endTime.slice(0,7)===monthStr).reduce((a,s)=>a+s.durationMinutes,0);
  const todaySess=sessions.filter(s=>s.endTime.slice(0,10)===todayStr);
  const pastSess=sessions.filter(s=>{const ago=(Date.now()-new Date(s.endTime).getTime())/86400000;return ago>0&&ago<=30;});
  const allSubs=[...new Set([...(categories||[]),...sessions.map(s=>s.subject)])];
  const subjectData=allSubs.map(sub=>{
    const todayMin=todaySess.filter(s=>s.subject===sub).reduce((a,s)=>a+s.durationMinutes,0);
    const avgMin=pastSess.filter(s=>s.subject===sub).reduce((a,s)=>a+s.durationMinutes,0)/30;
    return{sub,todayMin,avgMin};
  }).filter(d=>d.todayMin>0||d.avgMin>0.5);
  const maxMin=Math.max(30,...subjectData.map(d=>Math.max(d.todayMin,d.avgMin)));
  const subjectTotals=allSubs.map(sub=>({subject:sub,value:sessions.filter(s=>s.subject===sub).reduce((a,s)=>a+s.durationMinutes,0)})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
  const maxSub=Math.max(30,...subjectTotals.map(x=>x.value));
  return (
    <div className="stats-grid view-enter">
      <section className="metric-card"><span>이번 달 학습</span><strong>{formatMinutes(monthly)}</strong><p>월간 누적</p></section>
      <section className="metric-card"><span>세션 수</span><strong>{sessions.length}회</strong><p>기록된 학습</p></section>
      <section className="panel chart-panel">
        <div className="section-heading"><h3>오늘 vs 평균 비교</h3><span>30일 평균 기준</span></div>
        {subjectData.length===0?<p className="empty-text">오늘 학습 기록이 없습니다.</p>
        :<div className="horiz-chart">
          {subjectData.map(({sub,todayMin,avgMin})=>{
            const todayPct=todayMin/maxMin*100,avgPct=avgMin/maxMin*100,aboveAvg=todayMin>avgMin&&avgMin>0;
            return(
              <div key={sub} className="hc-row">
                <div className="hc-label">{sub}</div>
                <div className="hc-track">
                  {avgMin>0&&<div className="hc-avg-bar" style={{width:`${avgPct}%`}}/>}
                  {todayMin>0&&<div className="hc-today-bar" style={{width:`${todayPct}%`}}>{aboveAvg&&<div className="hc-avg-marker" style={{left:`${avgPct/todayPct*100}%`}}/>}</div>}
                </div>
                <div className="hc-value"><strong>{todayMin>0?formatMinutes(todayMin):'—'}</strong><span>평균 {formatMinutes(Math.round(avgMin))}</span></div>
              </div>
            );
          })}
        </div>}
      </section>
      <section className="panel chart-panel">
        <div className="section-heading"><h3>과목별 누적 학습</h3><span>{subjectTotals.length}개 과목</span></div>
        <div className="subject-chart">
          {subjectTotals.length===0?<p className="empty-text">학습 세션을 기록하면 과목별 분석이 표시됩니다.</p>
          :subjectTotals.map(it=>(
            <div className="subject-row" key={it.subject}>
              <span>{it.subject}</span>
              <div><i style={{width:`${Math.max(10,it.value/maxSub*100)}%`}}/></div>
              <strong>{it.value}분</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TimetableView() {
  const DAYS=['월','화','수','목','금','토','일'];
  const HOURS=Array.from({length:17},(_,i)=>i+7);
  const COLORS=['#e0533a','#e8902f','#d9b008','#3fa45b','#3b78d9','#9a59c2'];
  const [blocks,setBlocks]=useState<Record<string,{label:string;color:string}>>(() => {
    try{return JSON.parse(localStorage.getItem('hak.timetable')||'{}');}catch{return {};}
  });
  useEffect(()=>{try{localStorage.setItem('hak.timetable',JSON.stringify(blocks));}catch{}},[blocks]);
  const [editing,setEditing]=useState<{d:number;h:number;k:string;isNew:boolean}|null>(null);
  const [editLabel,setEditLabel]=useState('');
  const [editColor,setEditColor]=useState(COLORS[3]);
  const [selected,setSelected]=useState(new Set<string>());
  const [bulkLabel,setBulkLabel]=useState('');
  const [bulkColor,setBulkColor]=useState(COLORS[3]);
  const [confirmReset,setConfirmReset]=useState(false);
  const cellKey=(d:number,h:number)=>`${d}-${h}`;
  const clearAll=()=>{setBlocks({});setSelected(new Set());setConfirmReset(false);};
  const handleCellClick=(d:number,h:number)=>{
    const k=cellKey(d,h),b=blocks[k];
    if(b){setEditLabel(b.label);setEditColor(b.color);setEditing({d,h,k,isNew:false});}
    else{setSelected(s=>{const n=new Set(s);n.has(k)?n.delete(k):n.add(k);return n;});}
  };
  const saveBulk=()=>{
    if(!bulkLabel.trim()||selected.size===0)return;
    const upd:Record<string,{label:string;color:string}>={};
    selected.forEach(k=>{upd[k]={label:bulkLabel.trim(),color:bulkColor};});
    setBlocks(b=>({...b,...upd}));setSelected(new Set());setBulkLabel('');
  };
  const save=()=>{
    if(!editing)return;
    if(editLabel.trim())setBlocks(b=>({...b,[editing.k]:{label:editLabel.trim(),color:editColor}}));
    else setBlocks(b=>{const n={...b};delete n[editing.k];return n;});
    setEditing(null);
  };
  return (
    <div className="timetable-layout view-enter">
      <section className="panel timetable-panel">
        <div>
          <div className="section-heading">
            <h3>주간 시간표</h3>
            {selected.size===0&&<span style={{color:'var(--muted)',fontSize:11}}>빈 칸 클릭으로 선택 · 채워진 칸은 편집</span>}
            <button className="icon-button" title="시간표 초기화" aria-label="시간표 초기화" onClick={()=>setConfirmReset(true)}
              style={{marginLeft:'auto',opacity:Object.keys(blocks).length>0?1:0.3,pointerEvents:Object.keys(blocks).length>0?'auto':'none'}}>
              <Icon name="rotate-ccw" size={15}/>
            </button>
          </div>
          {selected.size>0&&(
            <div className="tt-bulk-bar">
              <div style={{display:'flex',gap:4,flexShrink:0}}>
                {COLORS.map(c=><button key={c} type="button" className={`cal-swatch${bulkColor===c?' active':''}`} style={{background:c,width:18,height:18,borderRadius:'50%'}} onClick={()=>setBulkColor(c)}/>)}
              </div>
              <input className="cal-text-input" style={{height:30,fontSize:13,padding:'0 10px',flex:1,minWidth:0}} placeholder="일정 이름…" value={bulkLabel}
                autoFocus onChange={e=>setBulkLabel(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter')saveBulk();if(e.key==='Escape')setSelected(new Set());}}/>
              <button className="chip-button" style={{flexShrink:0}} disabled={!bulkLabel.trim()} onClick={saveBulk}><Icon name="check" size={13}/>{selected.size}칸 추가</button>
              <button className="chip-button" style={{flexShrink:0}} onClick={()=>setSelected(new Set())}><Icon name="x" size={13}/>취소</button>
            </div>
          )}
        </div>
        <div className="tt-scroll">
          <div className="timetable-grid" style={{gridTemplateColumns:'44px repeat(7,1fr)'}}>
            <div className="tt-corner"/>
            {DAYS.map(d=><div key={d} className="tt-day-head">{d}</div>)}
            {HOURS.map(h=>(
              <React.Fragment key={h}>
                <div className="tt-hour"><div className="tt-hour-label"><span className="tt-hh">{h}</span><span className="tt-mm">:00</span></div></div>
                {DAYS.map((_,di)=>{
                  const k=cellKey(di,h),b=blocks[k],isSel=selected.has(k);
                  return(
                    <div key={k} className={`tt-cell ${b?'has-block':''} ${isSel?'tt-selected':''}`}
                      style={b?{borderLeft:`3px solid ${b.color}`,background:b.color+'18'}:isSel?{background:bulkColor+'28',borderLeft:`3px solid ${bulkColor}`}:{}}
                      onClick={()=>handleCellClick(di,h)}>
                      {b&&<span className="tt-block-label" style={{color:b.color}}>{b.label}</span>}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
            <div className="tt-hour tt-hour-end"><div className="tt-hour-label"><span className="tt-hh">24</span><span className="tt-mm">:00</span></div></div>
            {DAYS.map((_,di)=><div key={`end-${di}`} className="tt-cell tt-cell-end"/>)}
          </div>
        </div>
      </section>
      {confirmReset&&(
        <div className="cal-modal-overlay" onClick={()=>setConfirmReset(false)}>
          <div className="cal-day-panel" onClick={e=>e.stopPropagation()} style={{maxWidth:320}}>
            <div className="cal-day-header">
              <h4>시간표 초기화</h4>
              <button className="icon-button" onClick={()=>setConfirmReset(false)} aria-label="닫기"><Icon name="x" size={14}/></button>
            </div>
            <p style={{margin:'12px 0',fontSize:13,color:'var(--ink-2)',lineHeight:1.55}}>시간표에 입력된 모든 일정이 삭제됩니다.<br/>정말 초기화할까요?</p>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="ghost-button" onClick={()=>setConfirmReset(false)}>취소</button>
              <button className="danger-button" onClick={clearAll}><Icon name="trash-2" size={15}/>초기화</button>
            </div>
          </div>
        </div>
      )}
      {editing&&(
        <div className="cal-modal-overlay" onClick={()=>setEditing(null)}>
          <div className="cal-day-panel" onClick={e=>e.stopPropagation()}>
            <div className="cal-day-header">
              <h4>{DAYS[editing.d]}요일 {editing.h}:00</h4>
              <button className="icon-button" onClick={()=>setEditing(null)} aria-label="닫기"><Icon name="x" size={14}/></button>
            </div>
            <div style={{padding:'12px 0',display:'flex',flexDirection:'column',gap:10}}>
              <div className="cal-color-swatches">
                {COLORS.map(c=><button key={c} type="button" className={`cal-swatch${editColor===c?' active':''}`} style={{background:c}} onClick={()=>setEditColor(c)}/>)}
              </div>
              <input className="cal-text-input" autoFocus placeholder="수업/활동 이름…" value={editLabel}
                onChange={e=>setEditLabel(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape')setEditing(null);}}/>
              <div style={{display:'flex',gap:8}}>
                <button className="primary-button" onClick={save}><Icon name="check" size={15} color="#fff"/>저장</button>
                {!editing.isNew&&<button className="danger-button" onClick={()=>{setBlocks(b=>{const n={...b};delete n[editing!.k];return n;});setEditing(null);}}><Icon name="trash-2" size={15}/>삭제</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Anki Dialogs ── */
function AnkiDialogShell({ title, children, onClose }: { title:string; children:React.ReactNode; onClose:()=>void }) {
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[onClose]);
  return (
    <div className="anki-dialog-overlay" onClick={onClose}>
      <div className="anki-dialog" role="dialog" aria-label={title} onClick={e=>e.stopPropagation()}>
        <h3 className="dialog-title">{title}</h3>{children}
      </div>
    </div>
  );
}

function AnkiTextDialog({ title, label, initial, placeholder, confirmLabel, onConfirm, onClose }: {
  title:string; label:string; initial?:string; placeholder?:string; confirmLabel:string;
  onConfirm:(v:string)=>void; onClose:()=>void;
}) {
  const [val,setVal]=useState(initial||'');
  const ok=val.trim().length>0;
  return (
    <AnkiDialogShell title={title} onClose={onClose}>
      <label className="dialog-field"><span>{label}</span>
        <input autoFocus type="text" value={val} placeholder={placeholder} maxLength={60}
          onChange={e=>setVal(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&ok)onConfirm(val.trim());}}/>
      </label>
      <div className="dialog-actions">
        <button className="ghost-button" onClick={onClose}>취소</button>
        <button className="primary-button" disabled={!ok} onClick={()=>onConfirm(val.trim())}>{confirmLabel}</button>
      </div>
    </AnkiDialogShell>
  );
}

function AnkiDeckDialog({ title, categories, initial, confirmLabel, onConfirm, onManage, onClose }: {
  title:string; categories:string[]; initial?:{name:string;category:string};
  confirmLabel:string; onConfirm:(name:string,cat:string)=>void; onManage:()=>void; onClose:()=>void;
}) {
  const cats=categories&&categories.length?categories:['기타'];
  const [name,setName]=useState(initial?.name||'');
  const [cat,setCat]=useState(initial?.category||cats[0]);
  const ok=name.trim().length>0;
  return (
    <AnkiDialogShell title={title} onClose={onClose}>
      <label className="dialog-field"><span>덱 이름</span>
        <input autoFocus type="text" value={name} placeholder="예: 전공 - 자료구조" maxLength={40}
          onChange={e=>setName(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&ok)onConfirm(name.trim(),cat);}}/>
      </label>
      <label className="dialog-field"><span>카테고리</span>
        <div className="cat-field" style={{width:'100%'}}>
          <select value={cat} onChange={e=>setCat(e.target.value)}>
            {cats.map(c=><option key={c} value={c}>{c}</option>)}
            {cat&&!cats.includes(cat)&&<option value={cat}>{cat}</option>}
          </select>
          <button type="button" className="cat-manage-btn" title="카테고리 관리" aria-label="카테고리 관리" onClick={onManage}>
            <Icon name="settings-2" size={15}/>
          </button>
        </div>
      </label>
      <div className="dialog-actions">
        <button className="ghost-button" onClick={onClose}>취소</button>
        <button className="primary-button" disabled={!ok} onClick={()=>onConfirm(name.trim(),cat)}>{confirmLabel}</button>
      </div>
    </AnkiDialogShell>
  );
}

function AnkiConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title:string; message:string; confirmLabel:string; danger?:boolean; onConfirm:()=>void; onClose:()=>void;
}) {
  return (
    <AnkiDialogShell title={title} onClose={onClose}>
      <p className="dialog-message">{message}</p>
      <div className="dialog-actions">
        <button className="ghost-button" onClick={onClose}>취소</button>
        <button className={danger?'danger-button':'primary-button'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </AnkiDialogShell>
  );
}

function AnkiCardDialog({ title, deckId, decks, initial, confirmLabel, onConfirm, onClose }: {
  title:string; deckId:string; decks:AnkiAppState['decks']; initial?:{type:string;front?:string;back?:string;text?:string};
  confirmLabel:string; onConfirm:(dk:string,type:string,front:string,back:string,text:string)=>void; onClose:()=>void;
}) {
  const [type,setType]=useState(initial?.type||'basic');
  const [front,setFront]=useState(initial?.front||'');
  const [back,setBack]=useState(initial?.back||'');
  const [text,setText]=useState(initial?.text||'');
  const [dk,setDk]=useState(deckId);
  const ok=type==='cloze'?/\{\{c\d+::/.test(text):(front.trim()&&back.trim());
  const submit=()=>{if(!ok)return;onConfirm(dk,type,front.trim(),back.trim(),text.trim());};
  return (
    <AnkiDialogShell title={title} onClose={onClose}>
      <label className="dialog-field"><span>유형</span>
        <div className="type-seg">
          <button type="button" className={type==='basic'?'active':''} onClick={()=>setType('basic')}>기본</button>
          <button type="button" className={type==='reversed'?'active':''} onClick={()=>setType('reversed')}>양면</button>
          <button type="button" className={type==='cloze'?'active':''} onClick={()=>setType('cloze')}>빈칸 (Cloze)</button>
        </div>
      </label>
      {decks.length>1&&(
        <label className="dialog-field"><span>덱</span>
          <select value={dk} onChange={e=>setDk(e.target.value)}>
            {decks.map(d=><option key={d.deckId} value={d.deckId}>{d.name}</option>)}
          </select>
        </label>
      )}
      {type==='cloze'
        ? <label className="dialog-field"><span>본문 ({'{{'+'c1::정답'+'}}'} 형식)</span>
            <textarea autoFocus rows={4} value={text} placeholder="예: 대한민국의 수도는 {{c1::서울}}이다." onChange={e=>setText(e.target.value)}/>
          </label>
        : <>
            {type==='reversed'&&<p className="dialog-hint">앞·뒤가 서로 바뀐 카드 2장이 함께 만들어집니다.</p>}
            <label className="dialog-field"><span>앞면 (질문)</span><textarea autoFocus rows={2} value={front} placeholder="앞면에 표시할 내용" onChange={e=>setFront(e.target.value)}/></label>
            <label className="dialog-field"><span>뒷면 (정답)</span><textarea rows={3} value={back} placeholder="뒷면에 표시할 내용" onChange={e=>setBack(e.target.value)}/></label>
          </>
      }
      <div className="dialog-actions">
        <button className="ghost-button" onClick={onClose}>취소</button>
        <button className="primary-button" disabled={!ok} onClick={submit}>{confirmLabel}</button>
      </div>
    </AnkiDialogShell>
  );
}

function AnkiStatsPanel({ anki }: { anki:AnkiAppState }) {
  const totals=anki.decks.map(d=>{
    const cards=anki.cards.filter(c=>c.deckId===d.deckId);
    const c=getDeckCounts(anki,d.deckId);
    return{id:d.deckId,name:d.name,new:c.new,learn:c.learn,due:c.review,total:cards.length};
  });
  const grand=totals.reduce((s,d)=>s+d.total,0);
  let acc=0;
  const stops=totals.filter(d=>d.total>0).map((d,i)=>{
    const start=(acc/(grand||1))*100; acc+=d.total;
    const end=(acc/(grand||1))*100;
    return `${STAT_PALETTE[i%STAT_PALETTE.length]} ${start}% ${end}%`;
  }).join(', ');
  const conic=grand>0?`conic-gradient(${stops})`:'var(--surface-2)';
  const today=new Date(); today.setHours(0,0,0,0);
  const todayLog=anki.reviewLog.filter(l=>l.ts>=today.getTime());
  const gradeCounts=[0,0,0,0];
  for(const l of todayLog)gradeCounts[l.grade as number]++;
  const totalGraded=gradeCounts.reduce((a,b)=>a+b,0)||1;
  const gradeInfo=[
    {n:'Again',cls:'again',v:gradeCounts[0],color:'oklch(0.64 0.13 25)'},
    {n:'Hard', cls:'hard', v:gradeCounts[1],color:'oklch(0.72 0.13 70)'},
    {n:'Good', cls:'good', v:gradeCounts[2],color:'oklch(0.66 0.13 150)'},
    {n:'Easy', cls:'easy', v:gradeCounts[3],color:'oklch(0.62 0.13 240)'},
  ];
  return (
    <div className="anki-stats">
      <section className="panel">
        <div className="panel-head"><h3 className="panel-title">덱별 카드 비율</h3><span className="panel-meta">전체 {grand}장</span></div>
        <div className="pie-wrap">
          <div className="donut" style={{background:conic}}>
            <div className="donut-hole"><strong>{grand}</strong><span>전체 카드</span></div>
          </div>
          <ul className="pie-legend">
            {totals.map((d,i)=>(
              <li key={d.id}>
                <span className="lg-dot" style={{background:STAT_PALETTE[i%STAT_PALETTE.length]}}/>
                <span className="lg-name">{d.name}</span>
                <span className="lg-val">{d.total}<em>{grand?Math.round((d.total/grand)*100):0}%</em></span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3 className="panel-title">오늘의 복습 분포</h3><span className="panel-meta">총 {todayLog.length}회</span></div>
        <div style={{padding:'20px 0'}}>
          <div className="grade-dist">
            {gradeInfo.map(g=>(
              <div className="grade-row" key={g.cls}>
                <span className={`grade-badge ${g.cls}`}>{g.n}</span>
                <div className="grade-bar"><i style={{width:`${(g.v/totalGraded)*100}%`,background:g.color}}/></div>
                <strong>{g.v}회</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

type AnkiDialog =
  | {kind:'addDeck'} | {kind:'renameDeck';id:string;name:string;category:string}
  | {kind:'deleteDecks';ids:string[]} | {kind:'addCard'}
  | {kind:'editCard';noteId:string} | {kind:'deleteCard';noteId:string} | null;

function AnkiView({ anki, setAnki, deckId, setDeckId, categories, onManageCategories, onStartReview }: {
  anki:AnkiAppState; setAnki:React.Dispatch<React.SetStateAction<AnkiAppState>>;
  deckId:string; setDeckId:(id:string)=>void; categories:string[];
  onManageCategories:()=>void; onStartReview:(id:string)=>void;
}) {
  const [sub,setSub]=useState('today');
  const [selected,setSelected]=useState<string[]>([]);
  const [dialog,setDialog]=useState<AnkiDialog>(null);
  const close=()=>setDialog(null);
  const mutate=(fn:(s:AnkiAppState)=>AnkiAppState)=>setAnki(prev=>fn({...prev}));

  const doAddDeck=(name:string,category:string)=>{
    const id=createAId('deck');
    mutate(s=>({...s,decks:[...s.decks,{deckId:id,name,category:category||(categories&&categories[0])||'기타',createdAt:Date.now()}]}));
    setDeckId(id); pushToast('덱을 추가했어요'); close();
  };
  const doRenameDeck=(id:string,name:string,category:string)=>{
    mutate(s=>({...s,decks:s.decks.map(d=>d.deckId===id?{...d,name,category:category??d.category}:d)}));
    setSelected([]); close();
  };
  const doDeleteDecks=(ids:string[])=>{
    mutate(s=>{
      const noteIds=new Set(s.cards.filter(c=>ids.includes(c.deckId)).map(c=>c.noteId));
      const newDecks=s.decks.filter(d=>!ids.includes(d.deckId));
      if(ids.includes(deckId))setDeckId(newDecks[0]?.deckId??'');
      return{...s,decks:newDecks,cards:s.cards.filter(c=>!ids.includes(c.deckId)),notes:s.notes.filter(n=>!noteIds.has(n.noteId))};
    });
    setSelected([]); pushToast('덱을 삭제했어요'); close();
  };
  const doAddCard=(dk:string,type:string,front:string,back:string,text:string)=>{
    mutate(s=>{
      if(type==='cloze')addClozeNote(s,dk,text,'',[]); else if(type==='reversed')addReversedNote(s,dk,front,back,[]); else addBasicNote(s,dk,front,back,[]);
      return s;
    });
    pushToast('카드를 추가했어요'); close();
  };
  const doEditCard=(noteId:string,type:string,front:string,back:string,text:string)=>{
    mutate(s=>{
      const n=s.notes.find(x=>x.noteId===noteId); if(!n)return s;
      if(type==='cloze'){n.type='cloze';n.reversed=false;n.fields={text,extra:n.fields.extra||''};}
      else{
        n.type='basic';n.fields={front,back};
        const wantReversed=type==='reversed';
        const hasRev=s.cards.some(c=>c.noteId===noteId&&c.ord===1);
        if(wantReversed&&!hasRev)s.cards.push(newCard(noteId,n.deckId,1));
        if(!wantReversed&&hasRev)s.cards=s.cards.filter(c=>!(c.noteId===noteId&&c.ord===1));
        n.reversed=wantReversed;
      }
      return s;
    });
    pushToast('카드를 수정했어요'); close();
  };
  const doDeleteCard=(noteId:string)=>{
    mutate(s=>({...s,notes:s.notes.filter(n=>n.noteId!==noteId),cards:s.cards.filter(c=>c.noteId!==noteId)}));
    pushToast('카드를 삭제했어요'); close();
  };

  const activeId=anki.decks.some(d=>d.deckId===deckId)?deckId:anki.decks[0]?.deckId??'';
  const activeDeck=anki.decks.find(d=>d.deckId===activeId);
  const counts=activeDeck?getDeckCounts(anki,activeId):{new:0,learn:0,review:0,total:0};
  const deckCards=anki.cards.filter(c=>c.deckId===activeId);
  const deckNoteIds=[...new Set(deckCards.map(c=>c.noteId))];
  const deckNotes=deckNoteIds.map(id=>anki.notes.find(n=>n.noteId===id)).filter((n):n is NonNullable<typeof n>=>Boolean(n));
  const toggle=(id:string)=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);

  if(!anki.decks.length) return (
    <>
      <div className="anki-empty">
        <Icon name="layers" size={36} color="var(--muted)"/>
        <h2>덱이 없습니다</h2><p>새 덱을 만들어 카드를 추가해 보세요.</p>
        <button className="primary-button" onClick={()=>setDialog({kind:'addDeck'})}><Icon name="plus" size={15} color="#fff"/>새 덱 만들기</button>
      </div>
      {dialog?.kind==='addDeck'&&<AnkiDeckDialog title="새 덱" categories={categories} onManage={onManageCategories} confirmLabel="만들기" onClose={close} onConfirm={doAddDeck}/>}
    </>
  );

  return (
    <div className="anki-page view-enter">
      <AnkiStatsPanel anki={anki}/>
      <div className="anki-main-full">
        <div className="anki-seg-wrap">
          <div className="segmented">
            <button className={sub==='today'?'active':''} onClick={()=>setSub('today')}>덱</button>
            <button onClick={()=>setDialog({kind:'addCard'})}>추가</button>
            <button className={sub==='browse'?'active':''} onClick={()=>setSub('browse')}>탐색</button>
            <button className={sub==='stats'?'active':''} onClick={()=>setSub('stats')}>통계</button>
          </div>
        </div>

        {sub==='today'&&(
          <div className="anki-today">
            <div className="at-cards">
              <div className="at-card new"><span className="lbl">신규</span><strong>{counts.new}</strong><em>처음 보는 카드</em></div>
              <div className="at-card learn"><span className="lbl">학습 중</span><strong>{counts.learn}</strong><em>익히는 중</em></div>
              <div className="at-card due"><span className="lbl">복습</span><strong>{counts.review}</strong><em>기한 도래</em></div>
            </div>
            <section className="panel deck-panel">
              <div className="panel-head"><h3 className="panel-title">덱</h3>
                <div className="panel-head-actions">
                  {selected.length===1&&<button className="chip-button" onClick={()=>{const d=anki.decks.find(x=>x.deckId===selected[0]);if(d)setDialog({kind:'renameDeck',id:d.deckId,name:d.name,category:d.category});}}><Icon name="pencil" size={13}/>이름·카테고리</button>}
                  {selected.length>0&&<button className="chip-button danger" onClick={()=>setDialog({kind:'deleteDecks',ids:selected})}><Icon name="trash-2" size={13}/>삭제 ({selected.length})</button>}
                  <button className="chip-button" onClick={onManageCategories}><Icon name="settings-2" size={13}/>카테고리</button>
                  <button className="chip-button" onClick={()=>setDialog({kind:'addDeck'})}><Icon name="plus" size={14}/>덱 추가</button>
                </div>
              </div>
              <div className="deck-rows">
                {anki.decks.map(d=>{
                  const c=getDeckCounts(anki,d.deckId), isSel=selected.includes(d.deckId), dueTotal=c.new+c.learn+c.review;
                  return(
                    <div key={d.deckId} className={`deck-item ${d.deckId===activeId?'active':''} ${isSel?'selected':''}`}>
                      <input type="checkbox" className="deck-check" checked={isSel} aria-label={`${d.name} 선택`} onChange={()=>toggle(d.deckId)}/>
                      <button className="deck-main" onClick={()=>setDeckId(d.deckId)}>
                        <strong>{d.name}{d.category&&<span className="deck-cat-chip">{d.category}</span>}</strong>
                        <span className="deck-counts"><i className="dc new">{c.new}</i><i className="dc learn">{c.learn}</i><i className="dc due">{c.review}</i></span>
                      </button>
                      <button className="deck-study" disabled={dueTotal===0} onClick={()=>onStartReview(d.deckId)}>학습</button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {sub==='browse'&&(
          <section className="panel">
            <div className="panel-head">
              <div className="browse-deck-select">
                <select value={activeId} aria-label="덱 선택" onChange={e=>setDeckId(e.target.value)}>
                  {anki.decks.map(d=><option key={d.deckId} value={d.deckId}>{d.name} ({anki.cards.filter(c=>c.deckId===d.deckId).length}장)</option>)}
                </select>
              </div>
              <div className="panel-head-actions"><span className="panel-meta">{deckNotes.length}장</span><button className="chip-button" onClick={()=>setDialog({kind:'addCard'})}><Icon name="plus" size={14}/>카드 추가</button></div>
            </div>
            {deckNotes.length===0?<p className="empty-line">아직 카드가 없습니다. '추가'로 첫 카드를 만들어 보세요.</p>:(
              <div className="card-rows">
                {deckNotes.map(n=>{
                  const frontText=n.type==='cloze'?(n.fields.text||'').replace(/\{\{c\d+::([^}:]+)(?:::[^}]*)?\}\}/g,'____'):(n.fields.front||'');
                  const backText=n.type==='cloze'?n.fields.extra||'':(n.fields.back||'');
                  const cs=anki.cards.filter(c=>c.noteId===n.noteId);
                  const pip=cs.some(c=>c.state==='review')?'due':cs.some(c=>c.state==='learn')?'learn':'new';
                  const interval=cs[0]?.interval??0;
                  return(
                    <div className="card-row" key={n.noteId}>
                      <span className={`state-pip ${pip}`}/>
                      <div className="card-row-text"><span className="card-row-front">{frontText.slice(0,80)}</span><span className="card-row-back">{backText.slice(0,60)}</span></div>
                      <span className={`card-kind-tag ${n.type==='cloze'?'cloze':n.reversed?'reversed':'basic'}`}>{n.type==='cloze'?'빈칸':n.reversed?'양면':'기본'}</span>
                      <span className="log-int">{interval}일</span>
                      <div className="card-row-actions">
                        <button aria-label="카드 편집" title="편집" onClick={()=>setDialog({kind:'editCard',noteId:n.noteId})}><Icon name="pencil" size={14}/></button>
                        <button aria-label="카드 삭제" title="삭제" onClick={()=>setDialog({kind:'deleteCard',noteId:n.noteId})}><Icon name="trash-2" size={14}/></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {sub==='stats'&&(()=>{
          const thirty=Date.now()-30*86400000;
          const recentLog=anki.reviewLog.filter(l=>l.ts>=thirty);
          const grades=[0,0,0,0];
          for(const l of recentLog)grades[l.grade as number]++;
          const totalG=grades.reduce((a,b)=>a+b,0)||1;
          const colors=['oklch(0.64 0.13 25)','oklch(0.72 0.13 70)','oklch(0.66 0.13 150)','oklch(0.62 0.13 240)'];
          return(
            <section className="panel">
              <div className="panel-head"><h3 className="panel-title">복습 분포</h3><span className="panel-meta">최근 30일</span></div>
              <div className="grade-dist">
                {(['Again','Hard','Good','Easy'] as const).map((lbl,i)=>(
                  <div className="grade-row" key={lbl}>
                    <span className={`grade-badge ${lbl.toLowerCase()}`}>{lbl}</span>
                    <div className="grade-bar"><i style={{width:`${(grades[i]/totalG)*100}%`,background:colors[i]}}/></div>
                    <strong>{grades[i]}회</strong>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}
      </div>

      {dialog?.kind==='addDeck'&&<AnkiDeckDialog title="새 덱" categories={categories} onManage={onManageCategories} confirmLabel="만들기" onClose={close} onConfirm={doAddDeck}/>}
      {dialog?.kind==='renameDeck'&&<AnkiDeckDialog title="덱 편집" categories={categories} onManage={onManageCategories} initial={{name:dialog.name,category:dialog.category}} confirmLabel="저장" onClose={close} onConfirm={(name,category)=>doRenameDeck(dialog.id,name,category)}/>}
      {dialog?.kind==='deleteDecks'&&<AnkiConfirmDialog title="덱 삭제" danger confirmLabel="삭제" message={`선택한 ${dialog.ids.length}개 덱과 모든 카드가 삭제됩니다. 되돌릴 수 없습니다.`} onClose={close} onConfirm={()=>doDeleteDecks(dialog.ids)}/>}
      {dialog?.kind==='addCard'&&<AnkiCardDialog title="카드 추가" deckId={activeId} decks={anki.decks} confirmLabel="추가" onClose={close} onConfirm={doAddCard}/>}
      {dialog?.kind==='editCard'&&(()=>{
        const n=anki.notes.find(x=>x.noteId===dialog.noteId); if(!n)return null;
        return<AnkiCardDialog title="카드 편집" deckId={activeId} decks={anki.decks} initial={{type:n.type==='cloze'?'cloze':n.reversed?'reversed':'basic',front:n.fields.front,back:n.fields.back,text:n.fields.text}} confirmLabel="저장" onClose={close} onConfirm={(_dk,type,front,back,text)=>doEditCard(dialog.noteId,type,front,back,text)}/>;
      })()}
      {dialog?.kind==='deleteCard'&&<AnkiConfirmDialog title="카드 삭제" danger confirmLabel="삭제" message="이 카드를 삭제합니다. 되돌릴 수 없습니다." onClose={close} onConfirm={()=>doDeleteCard(dialog.noteId)}/>}
    </div>
  );
}

function ReviewModal({ queue, idx, backShown, anki, onReveal, onGrade, onClose }: {
  queue:AnkiCard[]; idx:number; backShown:boolean; anki:AnkiAppState;
  onReveal:()=>void; onGrade:(g:AnkiGrade)=>void; onClose:()=>void;
}) {
  const card=queue[idx];
  const isDone=!card;
  const fb=card?getCardFB(anki,card):null;
  const totalReviewed=anki.todayCounts.new+anki.todayCounts.learn+anki.todayCounts.review;
  const stateLabel=card?.state==='new'?'신규':card?.state==='learn'?'학습 중':'복습';
  const stateCls=card?.state==='new'?'new':card?.state==='learn'?'learn':'due';
  return (
    <div className="review-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="review-modal">
        <div className="review-header">
          {!isDone&&<span className={`card-kind ${stateCls}`}>{stateLabel}</span>}
          <span className="card-counter">{!isDone?`${idx+1} / ${queue.length}`:''}</span>
          {!isDone&&<span className="card-deck-label">{fb?.deckName}</span>}
          <button className="icon-button" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        {isDone
          ? <div className="session-done">
              <Icon name="check-circle-2" size={48} color="oklch(0.55 0.14 150)"/>
              <h3>오늘 복습 완료!</h3><p>{totalReviewed}장 평가했습니다. 내일 또 만나요.</p>
              <button className="primary-button" onClick={onClose}>닫기</button>
            </div>
          : <>
              <div className="card-body">
                <div className="card-front" dangerouslySetInnerHTML={{__html:fb?.front??''}}/>
                <div className={`card-back ${backShown?'show':''}`} dangerouslySetInnerHTML={{__html:fb?.back??''}}/>
              </div>
              <div className="card-actions">
                {!backShown
                  ? <button className="primary-button" onClick={onReveal} style={{width:'100%',minHeight:44}}>정답 보기 <span style={{opacity:0.5,fontSize:11}}>(Space)</span></button>
                  : <div className="grade-buttons">
                      {([0,1,2,3] as AnkiGrade[]).map(g=>{
                        const labels=['Again','Hard','Good','Easy'],subs=['다시','어려움','알맞음','쉬움'],cls=['again','hard','good','easy'];
                        const lbl=peekLabel(card,g,anki.settings.learnSteps);
                        return<button key={g} className={`grade-btn ${cls[g]}`} onClick={()=>onGrade(g)}>{labels[g]}<em>{subs[g]}</em><small>{lbl}</small></button>;
                      })}
                    </div>
                }
              </div>
            </>
        }
      </div>
    </div>
  );
}

/* ── StudyApp root ── */
export default function StudyApp() {
  const [user, setUser] = usePersistent<User|null>('user', null);
  const [tab, navigate] = useHashRoute('overview');

  const [sessions, setSessions] = usePersistent<StudySession[]>('sessions', ()=>buildSampleSessions());
  const [materials, setMaterials] = usePersistent<LearningMaterial[]>('materials', SAMPLE_MATERIALS);
  const [summaries, setSummaries] = usePersistent<Summary[]>('summaries', SAMPLE_SUMMARIES);
  const [notes, setNotes] = usePersistent<StudyNote[]>('notes', SAMPLE_NOTES);
  const [quizzes, setQuizzes] = usePersistent<Quiz[]>('quizzes', SAMPLE_QUIZZES);
  const [categories, setCategories] = usePersistent<string[]>('categories', ()=>[...SUBJECTS]);
  const [pinnedNotes, setPinnedNotes] = usePersistent<string[]>('pinnedNotes', []);
  const [pinnedMaterials, setPinnedMaterials] = usePersistent<string[]>('pinnedMaterials', []);
  const [catManagerOpen, setCatManagerOpen] = useState(false);

  const [selSummary, setSelSummary] = useState(SAMPLE_SUMMARIES[0]?.summaryId||'');
  const [selNote, setSelNote] = useState(SAMPLE_NOTES[0]?.noteId||'');
  const [noteDraft, setNoteDraft] = useState(()=>({
    title: SAMPLE_NOTES[0]?.title||'새 학습 노트',
    subject: SAMPLE_NOTES[0]?.subject||'기타',
    markdownContent: SAMPLE_NOTES[0]?.markdownContent||'## 오늘의 핵심\n- ',
  }));
  const [uploadStatus, setUploadStatus] = useState('학습 자료를 업로드하면 AI 요약을 바로 생성합니다.');
  const [isSummarizing, setIsSummarizing] = useState(false);

  /* timer engine */
  const [timerType, setTimerType] = useState('STOPWATCH');
  const [timerSubject, setTimerSubject] = useState(SUBJECTS[0]);
  const [seconds, setSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [pomoPhase, setPomoPhase] = useState('study');
  const [timerCfg, setTimerCfg] = useState<TimerCfg>({timerH:0,timerM:30,timerS:0,pomoStudySec:1500,pomoBreakSec:300,pomoRepeat:4,pomoRound:0});
  const timerTotalSecs=(c:TimerCfg)=>Math.max(0,(c.timerH||0)*3600+(c.timerM||0)*60+(c.timerS||0));
  const startRef = useRef<Date|null>(null);

  /* anki */
  const [anki, setAnki] = useState<AnkiAppState>(makeDefaultAnkiState);
  const [ankiLoaded, setAnkiLoaded] = useState(false);
  const [ankiDeckId, setAnkiDeckId] = useState('');
  const [reviewQueue, setReviewQueue] = useState<AnkiCard[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [reviewBack, setReviewBack] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(()=>{
    const loaded=loadAnkiFromStorage();
    setAnki(loaded);
    setAnkiDeckId(loaded.activeDeckId||loaded.decks[0]?.deckId||'');
    setAnkiLoaded(true);
  },[]);
  useEffect(()=>{ if(ankiLoaded)saveAnkiToStorage(anki); },[anki,ankiLoaded]);

  const character=useMemo(()=>calculateCharacter(user?.userId||'guest',sessions),[user,sessions]);
  const attendance=useMemo(()=>new Set(sessions.map(s=>s.endTime.slice(0,10))).size,[sessions]);
  const selectedSummary=summaries.find(s=>s.summaryId===selSummary)??summaries[0];
  const selectedNote=notes.find(n=>n.noteId===selNote)??notes[0];
  const noteQuizzes=quizzes.filter(q=>q.noteId===selectedNote?.noteId);

  useEffect(()=>{ if(selectedNote)setNoteDraft({title:selectedNote.title,subject:selectedNote.subject,markdownContent:selectedNote.markdownContent}); },[selectedNote?.noteId]);

  /* timer tick */
  useEffect(()=>{
    if(!isRunning)return;
    const id=setInterval(()=>{ setSeconds(v=>timerType==='STOPWATCH'?v+1:Math.max(0,v-1)); },1000);
    return()=>clearInterval(id);
  },[isRunning,timerType]);

  /* countdown reaching zero */
  useEffect(()=>{
    if(!isRunning||timerType==='STOPWATCH'||seconds>0)return;
    if(timerType==='TIMER'){
      const mins=Math.max(1,Math.round(totalSeconds/60));
      recordSession(mins); pushToast(`타이머 ${formatMinutes(mins)}을 기록했어요`,{accent:true});
      resetTimer('TIMER'); return;
    }
    if(pomoPhase==='study'){
      recordSession(Math.max(1,Math.round(timerCfg.pomoStudySec/60)));
      const nextRound=timerCfg.pomoRound+1;
      setTimerCfg(c=>({...c,pomoRound:nextRound}));
      if(nextRound>=timerCfg.pomoRepeat){pushToast(`포모도로 ${nextRound}라운드 완료! 수고했어요`,{accent:true,icon:'sparkles'});resetTimer('POMODORO');}
      else{setPomoPhase('break');const t=timerCfg.pomoBreakSec;setSeconds(t);setTotalSeconds(t);pushToast('휴식 시간이에요');}
    }else{
      setPomoPhase('study');const t=timerCfg.pomoStudySec;setSeconds(t);setTotalSeconds(t);pushToast('다시 학습을 시작해요');
    }
  },[seconds,isRunning,timerType,pomoPhase]);

  /* keep total/seconds synced when cfg changes while idle */
  useEffect(()=>{
    if(isRunning)return;
    if(timerType==='TIMER'){const s=Math.max(1,timerTotalSecs(timerCfg));setSeconds(s);setTotalSeconds(s);}
    if(timerType==='POMODORO'&&pomoPhase==='study'){const s=timerCfg.pomoStudySec;setSeconds(s);setTotalSeconds(s);}
    if(timerType==='POMODORO'&&pomoPhase==='break'){const s=timerCfg.pomoBreakSec;setSeconds(s);setTotalSeconds(s);}
  },[timerCfg.timerH,timerCfg.timerM,timerCfg.timerS,timerCfg.pomoStudySec,timerCfg.pomoBreakSec,timerType,pomoPhase]);

  /* anki keyboard shortcuts */
  useEffect(()=>{
    if(!reviewOpen)return;
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){setReviewOpen(false);return;}
      if(!reviewBack){if(e.key===' '||e.key==='Enter'){e.preventDefault();setReviewBack(true);}}
      else{
        if(e.key==='1')ankiGrade(0 as AnkiGrade);
        else if(e.key==='2')ankiGrade(1 as AnkiGrade);
        else if(e.key==='3'||e.key===' '||e.key==='Enter'){e.preventDefault();ankiGrade(2 as AnkiGrade);}
        else if(e.key==='4')ankiGrade(3 as AnkiGrade);
      }
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[reviewOpen,reviewBack,reviewIdx,reviewQueue]);

  function recordSession(durationMinutes:number){
    const started=startRef.current??new Date(Date.now()-durationMinutes*60000);
    const session:StudySession={sessionId:createId('session'),userId:user?.userId||'demo',subject:timerSubject,timerType:timerType as StudySession['timerType'],startTime:started.toISOString(),endTime:new Date().toISOString(),durationMinutes};
    setSessions(prev=>[session,...prev]);
  }
  function startTimer(){startRef.current=new Date();setIsRunning(true);}
  function pauseTimer(){setIsRunning(false);}
  function initialSecondsFor(type:string){return type==='POMODORO'?timerCfg.pomoStudySec:type==='TIMER'?Math.max(1,timerTotalSecs(timerCfg)):0;}
  function resetTimer(type?:string){
    const t=type||timerType; setIsRunning(false); setPomoPhase('study');
    setTimerCfg(c=>({...c,pomoRound:0}));
    const s=initialSecondsFor(t); setSeconds(s); setTotalSeconds(s); startRef.current=null;
  }
  function finishTimer(){
    const dur=timerType==='STOPWATCH'?Math.max(1,Math.round(seconds/60)):Math.max(1,Math.round((totalSeconds-seconds)/60));
    if(dur>0){recordSession(dur);pushToast(`학습 ${formatMinutes(dur)}을 기록했어요`,{accent:true});}
    resetTimer();
  }
  function recordLap(){
    const dur=Math.max(1,Math.round(seconds/60));
    if(dur>0){recordSession(dur);pushToast(`학습 ${formatMinutes(dur)}을 기록했어요`,{accent:true});}
  }
  function stopAndReset(){
    if(isRunning&&seconds>0){const dur=Math.max(1,Math.round(seconds/60));recordSession(dur);pushToast(`학습 ${formatMinutes(dur)}을 기록했어요`,{accent:true});}
    resetTimer();
  }
  function deleteSession(ids:string[]){setSessions(prev=>prev.filter(s=>!ids.includes(s.sessionId)));pushToast(`기록 ${ids.length}개를 삭제했어요`);}
  function switchTimerType(next:string){
    setTimerType(next);setIsRunning(false);setPomoPhase('study');setTimerCfg(c=>({...c,pomoRound:0}));
    const s=next==='POMODORO'?timerCfg.pomoStudySec:next==='TIMER'?Math.max(1,timerTotalSecs(timerCfg)):0;
    setSeconds(s);setTotalSeconds(s);
  }

  /* anki review */
  function startReview(deckId:string){const q=buildQueue(anki,deckId);setReviewQueue(q);setReviewIdx(0);setReviewBack(false);setReviewOpen(true);}
  function ankiGrade(grade:AnkiGrade){
    const card=reviewQueue[reviewIdx]; if(!card)return;
    const updated=schedule(card,grade,anki.settings.learnSteps);
    const nc={...anki.todayCounts};
    if(card.state==='new')nc.new+=1; else if(card.state==='review')nc.review+=1; else if(card.state==='learn')nc.learn+=1;
    const newLog=[{ts:Date.now(),cardId:card.cardId,grade,prevInterval:card.interval,newInterval:updated.interval},...anki.reviewLog].slice(0,1000);
    const newCards=anki.cards.map(c=>c.cardId===card.cardId?updated:c);
    let nextQueue=reviewQueue;
    if(updated.state==='learn'&&updated.due-Date.now()<10*60000)nextQueue=[...reviewQueue,updated];
    setAnki(prev=>({...prev,cards:newCards,reviewLog:newLog,todayCounts:nc}));
    setReviewQueue(nextQueue);setReviewIdx(i=>i+1);setReviewBack(false);
  }

  /* content actions */
  function handleUpload(e:React.ChangeEvent<HTMLInputElement>,category:string){
    const file=e.target.files?.[0]; if(!file)return;
    const cat=category||categories[0]||'기타';
    setIsSummarizing(true); setUploadStatus('파일을 읽고 AI 요약을 생성하는 중입니다.');
    const ext=(file.name.split('.').pop()||'').toUpperCase();
    const material:LearningMaterial={materialId:createId('material'),fileName:file.name,fileType:ext||'FILE',category:cat,uploadedAt:new Date().toISOString()};
    setMaterials(prev=>[material,...prev]);
    setTimeout(()=>{
      const title=file.name.replace(/\.[^.]+$/,'');
      const summary:Summary={summaryId:createId('summary'),title,content:summarizeLocally(title),sourceType:'material',category:cat,createdAt:new Date().toISOString()};
      setSummaries(prev=>[summary,...prev]); setSelSummary(summary.summaryId);
      setUploadStatus('요약이 생성되어 저장되었습니다.'); setIsSummarizing(false);
      pushToast('AI 요약을 생성했어요',{accent:true,icon:'sparkles'});
    },1300);
    e.target.value='';
  }
  function saveNote(){
    if(!noteDraft.title.trim())return;
    const now=new Date().toISOString();
    if(selectedNote){const upd={...selectedNote,...noteDraft,title:noteDraft.title.trim(),updatedAt:now};setNotes(prev=>prev.map(n=>n.noteId===selectedNote.noteId?upd:n));pushToast('노트를 저장했어요');return;}
    const note:StudyNote={noteId:createId('note'),userId:user?.userId||'demo',title:noteDraft.title.trim(),subject:noteDraft.subject,markdownContent:noteDraft.markdownContent,updatedAt:now};
    setNotes(prev=>[note,...prev]); setSelNote(note.noteId); pushToast('새 노트를 만들었어요');
  }
  function newNote(){setSelNote('');setNoteDraft({title:'새 학습 노트',subject:categories[0]||'기타',markdownContent:'## 오늘의 핵심\n- '});}
  function deleteNote(noteId:string){setNotes(prev=>prev.filter(n=>n.noteId!==noteId));setQuizzes(prev=>prev.filter(q=>q.noteId!==noteId));setSelNote('');pushToast('노트를 삭제했어요');}
  function renameNote(noteId:string,newTitle:string){
    setNotes(prev=>prev.map(n=>n.noteId===noteId?{...n,title:newTitle}:n));
    if(selectedNote?.noteId===noteId)setNoteDraft(d=>({...d,title:newTitle}));
    pushToast('노트 이름을 변경했어요');
  }
  const togglePinNote=(noteId:string)=>setPinnedNotes(prev=>prev.includes(noteId)?prev.filter(id=>id!==noteId):[...prev,noteId]);
  const togglePinMaterial=(matId:string)=>setPinnedMaterials(prev=>prev.includes(matId)?prev.filter(id=>id!==matId):[...prev,matId]);
  function summarizeNote(){
    if(!selectedNote)return;
    const summary:Summary={summaryId:createId('summary'),title:`${selectedNote.title} 노트 요약`,content:summarizeLocally(selectedNote.title),sourceType:'note',category:selectedNote.subject||categories[0],createdAt:new Date().toISOString()};
    setSummaries(prev=>[summary,...prev]); setSelSummary(summary.summaryId); navigate('materials');
    pushToast('노트를 요약했어요',{accent:true,icon:'bot'});
  }
  function generateQuiz(){
    if(!selectedNote)return;
    const pool=[
      {question:`${selectedNote.title}의 핵심 개념을 한 줄로 설명하면?`,answer:"노트의 '오늘의 핵심' 항목을 자신의 말로 정리해 보세요."},
      {question:'이 단원에서 가장 헷갈렸던 부분은?',answer:'복습 포인트로 표시하고 Anki 카드로 만들어 반복하세요.'},
    ];
    const gen=pool.map(q=>({quizId:createId('quiz'),noteId:selectedNote.noteId,question:q.question,answer:q.answer,createdAt:new Date().toISOString()}));
    setQuizzes(prev=>[...gen,...prev]); pushToast('복습 문제를 생성했어요',{accent:true,icon:'sparkles'});
  }
  function deleteSummary(id:string){setSummaries(prev=>prev.filter(s=>s.summaryId!==id));setSelSummary('');pushToast('요약을 삭제했어요');}

  /* shared category CRUD */
  const categoryCounts=useMemo(()=>{
    const m:Record<string,number>={};
    const bump=(k?:string)=>{ if(k)m[k]=(m[k]||0)+1; };
    sessions.forEach(s=>bump(s.subject)); notes.forEach(n=>bump(n.subject));
    summaries.forEach(s=>bump(s.category)); materials.forEach(x=>bump(x.category));
    anki.decks.forEach(d=>bump(d.category));
    return m;
  },[sessions,notes,summaries,materials,anki.decks]);

  function addCategory(name:string):boolean{
    const n=(name||'').trim(); if(!n)return false;
    if(categories.some(c=>c.toLowerCase()===n.toLowerCase())){pushToast('이미 있는 카테고리예요');return false;}
    setCategories(prev=>[...prev,n]); pushToast(`'${n}' 카테고리를 추가했어요`,{accent:true}); return true;
  }
  function renameCategory(oldN:string,name:string):boolean{
    const n=(name||'').trim(); if(!n||n===oldN)return false;
    if(categories.some(c=>c.toLowerCase()===n.toLowerCase()&&c!==oldN)){pushToast('이미 있는 카테고리예요');return false;}
    setCategories(prev=>prev.map(c=>c===oldN?n:c));
    setSessions(prev=>prev.map(s=>s.subject===oldN?{...s,subject:n}:s));
    setNotes(prev=>prev.map(x=>x.subject===oldN?{...x,subject:n}:x));
    setSummaries(prev=>prev.map(x=>x.category===oldN?{...x,category:n}:x));
    setMaterials(prev=>prev.map(x=>x.category===oldN?{...x,category:n}:x));
    setAnki(prev=>({...prev,decks:prev.decks.map(d=>d.category===oldN?{...d,category:n}:d)}));
    setNoteDraft(d=>d.subject===oldN?{...d,subject:n}:d);
    if(timerSubject===oldN)setTimerSubject(n);
    pushToast('카테고리 이름을 변경했어요'); return true;
  }
  function deleteCategory(name:string){
    if(categories.length<=1){pushToast('최소 1개의 카테고리가 필요해요');return;}
    const fallback=categories.find(c=>c==='기타'&&c!==name)||categories.find(c=>c!==name)||'기타';
    setCategories(prev=>prev.filter(c=>c!==name));
    setSessions(prev=>prev.map(s=>s.subject===name?{...s,subject:fallback}:s));
    setNotes(prev=>prev.map(x=>x.subject===name?{...x,subject:fallback}:x));
    setSummaries(prev=>prev.map(x=>x.category===name?{...x,category:fallback}:x));
    setMaterials(prev=>prev.map(x=>x.category===name?{...x,category:fallback}:x));
    setAnki(prev=>({...prev,decks:prev.decks.map(d=>d.category===name?{...d,category:fallback}:d)}));
    setNoteDraft(d=>d.subject===name?{...d,subject:fallback}:d);
    if(timerSubject===name)setTimerSubject(fallback);
    pushToast(`'${name}' 카테고리를 삭제했어요`);
  }
  function setDeckCategory(deckId:string,category:string){setAnki(prev=>({...prev,decks:prev.decks.map(d=>d.deckId===deckId?{...d,category}:d)}));}

  function login(provider:string,nick:string){
    const names:Record<string,string>={GOOGLE:'Google',KAKAO:'Kakao',NAVER:'Naver'};
    const nickname=(nick||'').trim();
    const safe=(nickname||'demo').toLowerCase().replace(/\s+/g,'_');
    setUser({userId:`${provider.toLowerCase()}_${safe}`,nickname:nickname||`${names[provider]} 학습자`,provider:provider as User['provider']});
    if(!TAB_ROUTES.includes(parseHash('overview')))location.hash='#/overview';
  }
  function logout(){setIsRunning(false);setUser(null);location.hash='#/overview';}

  if(!user) return <><LoginScreen onLogin={login}/><ToastHost/></>;

  return (
    <div className="app">
      <Sidebar activeTab={tab} onTab={navigate} user={user} attendance={attendance} onLogout={logout}/>
      <main className="main">
        {tab==='overview'
          ? <>
              <header className="page-header">
                <div className="title-wrap">
                  <p className="eyebrow">Personal learning dashboard</p>
                  <h1 className="page-title">학습 대시보드</h1>
                  <SessionClock sessions={sessions}/>
                </div>
                <ActivityHeatmap sessions={sessions}/>
              </header>
              <Overview character={character} sessions={sessions} anki={anki} onGoAnki={()=>{navigate('anki');startReview(ankiDeckId);}}/>
            </>
          : <header className="topbar">
              <div><p className="eyebrow">Personal learning cockpit</p><h2>{TAB_TITLES[tab]}</h2></div>
            </header>
        }
        {tab==='materials'&&<MaterialsView summaries={summaries} materials={materials} categories={categories} onManageCategories={()=>setCatManagerOpen(true)} selectedSummary={selectedSummary} selectedSummaryId={selSummary} uploadStatus={uploadStatus} isSummarizing={isSummarizing} onUpload={handleUpload} onSelectSummary={setSelSummary} onDeleteSummary={deleteSummary} pinnedMaterials={pinnedMaterials} onTogglePinMaterial={togglePinMaterial}/>}
        {tab==='notes'&&<NotesView notes={notes} categories={categories} onManageCategories={()=>setCatManagerOpen(true)} selectedNote={selectedNote} selectedNoteId={selNote} noteDraft={noteDraft} quizzes={noteQuizzes} onSelectNote={setSelNote} onDraftChange={setNoteDraft} onSave={saveNote} onNew={newNote} onDelete={deleteNote} onSummarize={summarizeNote} onQuiz={generateQuiz} onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory} onRenameNote={renameNote} pinnedNotes={pinnedNotes} onTogglePinNote={togglePinNote} summaries={summaries} onGoToSummary={(id)=>{setSelSummary(id);navigate('materials');}} onDeleteSummary={deleteSummary}/>}
        {tab==='timer'&&<TimerView timerType={timerType} seconds={seconds} totalSeconds={totalSeconds} isRunning={isRunning} subject={timerSubject} categories={categories} onManageCategories={()=>setCatManagerOpen(true)} sessions={sessions} pomoPhase={pomoPhase} timerCfg={timerCfg} setTimerCfg={setTimerCfg} onTypeChange={switchTimerType} onSubjectChange={setTimerSubject} onStart={startTimer} onPause={pauseTimer} onFinish={finishTimer} onReset={()=>resetTimer()} onRecordLap={recordLap} onStopAndReset={stopAndReset} onDeleteSession={deleteSession}/>}
        {tab==='stats'&&<StatsView sessions={sessions} categories={categories}/>}
        {tab==='timetable'&&<TimetableView/>}
        {tab==='anki'&&<AnkiView anki={anki} setAnki={setAnki} deckId={ankiDeckId} setDeckId={setAnkiDeckId} categories={categories} onManageCategories={()=>setCatManagerOpen(true)} onStartReview={startReview}/>}
      </main>

      {catManagerOpen&&<CategoryManager categories={categories} counts={categoryCounts} onAdd={addCategory} onRename={renameCategory} onDelete={deleteCategory} onClose={()=>setCatManagerOpen(false)}/>}
      {reviewOpen&&<ReviewModal queue={reviewQueue} idx={reviewIdx} backShown={reviewBack} anki={anki} onReveal={()=>setReviewBack(true)} onGrade={ankiGrade} onClose={()=>setReviewOpen(false)}/>}
      <ToastHost/>
    </div>
  );
}
