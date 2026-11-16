// [공지·확정] — 매장 전체 (BOH·FOH가 모두 '저장'일 때만 켜짐). HrSendPanel(부서별 저장) 아래에 둔다
"use client";
import { useEffect, useState } from "react";
import { applyPublish, canPublish, onAgent, pingAgent, publishToAgent, type PublishAction, type PublishResult, type HrResult } from "./hrAgent";

type Props = {
  weekStart: string; weekEnd: string;
  hr: Record<string, { state: string; hash: string; at: number }>;
  bohIds: string[]; fohIds: string[]; // 그 주 BOH·FOH 재직 직원 empId
  saveWeekHr: (next: Props["hr"]) => Promise<void> | void;
};

export default function HrPublishPanel(p: Props) {
  const [ver, setVer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<HrResult["log"]>([]);
  const [res, setRes] = useState<PublishResult | null>(null);
  useEffect(() => { const off = onAgent((d) => { if (d.type === "MFG_HR_AGENT_READY") setVer(d.ver); }); pingAgent(); return () => { off(); }; }, []);
  const st = canPublish(p.hr, p.bohIds, p.fohIds);
  async function go(action: PublishAction) {
    const what = action === "confirm" ? "확정" : action === "notice" ? "공지" : "공지·확정";
    if (!confirm(`${p.weekStart}~${p.weekEnd} 매장 전체(BOH·FOH·STORE)를 ${what}할까요? 확장이 먼저 세 탭을 점검하고, 걸리는 게 있으면 누르지 않아요. 공지하면 직원에게 알림이 갑니다.`)) return;
    setBusy(true); setLog([]); setRes(null);
    const r = await publishToAgent({ weekStart: p.weekStart, weekEnd: p.weekEnd, action }, (it) => setLog((l) => [...l, it]));
    setRes(r); setBusy(false);
    const next = applyPublish(p.hr, [...p.bohIds, ...p.fohIds], r);
    if (next !== p.hr) await p.saveWeekHr(next);
  }
  return (
    <div className="hr-publish">
      <p>BOH {st.boh ? "저장됨" : "저장 전"} · FOH {st.foh ? "저장됨" : "저장 전"}{!ver && " · 확장 없음"}</p>
      <div className="row">
        <button disabled={!ver || busy || !st.ready} onClick={() => go("both")}>공지·확정 (매장 전체)</button>
        <button disabled={!ver || busy || !st.ready} onClick={() => go("notice")}>공지만</button>
        <button disabled={!ver || busy || !st.ready} onClick={() => go("confirm")}>확정만 (공지된 주)</button>
      </div>
      {log.length > 0 && <ol className="log">{log.map((l, i) => <li key={i}>{l.t} · {l.stage} · {l.msg}</li>)}</ol>}
      {res && (
        <div className={res.ok ? "ok" : "err"}>
          <b>{res.ok ? (res.confirmed ? "확정까지 끝 — 두 부서 전원 확정" : "공지 끝") : `${res.stage === "precheck" ? "공지 전 점검" : res.stage}에서 멈춤 (공지·확정 안 누름)`}</b>
          <p>{res.message}</p>
          {res.rowErrors.length > 0 && <ul>{res.rowErrors.map((e, i) => <li key={i}>{e.dept} {e.name || e.empNo} {e.msg}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
