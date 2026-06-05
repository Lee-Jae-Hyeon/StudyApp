/* Anki SRS engine — faithful port of the design source anki-engine.jsx */

export type CardState = 'new' | 'learn' | 'review' | 'suspended';
export type AnkiGrade = 0 | 1 | 2 | 3;

export interface AnkiCard {
  cardId: string;
  noteId: string;
  deckId: string;
  ord: number;
  state: CardState;
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
  learnStep: number;
  due: number;
  lastReview: number | null;
}

export interface AnkiNote {
  noteId: string;
  deckId: string;
  type: 'basic' | 'cloze';
  reversed: boolean;
  fields: { front?: string; back?: string; text?: string; extra?: string };
  tags: string[];
  createdAt: number;
}

export interface AnkiDeck {
  deckId: string;
  name: string;
  category: string;
  createdAt: number;
}

export interface AnkiReviewLogEntry {
  ts: number;
  cardId: string;
  grade: AnkiGrade;
  prevInterval: number;
  newInterval: number;
}

export interface AnkiSettings {
  newPerDay: number;
  reviewPerDay: number;
  learnSteps: number[];
}

export interface AnkiAppState {
  activeDeckId: string;
  decks: AnkiDeck[];
  notes: AnkiNote[];
  cards: AnkiCard[];
  reviewLog: AnkiReviewLogEntry[];
  todayDate: string;
  todayCounts: { new: number; learn: number; review: number };
  settings: AnkiSettings;
}

const DAY = 86400000;
const MIN = 60000;

export function nowMs(): number { return Date.now(); }
export function todayKey(): string { return new Date().toISOString().slice(0, 10); }
export function createAId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newCard(noteId: string, deckId: string, ord = 0): AnkiCard {
  return { cardId: createAId("card"), noteId, deckId, ord, state: "new", ease: 2.5, interval: 0, reps: 0, lapses: 0, learnStep: 0, due: nowMs(), lastReview: null };
}

export function addBasicNote(s: AnkiAppState, deckId: string, front: string, back: string, tags: string[]): void {
  const noteId = createAId("note");
  s.notes.push({ noteId, deckId, type: "basic", reversed: false, fields: { front, back }, tags, createdAt: nowMs() });
  s.cards.push(newCard(noteId, deckId, 0));
}

export function addReversedNote(s: AnkiAppState, deckId: string, front: string, back: string, tags: string[]): void {
  const noteId = createAId("note");
  s.notes.push({ noteId, deckId, type: "basic", reversed: true, fields: { front, back }, tags, createdAt: nowMs() });
  s.cards.push(newCard(noteId, deckId, 0));
  s.cards.push(newCard(noteId, deckId, 1));
}

export function addClozeNote(s: AnkiAppState, deckId: string, text: string, extra: string, tags: string[]): void {
  const matches = [...text.matchAll(/\{\{c(\d+)::/g)];
  const ords = [...new Set(matches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);
  if (!ords.length) ords.push(1);
  const noteId = createAId("note");
  s.notes.push({ noteId, deckId, type: "cloze", reversed: false, fields: { text, extra: extra || "" }, tags, createdAt: nowMs() });
  for (const ord of ords) s.cards.push(newCard(noteId, deckId, ord));
}

export function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] ?? ch));
}

export function renderCloze(text: string, ord: number): { front: string; back: string } {
  const re = /\{\{c(\d+)::([^}:]+?)(?:::([^}]*))?\}\}/g;
  const front = text.replace(re, (_m, n, ans, hint) => parseInt(n, 10) === ord ? `<span class="cloze">${hint ? `[${esc(hint)}]` : "[...]"}</span>` : esc(ans));
  const back = text.replace(re, (_m, n, ans) => parseInt(n, 10) === ord ? `<span class="cloze-ans">${esc(ans)}</span>` : esc(ans));
  return { front, back };
}

