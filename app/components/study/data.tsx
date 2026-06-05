'use client';
import * as Icons from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';

/* ---- Types ---- */
export interface StudySession {
  sessionId: string;
  userId: string;
  subject: string;
  timerType: 'POMODORO' | 'STOPWATCH' | 'TIMER';
  startTime: string;
  endTime: string;
  durationMinutes: number;
}
export interface LearningMaterial {
  materialId: string;
  fileName: string;
  fileType: string;
  category: string;
  uploadedAt: string;
}
export interface Summary {
  summaryId: string;
  title: string;
  content: string;
  sourceType: 'material' | 'note';
  category?: string;
  noteId?: string;
  createdAt: string;
}
export interface StudyNote {
  noteId: string;
  userId: string;
  title: string;
  subject: string;
  markdownContent: string;
  updatedAt: string;
}
export interface Quiz {
  quizId: string;
  noteId: string;
  question: string;
  answer: string;
  createdAt: string;
}
export interface User {
  userId: string;
  nickname: string;
  provider: 'GOOGLE' | 'KAKAO' | 'NAVER';
}
export interface RankLevel {
  lv: number;
  name: string;
  desc: string;
  metric: 'attend' | 'hours' | 'fixed';
}
export interface Character {
  characterId: string;
  userId: string;
  name: string;
  rankName: string;
  level: number;
  experiencePoint: number;
  growthStage: string;
  status: string;
  desc: string;
  attendanceDays: number;
  progress: number;
  nextInfo: string;
  totalHours: number;
  totalMinutes: number;
}

/* ---- Icon wrapper using lucide-react ---- */
function toPascalCase(name: string): string {
  return name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 18, className = '', color, strokeWidth = 2, style }: IconProps) {
  const LucideIcon = (Icons as Record<string, React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>>)[toPascalCase(name)];
  if (!LucideIcon) return null;
  return <LucideIcon width={size} height={size} className={className} color={color} strokeWidth={strokeWidth} style={style} aria-hidden="true" />;
}

/* ---- Utilities ---- */
export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60), rest = safe % 60;
  if (hours === 0) return `${rest}분`;
  if (rest === 0) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
}

export function recentDays(days = 7): string[] {
  const labels: string[] = [], now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    labels.push(d.toISOString().slice(0, 10));
  }
  return labels;
}

export const SUBJECTS = ["국어", "영어", "수학", "과학", "사회", "전공", "자격증", "기타"];

export const RANK_LEVELS: RankLevel[] = [
  { lv: 1, name: "춘식이", desc: "자아를 버리고 공부해!", metric: "attend" },
  { lv: 2, name: "염전 현장감독관", desc: "공부계의 말년병장? 사회는 실전이다!", metric: "attend" },
  { lv: 3, name: "염전 사장", desc: "공부 안하시면 사장님 나빠요!", metric: "hours" },
  { lv: 4, name: "경찰관", desc: "공부 안하면 잡아갑니다~", metric: "hours" },
  { lv: 5, name: "경찰서장", desc: "공부 안하고 뺑기는 ㄴㄴ", metric: "hours" },
  { lv: 6, name: "군수", desc: "공부유스", metric: "hours" },
  { lv: 7, name: "도의원", desc: "공부계의 초신성", metric: "hours" },
  { lv: 8, name: "시장", desc: "시장님 공부 안하시고 그러면 안돼요!", metric: "hours" },
  { lv: 9, name: "도지사", desc: "다음 여정을 위한 중요한 발판!", metric: "hours" },
  { lv: 10, name: "당대표", desc: "어쩌면 실세", metric: "hours" },
  { lv: 11, name: "언론사 회장", desc: "양날의 검, 소통의 창이자 선동의 창", metric: "hours" },
  { lv: 12, name: "부르주아", desc: "모두가 선망하는 물주", metric: "hours" },
  { lv: 13, name: "대통령", desc: "임기는 5년! 출석률 80% 미만이면 강등", metric: "hours" },
  { lv: 14, name: "프리메이슨", desc: "글로벌 리스트", metric: "fixed" },
];

export const HOUR_THRESHOLDS = [0, 100, 200, 300, 500, 700, 1000, 1300, 1600, 2000, 2400, 2900];

