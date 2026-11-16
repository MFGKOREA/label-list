// 당일 되풀이 수집 판단 (1.11.0 — 11/16 KM "당일 Gross·SET판매현황도 PC가 스스로, 1시간마다")
//  화면·저장소·네트워크를 건드리지 않는 순수 함수 → 확장(bg.js)과 시험(node)이 같은 코드를 씀
//  하는 일: 지금이 "당일 Gross(kind now)"·"당일 Set판매현황(kind sets·today)"을 읽을 시간인지 정하고,
//           그 요청(폰 버튼과 같은 salesPush)을 만든다. 실제로 창을 열고 읽는 일은 bg.js·mis-sales.js가 함(기존 길 그대로)
//  언제 할지는 gw-plan.json의 되풀이 항목(kind now·setsToday, everyMin·at·from·to)이 정함. 없으면 둘 다 1시간(:40)
//  원칙: 영업 시간(기본 08:30~23:00)에만, 발주 시간대(12:30~14:45)에는 창을 띄우지 않음,
//        한 시간대에 한 번만(실패해도 같은 시간대에 다시 두드리지 않음 — MIS가 막을 수 있음), 하루 상한(기본 20번)
(function (G) {
  const MIN = 60e3;
  const kst = (ms) => new Date(ms + 9 * 3600e3); // 한국 시각을 UTC 칸으로 읽음 (PC 시계가 어디에 맞춰져 있든 같게)
  const ymd = (ms) => kst(ms).toISOString().slice(0, 10);
  const HHMM = (s, dflt) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? "" : s).trim()); return m ? (+m[1]) * 60 + (+m[2]) : dflt; };
  const DEF = { everyMin: 60, at: 40, from: 8 * 60 + 30, to: 23 * 60, key: { now: "nowSales", setsToday: "setNow" } };
  const KINDS = /^(now|setsToday)$/;

  // 계획(gw-plan.json)에서 되풀이 항목만. 항목이 없으면 기본 둘 다(1시간·:40) — 계획을 못 받아도 무인 수집이 멈추지 않게
  function periodJobs(plan) {
    const has = Array.isArray(plan) && plan.some((j) => j && KINDS.test(String(j.kind || "")));
    const use = has ? plan.filter((j) => j && KINDS.test(String(j.kind || ""))) : [{ kind: "now" }, { kind: "setsToday" }];
    return use.map((j) => {
      const kind = String(j.kind);
      return {
        kind,
        key: j.key || DEF.key[kind],
        label: j.label || (kind === "now" ? "당일 Gross" : "당일 Set판매현황"),
        everyMin: Math.max(15, Math.floor(+j.everyMin) || DEF.everyMin),
        at: Math.min(59, Math.max(0, j.at == null ? DEF.at : Math.floor(+j.at) || 0)),
        from: HHMM(j.from, DEF.from),
        to: HHMM(j.to, DEF.to),
      };
    }).filter((j, i, a) => a.findIndex((x) => x.kind === j.kind) === i); // 같은 종류는 하나만
  }

  // 지금 할 차례인가 → { go, day, jobs, st(정리한 상태), why(사람이 읽을 한 줄) }
  //  st: { day, n(오늘 낸 요청 수), jobAt: { [kind]: 마지막으로 낸 시각 }, reqId, ok, okAt, msg, next }
  function periodDue(now, st, jobs, o) {
    o = o || {};
    const t = kst(now), hm = t.getUTCHours() * 60 + t.getUTCMinutes(), day = ymd(now);
    const S = st && st.day === day ? st : { day, n: 0, jobAt: {}, ok: null, okAt: 0 };
    const skip = o.orderSkip || [12 * 60 + 30, 14 * 60 + 45]; // 발주 시간대: 기존 규칙과 같게 창을 안 띄움
    const hourStart = Math.floor(now / 3600e3) * 3600e3; // 정시 경계 (한국 시각도 정시라 같음)
    const out = [], why = [];
    for (const j of (Array.isArray(jobs) ? jobs : [])) {
      if (hm < j.from || hm >= j.to) { why.push(`${j.label}: 영업 시간 밖`); continue; }
      if (hm >= skip[0] && hm <= skip[1]) { why.push(`${j.label}: 발주 시간대`); continue; }
      if (now < hourStart + j.at * MIN) { why.push(`${j.label}: 이번 시간 ${String(j.at).padStart(2, "0")}분 뒤`); continue; }
      const last = (S.jobAt || {})[j.kind] || 0;
      if (last >= hourStart) { why.push(`${j.label}: 이번 시간에 이미 함`); continue; }
      if (now - last < j.everyMin * MIN) { why.push(`${j.label}: ${j.everyMin}분 주기`); continue; }
      out.push(j);
    }
    if (!out.length) return { go: false, day, st: S, jobs: [], why: why[0] || "할 일 없음" };
    if ((S.n || 0) >= (o.maxPerDay || 20)) return { go: false, day, st: S, jobs: out, why: `오늘 ${S.n}번 요청 (상한)` };
    return { go: true, day, st: S, jobs: out, why: out.map((j) => j.label).join(" + ") };
  }

  // 요청 만들기 (폰 버튼과 같은 salesPush 모양). now가 있으면 now가 본체, 오늘 Set는 덧붙임(also) → 창 하나로 둘 다
  //  kind sets + today: 1 → mis-sales.js가 오늘 중간값을 setDay가 아니라 setNow에 둠 (하루 합계 기록과 섞지 않게)
  function periodBundle(now, jobs, src) {
    const day = ymd(now), t = Math.floor(now) || Date.now(), kinds = (Array.isArray(jobs) ? jobs : []).map((j) => j.kind);
    const sets = { from: day, to: day, force: 1, today: 1 };
    const r = { id: t, at: t, status: "pending", src: src || "pc-hour" };
    if (kinds.indexOf("now") >= 0) {
      Object.assign(r, { kind: "now", from: day, to: day });
      if (kinds.indexOf("setsToday") >= 0) r.also = { sets: Object.assign({}, sets, { at: t }) };
    } else Object.assign(r, sets, { kind: "sets" });
    return r;
  }

  // 시트 상태로 양보 판단 — 다른 매출·발주 요청이 도는 중이면 창을 열지 않음(as sales). 막히면 사유, 아니면 null
  function periodBlocked(d, now, reqId) {
    d = d || {};
    const sp = d.salesPush || {}, mp = d.misPush || {};
    const id = sp.id == null ? "" : "s" + sp.id, st = String(sp.status || ""), age = now - (sp.at || 0);
    if (st === "running" && now - (sp.startAt || sp.at || 0) < 14 * MIN) return "다른 매출 요청이 도는 중";
    if (st === "pending" && age < 6 * MIN && id !== reqId) return "다른 매출 요청이 도는 중";
    if (st === "pending" && age < 20 * MIN && id === reqId) return "앞서 낸 요청을 아직 처리 중";
    if (/^(pending|running)$/.test(String(mp.status || "")) && now - (mp.at || 0) < 20 * MIN) return "발주 전송 중";
    return null;
  }

  G.periodJobs = periodJobs;
  G.periodDue = periodDue;
  G.periodBundle = periodBundle;
  G.periodBlocked = periodBlocked;
})(typeof self !== "undefined" ? self : globalThis);