export function schedule(card: AnkiCard, grade: AnkiGrade, learnSteps: number[]): AnkiCard {
  const c = { ...card };
  if (c.state === "new" || c.state === "learn") {
    if (grade === 0) { c.state = "learn"; c.learnStep = 0; c.due = nowMs() + learnSteps[0] * MIN; }
    else if (grade === 1) { c.state = "learn"; const step = learnSteps[c.learnStep] ?? learnSteps[learnSteps.length - 1]; c.due = nowMs() + step * MIN; }
    else if (grade === 2) {
      if (c.learnStep + 1 >= learnSteps.length) { c.state = "review"; c.interval = 1; c.reps = 1; c.due = nowMs() + DAY; }
      else { c.state = "learn"; c.learnStep += 1; c.due = nowMs() + learnSteps[c.learnStep] * MIN; }
    } else { c.state = "review"; c.interval = 4; c.reps = 1; c.ease = Math.min(2.75, c.ease + 0.15); c.due = nowMs() + 4 * DAY; }
  } else {
    if (grade === 0) { c.lapses += 1; c.ease = Math.max(1.3, c.ease - 0.2); c.state = "learn"; c.learnStep = 0; c.interval = 0; c.due = nowMs() + learnSteps[0] * MIN; }
    else if (grade === 1) { const next = Math.max(c.interval + 1, Math.round(c.interval * 1.2)); c.interval = next; c.ease = Math.max(1.3, c.ease - 0.15); c.reps += 1; c.due = nowMs() + next * DAY; }
    else if (grade === 2) { const next = Math.max(c.interval + 1, Math.round(c.interval * c.ease)); c.interval = next; c.reps += 1; c.due = nowMs() + next * DAY; }
    else { const next = Math.max(c.interval + 1, Math.round(c.interval * c.ease * 1.3)); c.interval = next; c.ease += 0.15; c.reps += 1; c.due = nowMs() + next * DAY; }
  }
  c.lastReview = nowMs();
  return c;
}