export function calculateCharacter(userId: string, sessions: StudySession[]): Character {
  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalHours = totalMinutes / 60;
  const experiencePoint = Math.round(totalMinutes);
  const uniqueDays = new Set(sessions.map(s => s.endTime.slice(0, 10)));
  const attendanceDays = uniqueDays.size;

  let level = 1;
  if (attendanceDays >= 100) level = 2;
  if (attendanceDays >= 200) {
    level = 3;
    for (let i = HOUR_THRESHOLDS.length - 1; i >= 0; i--) {
      if (totalHours >= HOUR_THRESHOLDS[i]) { level = 3 + i; break; }
    }
  }
  level = Math.min(level, 14);
  const rank = RANK_LEVELS[level - 1];

  let progress = 0;
  if (level === 14) {
    progress = 100;
  } else if (rank.metric === "attend") {
    progress = Math.min(100, Math.max(0, Math.round((attendanceDays - (level - 1) * 100) / 100 * 100)));
  } else {
    const idx = level - 3;
    const baseH = HOUR_THRESHOLDS[idx] || 0;
    const nextH = HOUR_THRESHOLDS[idx + 1] ?? baseH + 300;
    progress = Math.min(100, Math.max(0, Math.round((totalHours - baseH) / (nextH - baseH) * 100)));
  }

  let nextInfo = "";
  if (level < 14) {
    const nr = RANK_LEVELS[level];
    if (rank.metric === "attend") {
      nextInfo = `출석 ${Math.max(0, level * 100 - attendanceDays)}일 더 → ${nr.name}`;
    } else {
      const idx = level - 3;
      const nextH = HOUR_THRESHOLDS[idx + 1] ?? (HOUR_THRESHOLDS[idx] || 0) + 300;
      nextInfo = `공부 ${Math.max(0, Math.ceil(nextH - totalHours))}시간 더 → ${nr.name}`;
    }
  }

  return {
    characterId: `character_${userId}`, userId, name: "루미", rankName: rank.name, level,
    experiencePoint, growthStage: rank.name, status: rank.desc, desc: rank.desc,
    attendanceDays, progress, nextInfo, totalHours: Math.round(totalHours), totalMinutes,
  };
}

/* ---- Demo data ---- */
export function buildSampleSessions(): StudySession[] {
  const out: StudySession[] = [];
  const today = new Date();
  let seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 250; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dow = d.getDay();
    if (rand() > (dow === 0 || dow === 6 ? 0.6 : 0.9)) continue;
    const count = rand() < 0.45 ? 2 : rand() < 0.2 ? 3 : 1;
    for (let s = 0; s < count; s++) {
      const subject = SUBJECTS[Math.floor(rand() * SUBJECTS.length)];
      const dur = [25, 25, 30, 45, 50, 50, 60, 90][Math.floor(rand() * 8)];
      const end = new Date(d);
      end.setHours(8 + Math.floor(rand() * 13), Math.floor(rand() * 60));
      out.push({
        sessionId: `s_${i}_${s}`, userId: "demo", subject,
        timerType: rand() < 0.5 ? "POMODORO" : rand() < 0.5 ? "STOPWATCH" : "TIMER",
        startTime: new Date(end.getTime() - dur * 60000).toISOString(),
        endTime: end.toISOString(), durationMinutes: dur,
      });
    }
  }
  return out.sort((a, b) => a.endTime < b.endTime ? 1 : -1);
}

export const SAMPLE_SUMMARIES: Summary[] = [
  { summaryId: "sum1", title: "운영체제 - 프로세스 스케줄링", sourceType: "material", category: "전공", createdAt: "2026-05-31T10:20:00", content: "# 운영체제 - 프로세스 스케줄링 요약\n\n## 핵심 내용\n- 선점형 스케줄링은 실행 중인 프로세스를 중단시키고 다른 프로세스에 CPU를 할당한다.\n- 라운드 로빈은 타임 퀀텀 단위로 프로세스를 순환 실행한다.\n- 우선순위 스케줄링은 기아 상태를 유발할 수 있어 에이징 기법으로 보완한다.\n\n## 복습 포인트\n- 각 알고리즘의 평균 대기 시간을 계산해 보세요.\n\n> Gemini API로 생성된 요약입니다." },
  { summaryId: "sum2", title: "자료구조 - 이진 탐색 트리", sourceType: "material", category: "전공", createdAt: "2026-05-30T14:05:00", content: "# 자료구조 - 이진 탐색 트리 요약\n\n## 핵심 내용\n- BST는 왼쪽 서브트리의 모든 값이 루트보다 작고 오른쪽은 크다.\n- 균형이 무너지면 탐색이 O(n)까지 느려진다.\n\n## 복습 포인트\n- 삽입/삭제 시 회전 연산을 직접 그려 보세요." },
  { summaryId: "sum3", title: "영어 모의고사 오답 노트", sourceType: "note", category: "영어", createdAt: "2026-05-28T19:40:00", content: "# 영어 모의고사 오답 노트 요약\n\n## 핵심 내용\n- 빈칸 추론은 글의 주제문과 반복되는 키워드를 먼저 찾는다.\n\n> 노트에서 생성된 요약입니다." },
  { summaryId: "sum4", title: "네트워크 - TCP/IP 계층", sourceType: "material", category: "전공", createdAt: "2026-05-27T09:10:00", content: "# 네트워크 - TCP/IP 계층 요약\n\n## 핵심 내용\n- 응용 → 전송 → 인터넷 → 네트워크 인터페이스 4계층 구조.\n- TCP는 연결 지향·신뢰성, UDP는 비연결·고속.\n\n## 복습 포인트\n- 각 계층의 대표 프로토콜을 정리해 보세요." },
];

