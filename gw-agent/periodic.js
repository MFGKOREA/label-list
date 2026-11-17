// 당일 되풀이 수집 판단 (1.11.0 — 11/16 KM "당일 Gross·SET판매현황도 PC가 스스로, 1시간마다")
//  1.17.0 (11/17 KM 승인 1·13번): 되풀이 종류에 당일 메뉴별 판매(menuToday → menuNow)를 더하고,
//           실패하면 다음 확인을 지수로 미루는 재시도(periodBackoff)와 마감 스냅샷(snapDue) 판단을 더함
//  화면·저장소·네트워크를 건드리지 않는 순수 함수 → 확장(bg.js)과 시험(node)이 같은 코드를 씀
//  하는 일: 지금이 "당일 Gross(kind now)"·"당일 Set판매현황(kind sets·today)"·"당일 메뉴 판매(kind menu·today)"를
//           읽을 시간인지 정하고, 그 요청(폰 버튼과 같은 salesPush)을 만든다. 실제로 창을 열고 읽는 일은 bg.js·mis-sales.js가 함(기존 길 그대로)
//  언제 할지는 gw-plan.json의 되풀이 항목(kind now·setsToday·menuToday, everyMin·at·from·to)이 정함. 없으면 Gross·Set 둘 다 1시간(:40)
//  원칙: 영업 시간(기본 08:30~23:00)에만, 발주 시간대(12:30~14:45)에는 창을 띄우지 않음,
//        한 시간대에 한 번만. 실패하면 그 시간대를 기다리지 않고 5분 → 15분 → 45분으로 미뤄 세 번까지 다시(지수 백오프), 하루 상한(기본 20번)
(function (G) {
  const MIN = 60e3;
  const kst = (ms) => new Date(ms + 9 * 3600e3); // 한국 시각을 UTC 칸으로 읽음 (PC 시계가 어디에 맞춰져 있든 같게)
  const ymd = (ms) => kst(ms).toISOString().slice(0, 10);
  const HHMM = (s, dflt) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? "" : s).trim()); return m ? (+m[1]) * 60 + (+m[2]) : dflt; };
  const DEF = { everyMin: 60, at: 40, from: 8 * 60 + 30, to: 23 * 60, key: { now: "nowSales", setsToday: "setNow", menuToday: "menuNow" } };
  const KINDS = /^(now|setsToday|menuToday)$/;
  const LABEL = { now: "당일 Gross", setsToday: "당일 Set판매현황", menuToday: "당일 메뉴 판매" };

  // 계획(gw-plan.json)에서 되풀이 항목만. 항목이 없으면 기본 둘(Gross·Set, 1시간·:40) — 계획을 못 받아도 무인 수집이 멈추지 않게
  function periodJobs(plan) {
    const has = Array.isArray(plan) && plan.some((j) => j && KINDS.test(String(j.kind || "")));
    const use = has ? plan.filter((j) => j && KINDS.test(String(j.kind || ""))) : [{ kind: "now" }, { kind: "setsToday" }];
    return use.map((j) => {
      const kind = String(j.kind);
      return {
        kind,
        key: j.key || DEF.key[kind],
        label: j.label || LABEL[kind] || kind,
        everyMin: Math.max(15, Math.floor(+j.everyMin) || DEF.everyMin),
        at: Math.min(59, Math.max(0, j.at == null ? DEF.at : Math.floor(+j.at) || 0)),
        from: HHMM(j.from, DEF.from),
        to: HHMM(j.to, DEF.to),
      };
    }).filter((j, i, a) => a.findIndex((x) => x.kind === j.kind) === i); // 같은 종류는 하나만
  }

  // 실패 뒤 다시 볼 때까지 (1.17.0): 5분 → 15분 → 45분. n은 오늘 연속 실패 횟수(1부터). 최대 3번까지 다시
  function periodBackoff(n, o) {
    o = o || {};
    const maxMin = o.maxMin || 60, step = o.step || 3, first = o.firstMin || 5;
    const k = Math.max(1, Math.floor(+n || 1));
    return Math.min(maxMin, first * Math.pow(step, k - 1)) * MIN;
  }
  const MAX_RETRY = 3; // 한 차례(한 시간대) 실패에 다시 해 보는 횟수 상한

  // 지금 할 차례인가 → { go, day, jobs, st(정리한 상태), why(사람이 읽을 한 줄) }
  //  st: { day, n(오늘 낸 요청 수), jobAt: { [kind]: 마지막 요청 시각 }, failN: 오늘 연속 실패 횟수, reqId, ok, okAt, msg, next }
  function periodDue(now, st, jobs, o) {
    o = o || {};
    const t = kst(now), hm = t.getUTCHours() * 60 + t.getUTCMinutes(), day = ymd(now);
    const S = st && st.day === day ? st : { day, n: 0, jobAt: {}, failN: 0, ok: null, okAt: 0 };
    const skip = o.orderSkip || [12 * 60 + 30, 14 * 60 + 45]; // 발주 시간대: 기존 규칙과 같게 창을 안 띄움
    const hourStart = Math.floor(now / 3600e3) * 3600e3; // 정시 경계 (한국 시각도 정시라 같음)
    const failN = Math.max(0, Math.floor(+S.failN || 0));
    const retry = failN > 0 && failN <= (o.maxRetry == null ? MAX_RETRY : o.maxRetry); // 실패했으면 이번 시간대라도 다시
    const out = [], why = [];
    for (const j of (Array.isArray(jobs) ? jobs : [])) {
      if (hm < j.from || hm >= j.to) { why.push(`${j.label}: 영업 시간 밖`); continue; }
      if (hm >= skip[0] && hm <= skip[1]) { why.push(`${j.label}: 발주 시간대`); continue; }
      const last = (S.jobAt || {})[j.kind] || 0;
      // 재시도: 같은 시간대에 이미 했어도 실패 뒤 정해진 시간(5·15·45분)이 지났으면 다시
      if (last >= hourStart && !(retry && now - last >= periodBackoff(failN, o))) { why.push(`${j.label}: 이번 시간에 이미 함`); continue; }
      if (last >= hourStart) { out.push(j); why.push(`${j.label}: 다시 해 봄(${failN}번째 실패 뒤)`); continue; }
      if (now < hourStart + j.at * MIN) { why.push(`${j.label}: 이번 시간 ${String(j.at).padStart(2, "0")}분 뒤`); continue; }
      // 주기: 1시간(기본)은 "한 시간대 한 번"으로 충분 → 표시(minute)에 다시 맞춤. 2시간 같은 긴 주기만 시간 차이로 막음
      if (j.everyMin > 60 && now - last < j.everyMin * MIN) { why.push(`${j.label}: ${j.everyMin}분 주기`); continue; }
      out.push(j);
    }
    if (!out.length) return { go: false, day, st: S, jobs: [], why: why[0] || "할 일 없음" };
    if ((S.n || 0) >= (o.maxPerDay || 20)) return { go: false, day, st: S, jobs: out, why: `오늘 ${S.n}번 요청 (상한)` };
    return { go: true, day, st: S, jobs: out, why: out.map((j) => j.label).join(" + ") };
  }

  // 요청 만들기 (폰 버튼과 같은 salesPush 모양). 한 가지가 본체, 나머지는 덧붙임(also) → 창 하나로 다 읽음
  //  본체 차례: now(오늘 Gross) → setsToday → menuToday. today:1 은 "오늘 중간값"이라는 표시(mis-sales.js가 setNow·menuNow에 둠)
  function periodBundle(now, jobs, src) {
    const day = ymd(now), t = Math.floor(now) || Date.now(), kinds = (Array.isArray(jobs) ? jobs : []).map((j) => j.kind);
    const has = (k) => kinds.indexOf(k) >= 0;
    const setsAt = { from: day, to: day, force: 1, today: 1 };
    const menuAt = { from: day, to: day, force: 1, today: 1 };
    const r = { id: t, at: t, status: "pending", src: src || "pc-hour" };
    const also = {};
    if (has("now")) Object.assign(r, { kind: "now", from: day, to: day });
    else if (has("setsToday")) Object.assign(r, setsAt, { kind: "sets" });
    else Object.assign(r, menuAt, { kind: "menu" });
    if (has("now") && has("setsToday")) also.sets = Object.assign({}, setsAt, { at: t });
    if (has("menuToday") && r.kind !== "menu") also.menu = Object.assign({}, menuAt, { at: t });
    if (Object.keys(also).length) r.also = also;
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

  // 마감 스냅샷 (1.17.0 — 11/17 KM 승인 13번): 매일 21:20에 그날 마지막 값(매출·메뉴·Set·HR·발주 상태)을 한 덩어리로 덤프
  //  시각이 지나 늦게 켜졌으면 그때 한 번(늦게 = late:1). 그날 성공했으면 다시 하지 않음. 21:20~23:59 사이에만
  function snapDue(now, st, o) {
    o = o || {};
    const t = kst(now), hm = t.getUTCHours() * 60 + t.getUTCMinutes(), day = ymd(now);
    const at = o.at == null ? 21 * 60 + 20 : o.at, to = o.to == null ? 23 * 60 + 59 : o.to;
    if (hm < at) return { go: false, day, late: 0, why: `마감 스냅샷은 ${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")} 뒤` };
    if (hm > to) return { go: false, day, late: 0, why: "마감 스냅샷 시간 지남" };
    const S = st || {};
    if (S.day === day && S.okAt) return { go: false, day, late: 0, why: "오늘 마감 스냅샷 이미 함" };
    return { go: true, day, late: hm >= at + 20 ? 1 : 0, why: "마감 스냅샷" };
  }

  G.periodJobs = periodJobs;
  G.periodDue = periodDue;
  G.periodBundle = periodBundle;
  G.periodBlocked = periodBlocked;
  G.periodBackoff = periodBackoff;
  G.periodMaxRetry = MAX_RETRY;
  G.snapDue = snapDue;
})(typeof self !== "undefined" ? self : globalThis);
