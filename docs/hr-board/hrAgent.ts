// MFG HR Board ↔ GW Agent 1.12.0 — 보내기 전 처리 + 확장과 주고받기 (보드 저장소에 그대로 넣어 쓰는 파일)
//  확장 쪽 규칙(gw-agent/hrsend-core.js)과 같은 검사를 보드에서 먼저 해서, 틀린 것은 HR까지 가지 않게 한다.
//  보드 구조(11/16 번들 기준): roster(empNo, name, title, active) · settings.hrDeptName[dept] · settings.lists[dept](근태 구분: 휴무/휴일가산/HR 표기)
//  · week.cells · week.hr[empId] = { state: none|changed|saved|confirmed, hash, at }
//  지금 HR전송 탭이 직원별로 만드는 days({kind, in, out, brk})를 그대로 받아, kind를 "HR 표기"로 바꾼 뒤 검사한다.

export type Dept = "BOH" | "FOH";
export type Mode = "test" | "saveOnly" | "full";
export type HrDay = { date: string; kind: string; in: string; out: string; brk: string };
export type HrEmp = { empNo: string; name: string; days: HrDay[] };
export type RowError = { empNo?: string; name?: string; day?: string; msg: string };
export type HrResult = {
  type: "MFG_HR_SEND_RESULT"; requestId: string; ok: boolean;
  stage: "precheck" | "week" | "upload" | "save" | "notice" | "confirm"; day?: string | null; message: string;
  rowErrors: RowError[]; savedDays: string[]; noticed: boolean; confirmed: boolean; savedEmpNos: string[];
  mode: Mode; test?: boolean; code?: "login" | "network" | "confirmed" | "noticed" | "nostatus" | string; missing?: string[];
  log: { t: string; stage: string; day: string | null; msg: string; ajax?: string }[];
};

export const HR_KINDS = ["출근", "휴무", "주휴일", "공휴일"] as const;
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DOW_KO = ["월", "화", "수", "목", "금", "토", "일"];

// 근태 → HR 근태유형: 운영 설정의 "HR 표기"(settings.lists[dept]의 각 항목). 출근은 그대로.
//  지금 설정: D/O→휴무, 고정→휴무, 주휴일→주휴일, 공휴일→공휴일, 교육→출근, 연차→"연차"(HR에 없음 → 전송 차단)
export function hrKindMap(list: { name: string; hr?: string }[] | undefined): Record<string, string> {
  const m: Record<string, string> = { 출근: "출근" };
  (list || []).forEach((x) => { if (x && x.name) m[x.name] = (x.hr || "").trim() || x.name; });
  return m;
}

export function hhmm(v: string | undefined | null): string | null {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return m[1].padStart(2, "0") + ":" + m[2];
}
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const workMin = (d: HrDay) => { if (!d.in || !d.out) return 0; let w = mins(d.out) - mins(d.in); if (w <= 0) w += 1440; return Math.max(0, w - (d.brk ? mins(d.brk) : 0)); };