export const SAMPLE_MATERIALS: LearningMaterial[] = [
  { materialId: "m1", fileName: "OS_3장_스케줄링.pdf", fileType: "PDF", category: "전공", uploadedAt: "2026-05-31T10:18:00" },
  { materialId: "m2", fileName: "자료구조_BST.pdf", fileType: "PDF", category: "전공", uploadedAt: "2026-05-30T14:02:00" },
  { materialId: "m3", fileName: "영단어_DAY12.txt", fileType: "TXT", category: "영어", uploadedAt: "2026-05-29T08:30:00" },
  { materialId: "m4", fileName: "네트워크_TCPIP.md", fileType: "MD", category: "전공", uploadedAt: "2026-05-27T09:05:00" },
];

export const SAMPLE_NOTES: StudyNote[] = [
  { noteId: "n1", userId: "demo", title: "운영체제 핵심 정리", subject: "전공", updatedAt: "2026-06-01T09:10:00", markdownContent: "## 오늘의 핵심\n- 프로세스와 스레드의 차이\n- 컨텍스트 스위칭 비용\n- 교착 상태의 4가지 조건\n\n## 복습 포인트\n- 세마포어와 뮤텍스 비교\n> 시험 D-14, 매일 1챕터씩" },
  { noteId: "n2", userId: "demo", title: "영어 구문 정리", subject: "영어", updatedAt: "2026-05-31T20:30:00", markdownContent: "## 오늘의 핵심\n- 가정법 과거완료\n- 도치 구문\n\n## 예문\n- Had I known, I would have come." },
  { noteId: "n3", userId: "demo", title: "수학 미적분 공식", subject: "수학", updatedAt: "2026-05-29T16:00:00", markdownContent: "## 오늘의 핵심\n- 부분적분 공식\n- 치환적분의 조건" },
];

export const SAMPLE_QUIZZES: Quiz[] = [
  { quizId: "q1", noteId: "n1", question: "컨텍스트 스위칭이 비용이 큰 이유는?", answer: "레지스터·PCB 저장/복원과 캐시·TLB 무효화 때문입니다.", createdAt: "2026-06-01T09:10:00" },
  { quizId: "q2", noteId: "n1", question: "교착 상태의 4가지 필요조건은?", answer: "상호 배제, 점유와 대기, 비선점, 순환 대기.", createdAt: "2026-06-01T09:10:00" },
];

/* ---- Markdown preview ---- */
export function MarkdownPreview({ content }: { content: string }) {
  const lines = (content || "").split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith("# ")) out.push(<h1 key={i}>{line.slice(2)}</h1>);
    else if (line.startsWith("## ")) out.push(<h2 key={i}>{line.slice(3)}</h2>);
    else if (line.startsWith("### ")) out.push(<h3 key={i}>{line.slice(4)}</h3>);
    else if (line.startsWith("- ")) out.push(<p key={i} className="bullet-line">{line.slice(2)}</p>);
    else if (line.startsWith("> ")) out.push(<blockquote key={i}>{line.slice(2)}</blockquote>);
    else if (!line.trim()) out.push(<br key={i} />);
    else out.push(<p key={i}>{line}</p>);
  });
  return <div className="markdown-preview">{out}</div>;
}

export function summarizeLocally(title: string): string {
  return [
    `# ${title} 요약`, "", "## 핵심 내용",
    "- 업로드한 자료의 주요 개념을 추출했습니다.",
    "- 핵심 용어와 정의를 다시 설명할 수 있는지 확인하세요.",
    "", "## 복습 포인트",
    "- 타이머를 켜고 25분 단위로 읽기, 정리, 문제 풀이를 나누면 좋습니다.",
    "", "> Gemini API 키가 없어 로컬 요약으로 생성되었습니다.",
  ].join("\n");
}

/* ---- Hooks ---- */
export function useCountUp(target: number, duration = 700): number {
  const [val, setVal] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const from = ref.current, to = target, start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = from + (to - from) * eased;
      setVal(cur); ref.current = cur;
      if (t < 1) raf = requestAnimationFrame(tick); else { setVal(to); ref.current = to; }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

/* ---- Toast ---- */
type ToastPushFn = (message: string, opts?: { icon?: string; accent?: boolean }) => void;
let _toastPush: ToastPushFn | null = null;

export function pushToast(message: string, opts: { icon?: string; accent?: boolean } = {}): void {
  if (_toastPush) _toastPush(message, opts);
}

interface ToastItem { id: string; message: string; icon: string; accent: boolean; out?: boolean; }

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    _toastPush = (message, opts = {}) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(t => [...t, { id, message, icon: opts.icon || "check-circle-2", accent: !!opts.accent }]);
      setTimeout(() => setToasts(t => t.map(x => x.id === id ? { ...x, out: true } : x)), 2600);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2900);
    };
    return () => { _toastPush = null; };
  }, []);
  return (
    <div className="toast-host">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.accent ? "accent" : ""} ${t.out ? "out" : ""}`}>
          <span className="t-ico"><Icon name={t.icon} size={17} /></span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
