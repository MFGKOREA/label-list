// [HR 전송] 모달 안 내용 — 지금의 "HR 사이트에 직접 입력" 안내 + [전송 완료]를 이걸로 바꾼다
//  props는 보드에 이미 있는 값으로 채운다: dept, weekStart, weekEnd(월~일), roster, buildDays(지금 HR전송 탭이 직원별 days를 만드는 함수),
//  settings(hrDeptName·lists), week.hr, saveWeekHr(week.hr 저장), idOf(roster 행 → empId)
"use client";
import { useEffect, useMemo, useState } from "react";
import { applyResult, agentVersion, hashOf, hrKindMap, onAgent, pingAgent, prepare, sendToAgent, HR_EXPECT_SEC, type Dept, type HrDay, type HrResult, type Mode } from "./hrAgent";

type Props = {
  dept: Dept; weekStart: string; weekEnd: string;
  roster: { empNo: string; name: string; title?: string; active: boolean; dept: Dept }[];
  buildDays: (r: Props["roster"][number]) => HrDay[];
  settings: { hrDeptName?: Record<string, string>; lists?: Record<string, { name: string; hr?: string }[]> };
  hr: Record<string, { state: string; hash: string; at: number }>;
  idOf: (r: Props["roster"][number]) => string;
  saveWeekHr: (next: Props["hr"]) => Promise<void> | void;
};

export default function HrSendPanel(p: Props) {
  const [ver, setVer] = useState<string | null>(agentVersion());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<HrResult["log"]>([]);
  const [res, setRes] = useState<HrResult | null>(null);
  const [run, setRun] = useState<{ mode: Mode; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!run) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [run]);
  useEffect(() => { const off = onAgent((d) => { if (d.type === "MFG_HR_AGENT_READY") setVer(d.ver); }); pingAgent(); return () => { off(); }; }, []);
  // 대상: 그 부서·주차의 재직 직원 전원 (업로드가 그날 그 부서 화면을 통째로 바꿈 → 일부만 보내면 안 됨)
  const staff = useMemo(() => p.roster.filter((r) => r.active && r.dept === p.dept), [p.roster, p.dept]);
  const kindMap = useMemo(() => hrKindMap(p.settings.lists?.[p.dept]), [p.settings, p.dept]);
  const raw = useMemo(() => staff.map((r) => ({ empNo: String(r.empNo), name: r.name, days: p.buildDays(r) })), [staff, p.buildDays]);
  const pre = (mode: Mode) => prepare(raw, kindMap, p.weekStart, mode);
  const check = pre("full");

  async function go(mode: Mode, allowInit = false) {
    const c = pre(mode);
    if (!c.ok) { setRes({ type: "MFG_HR_SEND_RESULT", requestId: "", ok: false, stage: "precheck", message: `보내기 전 검사에서 ${c.errors.length}건`, rowErrors: c.errors, savedDays: [], noticed: false, confirmed: false, savedEmpNos: [], mode, log: [] }); return; }
    if (mode === "full" && !confirm(`${p.weekStart}~${p.weekEnd} ${p.dept} ${c.emps.length}명을 HR에 저장하고 공지·확정까지 할까요? (확정하면 직원에게 공지가 나갑니다)`)) return;
    setBusy(true); setLog([]); setRes(null); setRun({ mode, at: Date.now() });
    const sent = staff.map((r) => { const e = c.emps.find((x) => x.empNo === String(r.empNo))!; return { empId: p.idOf(r), empNo: e.empNo, hash: hashOf(e.days) }; }); // 보낸 시점 hash
    const r = await sendToAgent({ dept: p.dept, weekStart: p.weekStart, weekEnd: p.weekEnd, mode, employees: c.emps, allowInit }, (it) => setLog((l) => [...l, it]));
    setRes(r); setBusy(false); setRun(null);
    const next = applyResult(p.hr, sent, r);
    if (next !== p.hr) await p.saveWeekHr(next);
  }

  const STAGE: Record<string, string> = { precheck: "보내기 전 검사", week: "HR 접속·주차", upload: "업로드·검증", save: "저장", notice: "공지", confirm: "확정" };
  return (
    <div className="hr-send">
      <p>{ver ? `GW Agent ${ver} 연결됨` : "이 크롬에 GW Agent(1.12.0 이상)가 없어요 — 확장이 깔린 PC 크롬에서 열어 주세요"} · {p.settings.hrDeptName?.[p.dept] || p.dept} · {p.weekStart}~{p.weekEnd} · {staff.length}명</p>
      {!check.ok && (<div className="err"><b>전송 전에 고칠 것 {check.errors.length}건</b><ul>{check.errors.map((e, i) => <li key={i}>{e.name} {e.msg}</li>)}</ul></div>)}
      {check.warns.length > 0 && <p className="warn">경고 {check.warns.length}건 (시험 모드에서만 허용)</p>}
      <div className="row">
        <button disabled={!ver || busy} onClick={() => go("test")}>시험 (월요일만 저장)</button>
        <button disabled={!ver || busy || !check.ok} onClick={() => go("saveOnly")}>7일 저장만</button>
        <button disabled={!ver || busy || !check.ok} onClick={() => go("full")}>전송 (저장·공지·확정)</button>
      </div>
      {run && (() => { const [lo, hi] = HR_EXPECT_SEC[run.mode], sec = Math.round((now - run.at) / 1000), done = log.filter((l) => l.stage === "save" && l.day).length, total = run.mode === "test" ? 1 : 7;
        return <p className="run">진행 중 {Math.floor(sec / 60)}분 {sec % 60}초 · 저장 {done}/{total}일 · 보통 {Math.round(lo / 60 * 10) / 10}~{Math.round(hi / 60 * 10) / 10}분 걸려요 (HR 탭을 건드리지 마세요)</p>; })()}
      {log.length > 0 && <ol className="log">{log.map((l, i) => <li key={i}>{l.t} · {STAGE[l.stage] || l.stage}{l.day ? " · " + l.day : ""} · {l.msg}{l.ajax ? ` (${l.ajax})` : ""}</li>)}</ol>}
      {res && (
        <div className={res.ok ? "ok" : "err"}>
          <b>{res.ok ? (res.confirmed ? "확정까지 끝" : res.test ? "시험 성공" : "저장까지 끝") : `${STAGE[res.stage] || res.stage}에서 멈춤${res.day ? " (" + res.day + ")" : ""}`}</b>
          <p>{res.message}</p>
          {res.savedDays.length > 0 && <p>저장된 요일: {res.savedDays.join(", ")}</p>}
          {res.rowErrors.length > 0 && <ul>{res.rowErrors.map((e, i) => <li key={i}>{e.name || e.empNo} {e.day ? "(" + e.day + ")" : ""} {e.msg}</li>)}</ul>}
          {res.missing && res.missing.length > 0 && <p>HR에 있는데 보내지 않은 사번: {res.missing.join(", ")} (신규 입사자면 보드 명단에 추가)</p>}
          {res.code === "nostatus" && <button disabled={busy} onClick={() => go("full", true)}>HR 주차 초기화 후 다시 전송</button>}
        </div>
      )}
    </div>
  );
}