export function peekLabel(card: AnkiCard, grade: AnkiGrade, learnSteps: number[]): string {
  const next = schedule(card, grade, learnSteps);
  if (next.state === "learn") {
    const ms = next.due - nowMs();
    if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}분`;
    if (ms < DAY) return `${Math.round(ms / MIN / 60)}시간`;
    return `${Math.round(ms / DAY)}일`;
  }
  return `${next.interval}일`;
}

export function getDeckCounts(s: AnkiAppState, deckId: string) {
  const t = nowMs();
  const cards = s.cards.filter(c => c.deckId === deckId && c.state !== "suspended");
  const tc = s.todayCounts;
  return {
    new: Math.max(0, Math.min(cards.filter(c => c.state === "new").length, s.settings.newPerDay - tc.new)),
    learn: cards.filter(c => c.state === "learn" && c.due <= t).length,
    review: Math.max(0, Math.min(cards.filter(c => c.state === "review" && c.due <= t).length, s.settings.reviewPerDay - tc.review)),
    total: cards.length,
  };
}

export function buildQueue(s: AnkiAppState, deckId: string): AnkiCard[] {
  const t = nowMs();
  const cards = s.cards.filter(c => c.deckId === deckId && c.state !== "suspended");
  const tc = s.todayCounts;
  const newRem = Math.max(0, s.settings.newPerDay - tc.new);
  const revRem = Math.max(0, s.settings.reviewPerDay - tc.review);
  const learning = cards.filter(c => c.state === "learn" && c.due <= t).sort((a, b) => a.due - b.due);
  const review = cards.filter(c => c.state === "review" && c.due <= t).sort((a, b) => a.due - b.due).slice(0, revRem);
  const news = cards.filter(c => c.state === "new").sort((a, b) => a.due - b.due).slice(0, newRem);
  return [...learning, ...review, ...news];
}

export function getCardFB(s: AnkiAppState, card: AnkiCard): { front: string; back: string; deckName: string } {
  const note = s.notes.find(n => n.noteId === card.noteId);
  if (!note) return { front: "—", back: "—", deckName: "" };
  const deck = s.decks.find(d => d.deckId === card.deckId);
  if (note.type === "cloze") {
    const r = renderCloze(note.fields.text ?? "", card.ord);
    const extra = note.fields.extra ? `<div class="cloze-extra">${esc(note.fields.extra)}</div>` : "";
    return { front: r.front, back: r.back + extra, deckName: deck?.name ?? "" };
  }
  const f = esc(note.fields.front ?? ""), b = esc(note.fields.back ?? "");
  if (note.reversed && card.ord === 1) return { front: b, back: f, deckName: deck?.name ?? "" };
  return { front: f, back: b, deckName: deck?.name ?? "" };
}

/* ---- Seed data ---- */
const SEED_CS = [
  { front: "문맥 교환(Context Switch)의 정의는?", back: "CPU가 한 프로세스의 상태를 저장하고 다른 것으로 복원해 실행을 전환하는 작업." },
  { front: "교착상태(Deadlock) 4가지 필요조건은?", back: "상호 배제, 점유와 대기, 비선점, 순환 대기." },
  { front: "프로세스와 스레드의 가장 큰 차이는?", back: "프로세스는 독립된 메모리 공간을 갖고, 스레드는 같은 프로세스 내 메모리를 공유한다." },
  { front: "선점형 스케줄링이란?", back: "실행 중인 프로세스를 강제로 중단시키고 CPU를 다른 프로세스에 할당하는 방식." },
  { front: "TCP 3-way handshake 순서는?", back: "SYN → SYN-ACK → ACK." },
];
const SEED_EN = [
  { front: "ubiquitous", back: "어디에나 있는, 도처에 존재하는." },
  { front: "mitigate", back: "완화하다, (위험·고통을) 덜다." },
  { front: "meticulous", back: "꼼꼼한, 세심한." },
  { front: "resilient", back: "회복력 있는, 탄력 있는." },
];
const SEED_CERT = [
  { front: "제1 정규형(1NF)의 조건은?", back: "모든 속성이 원자값(더 이상 분해되지 않는 값)을 가져야 한다." },
  { front: "OSI 7계층 중 4계층은?", back: "전송 계층(Transport) — TCP/UDP." },
];

export function makeDefaultAnkiState(): AnkiAppState {
  const s: AnkiAppState = {
    activeDeckId: "deck_default", decks: [], notes: [], cards: [], reviewLog: [],
    todayDate: todayKey(), todayCounts: { new: 0, learn: 0, review: 0 },
    settings: { newPerDay: 20, reviewPerDay: 200, learnSteps: [1, 10] },
  };
  const csId = createAId("deck"), enId = createAId("deck"), certId = createAId("deck");
  s.activeDeckId = csId;
  s.decks.push(
    { deckId: csId, name: "CS · 운영체제", category: "전공", createdAt: nowMs() },
    { deckId: enId, name: "영어 · 어휘", category: "영어", createdAt: nowMs() },
    { deckId: certId, name: "자격증 · 정보처리", category: "자격증", createdAt: nowMs() },
  );
  for (const { front, back } of SEED_CS) addBasicNote(s, csId, front, back, []);
  for (const { front, back } of SEED_EN) addReversedNote(s, enId, front, back, []);
  for (const { front, back } of SEED_CERT) addBasicNote(s, certId, front, back, []);
  addClozeNote(s, csId, "제3 정규형(3NF)은 2NF를 만족하고 모든 비주요 속성이 기본 키에 {{c1::이행적}}으로 종속되지 않을 것을 요구한다.", "정규화 개념을 함께 복습하세요.", []);
  addClozeNote(s, certId, "TCP는 {{c1::연결 지향}} 프로토콜이고, UDP는 {{c2::비연결}} 프로토콜이다.", "", []);

  let seed = 42;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  s.cards.forEach(c => {
    const r = rnd();
    if (r < 0.45) { c.state = "review"; c.interval = [1, 3, 6, 10, 15][Math.floor(rnd() * 5)]; c.reps = 1 + Math.floor(rnd() * 4); c.ease = 2.3 + rnd() * 0.4; c.due = nowMs() - Math.floor(rnd() * 2) * DAY; }
    else if (r < 0.62) { c.state = "learn"; c.learnStep = rnd() < 0.5 ? 0 : 1; c.due = nowMs() - Math.floor(rnd() * 5) * MIN; }
  });
  const grades: AnkiGrade[] = [0, 1, 2, 2, 2, 3];
  for (let d = 0; d < 30; d++) {
    const count = Math.floor(rnd() * 14);
    for (let k = 0; k < count; k++) {
      const g = grades[Math.floor(rnd() * grades.length)];
      s.reviewLog.push({ ts: nowMs() - d * DAY - Math.floor(rnd() * DAY), cardId: "seed", grade: g, prevInterval: 1, newInterval: 1 + Math.floor(rnd() * 12) });
    }
  }
  s.reviewLog.sort((a, b) => b.ts - a.ts);
  return s;
}

export function loadAnkiFromStorage(): AnkiAppState {
  try {
    const raw = localStorage.getItem("hak.anki_v1");
    if (raw) {
      const parsed = JSON.parse(raw) as AnkiAppState;
      if (parsed.todayDate !== todayKey()) { parsed.todayDate = todayKey(); parsed.todayCounts = { new: 0, learn: 0, review: 0 }; }
      return { ...makeDefaultAnkiState(), ...parsed };
    }
  } catch (e) { /* ignore */ }
  return makeDefaultAnkiState();
}

export function saveAnkiToStorage(s: AnkiAppState): void {
  try { localStorage.setItem("hak.anki_v1", JSON.stringify(s)); } catch (e) { /* ignore */ }
}