// 보내기 전 정리·검사. errors가 있으면 [전송]을 막는다(test 모드는 주휴일·52시간을 경고만).
export function prepare(raw: HrEmp[], kindMap: Record<string, string>, weekStart: string, mode: Mode) {
  const errors: RowError[] = [], warns: RowError[] = [], emps: HrEmp[] = [];
  const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(weekStart + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10));
  for (const e of raw) {
    const name = (e.name || "").trim(), empNo = String(e.empNo || "").trim();
    const bad = (msg: string, i?: number) => errors.push({ empNo, name, day: i == null ? undefined : DOW[i], msg: (i == null ? "" : DOW_KO[i] + " ") + msg });
    if (!/^\d{4,12}$/.test(empNo)) { bad("사번이 없어요"); continue; }
    const by = new Map(e.days.map((d) => [d.date, d]));
    const days: HrDay[] = [];
    dates.forEach((date, i) => {
      const d = by.get(date); if (!d) { bad("날짜가 빠졌어요", i); return; }
      const kind = kindMap[d.kind] ?? d.kind;
      if (!(HR_KINDS as readonly string[]).includes(kind)) { bad(`'${d.kind}'의 HR 표기가 '${kind}' — HR엔 출근·휴무·주휴일·공휴일만 있어요 (운영 설정에서 HR 표기를 정해 주세요)`, i); return; }
      let tin = hhmm(d.in), tout = hhmm(d.out), brk = hhmm(d.brk);
      if (tin === null || tout === null || brk === null) { bad(`시간 모양이 틀려요 (${d.in}~${d.out}/${d.brk})`, i); return; }
      if (kind === "출근") { if (!tin || !tout) { bad("출근인데 출근·퇴근 시각이 비었어요", i); return; } brk = brk || "00:00"; }
      else if (kind === "휴무" || kind === "주휴일") { tin = tout = brk = ""; }
      else { const n = [tin, tout, brk].filter(Boolean).length; if (n === 2 && tin && tout) brk = "00:00"; else if (n !== 0 && n !== 3) { bad("공휴일 시간은 셋 다 있거나 셋 다 비어야 해요", i); return; } }
      days.push({ date, kind, in: tin, out: tout, brk }); // 섹션·OP/CL은 넣지 않음(앱 전용)
    });
    if (days.length !== 7) continue;
    const wk = days.filter((d) => d.kind === "주휴일").length, total = days.reduce((t, d) => t + workMin(d), 0);
    const rule: string[] = [];
    if (wk !== 1) rule.push(`주휴일이 주에 ${wk}일 (정확히 1일이어야 함)`);
    if (total > 52 * 60) rule.push(`주 ${Math.floor(total / 60)}시간 ${total % 60}분 (52시간 넘음)`);
    if (rule.length && mode !== "test") { rule.forEach((m) => bad(m)); continue; }
    rule.forEach((m) => warns.push({ empNo, name, msg: m }));
    emps.push({ empNo, name, days });
  }
  return { ok: !errors.length, errors, warns, emps };
}

export const hashOf = (days: HrDay[]) => days.map((d) => `${d.kind}|${d.in}|${d.out}|${d.brk}`).join(";");

// 확장과 주고받기
type Listener = (m: any) => void;
const listeners = new Set<Listener>();
let agentVer: string | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data || {};
    if (d.type === "MFG_HR_AGENT_READY") agentVer = d.ver;
    if (typeof d.type === "string" && d.type.startsWith("MFG_HR_")) listeners.forEach((f) => f(d));
  });
}
export const pingAgent = () => window.postMessage({ type: "MFG_HR_PING" }, location.origin);
export const agentVersion = () => agentVer;
export function onAgent(f: Listener) { listeners.add(f); return () => listeners.delete(f); }

export function sendToAgent(p: { dept: Dept; weekStart: string; weekEnd: string; mode: Mode; employees: HrEmp[]; allowInit?: boolean },
  onProgress?: (item: HrResult["log"][number]) => void): Promise<HrResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const off = onAgent((d) => {
      if (d.requestId !== requestId) return;
      if (d.type === "MFG_HR_SEND_PROGRESS") onProgress?.(d.item);
      if (d.type === "MFG_HR_SEND_ACK" && !d.ok) { off(); resolve({ type: "MFG_HR_SEND_RESULT", requestId, ok: false, stage: "precheck", message: d.error || "확장이 요청을 안 받았어요", rowErrors: [], savedDays: [], noticed: false, confirmed: false, savedEmpNos: [], mode: p.mode, log: [] }); }
      if (d.type === "MFG_HR_SEND_RESULT") { off(); resolve(d as HrResult); }
    });
    window.postMessage({ type: "MFG_HR_SEND", requestId, ...p }, location.origin);
  });
}

// 결과 → week.hr (empId별). 보낸 시점 hash로 저장 → 나중에 스케쥴이 바뀌면 기존처럼 '수정 필요'
export function applyResult(prev: Record<string, { state: string; hash: string; at: number }>, sent: { empId: string; empNo: string; hash: string }[], r: HrResult) {
  if (r.mode === "test" || r.test) return prev; // 시험은 상태를 바꾸지 않음
  const next = { ...prev }, at = Date.now(), saved = new Set(r.savedEmpNos || []);
  const allSaved = (r.savedDays || []).length === 7;
  for (const s of sent) {
    if (r.ok && r.confirmed) next[s.empId] = { state: "confirmed", hash: s.hash, at };
    else if (allSaved && saved.has(s.empNo)) next[s.empId] = { state: "saved", hash: s.hash, at }; // 저장까지만 (saveOnly 또는 공지·확정 실패)
    // 업로드·저장 실패(일부 요일만 저장 포함): 상태 그대로
  }
  return next;
}
