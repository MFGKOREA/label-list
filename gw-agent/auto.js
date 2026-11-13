// 상시 수집 판단 (1.8.0): "지금 매장 PC가 스스로 받아 올 것이 있나"를 정함
//  화면·저장소·네트워크를 건드리지 않는 순수 함수 → 확장(bg.js)과 시험(node)이 같은 코드를 씀
//  규칙은 order-src/auto/collect.py(클라우드 쪽)와 같음. 한쪽을 고치면 다른 쪽도 고칠 것 (시험: order-src/test/gw/auto.test.mjs)
//  d = 시트 전체, now = 지금(ms), plan = gw-plan.json(더 받아 올 것 목록), o = { pc: 확장에서 부름, days: 며칠 전까지, forceTime }
//  결과: { act: "none" | "skip" | "bad" | "request", why, label, make(t, re) → salesPush에 적을 요청 }
(function (G) {
  const MIN = 60e3, DAY = 86400e3;
  const kst = (ms) => new Date(ms + 9 * 3600e3); // 한국 시각을 UTC 칸으로 읽음 (PC 시계가 어디에 맞춰져 있든 같게)
  const ymd = (ms) => kst(ms).toISOString().slice(0, 10);
  const addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  function autoPlan(d, now, plan, o) {
    o = o || {}; d = d || {};
    const T = ymd(now), Y = addDay(T, -1), fc = d.forecast || {}, rows = ((d["master.order"] || {}).rows) || [];
    // 시트가 비었거나 다른 시트로 바뀐 것 같으면 아무것도 안 함 (11/8·11/9: 빈 새 시트에 쓴 사고)
    if (rows.length < 50 || Object.keys(fc).length < 30 || Object.keys(d).length < 30) return { act: "bad", why: "시트 비정상 → 아무것도 쓰지 않음" };
    const span = []; for (let i = o.days || 7; i >= 1; i--) span.push(addDay(T, -i));
    const hasAct = (x) => !["", "0"].includes(String((fc[x] || {}).act == null ? "" : (fc[x] || {}).act).trim());
    const missG = span.filter((x) => !hasAct(x)), missM = span.filter((x) => !(("menuDay." + x) in d));
    const sp = d.salesPush || {}, ag = d.misAgent || {}, mp = d.misPush || {}, parts = sp.parts || {}, kind = sp.kind || "gross";
    const t5 = Date.parse(T + "T05:00:00+09:00");
    const partOf = (k) => parts[k] || (kind === k && !sp.parts ? { status: sp.status, doneAt: sp.doneAt } : null);
    const rngOf = (k) => (kind === k ? sp : (sp.also || {})[k] || sp); // 끝난 기록에는 also가 안 남음 → 같은 요청의 to로 봄
    // 오늘(05시 뒤) 어제까지를 이미 받아 봤으면 다시 안 함: 남은 빈 날은 휴무이거나 MIS에 아직 없는 것
    const tried = (k) => { const p = partOf(k); return !!(p && p.status === "done" && (p.doneAt || 0) > t5 && (rngOf(k).to || "") >= Y); };
    const triedAny = (k) => { const p = partOf(k); return !!(p && /done|error/.test(p.status || "") && (p.doneAt || 0) > t5); };
    // 계획에 있는 일: 결과 칸(key)이 아직 없고 오늘 안 해 본 것 (하루 한 번만 해 봄)
    const jobDue = (j) => { const have = d[String(j.key).replace("{Y}", Y)]; if (!have) return true; if (j.freshDays) { const at = have.to ? Date.parse(have.to + "T00:00:00Z") : have.at || 0; return now - at > j.freshDays * DAY; } return false; }; // 키가 없거나(처음) freshDays보다 오래됐으면 다시
    const jobs = (Array.isArray(plan) ? plan : []).filter((j) => j && /^[a-z]{2,12}$/.test(j.kind || "") && !/^(gross|menu|now)$/.test(j.kind) && j.key && jobDue(j) && !triedAny(j.kind))
      .filter((j, i, a) => a.findIndex((x) => x.kind === j.kind) === i);
    const wantG = missG.length > 0 && !tried("gross"), wantM = missM.length > 0 && !tried("menu");
    if (!wantG && !wantM && !jobs.length) return { act: "none", why: missG.length || missM.length ? "오늘 이미 받아 봄 (남은 빈 날은 휴무이거나 MIS에 없음)" : "최신" };
    const skip = (why) => ({ act: "skip", why });
    const alive = !!ag.at && now - ag.at < (ag.mode === "ondemand" ? 20 * MIN : 3 * MIN), age = now - (sp.at || 0);
    if ((sp.status === "running" && now - (sp.startAt || sp.at || 0) < 14 * MIN) || (sp.status === "pending" && age < (alive || o.pc ? 6 * MIN : 18 * 60 * MIN))) return skip("다른 매출 요청이 도는 중");
    if ((/^(pending|running)$/.test(mp.status || "") && now - (mp.at || 0) < 20 * MIN) || (!o.pc && ag.job && now - (ag.at || 0) < 3 * MIN)) return skip("발주 전송 중");
    const k = kst(now), hm = k.getUTCHours() * 60 + k.getUTCMinutes();
    if (!o.forceTime && hm >= 12 * 60 + 30 && hm <= 14 * 60 + 45) return skip("발주 시간대(12:30~14:45)에는 창을 띄우지 않음");
    if (o.pc && !o.forceTime && (hm < 6 * 60 || hm > 23 * 60 + 30)) return skip("밤에는 쉼");
    if (!o.pc && !alive) return skip("매장 PC가 꺼져 있음");
    // 요청 (앱의 salesFresh와 같은 모양): 매출은 이번 주 월요일~어제(빈 날이 더 앞이면 거기부터), 메뉴는 빈 날부터 어제까지(PC가 이미 있는 날은 건너뜀)
    const mon = addDay(Y, -((new Date(Y + "T00:00:00Z").getUTCDay() + 6) % 7));
    const g = { from: [mon].concat(missG).sort()[0], to: Y }, m = missM.length ? { from: missM[0], to: Y } : null;
    const keep = {}; Object.keys(parts).forEach((x) => { const v = parts[x]; if (v && v.doneAt && now - v.doneAt < 12 * 60 * MIN && !(x === "gross" && wantG) && !(x === "menu" && wantM) && !jobs.some((j) => j.kind === x)) keep[x] = v; });
    const make = (t, re) => {
      t = Math.floor(t || now);
      const r = { id: t, at: t, status: "pending", src: o.pc ? "pc" : "auto" }, also = {}, rest = jobs.slice();
      if (wantG) { Object.assign(r, g); if (wantM) also.menu = Object.assign({}, m, { at: t }); }
      else if (wantM) Object.assign(r, m, { kind: "menu" });
      else { const j = rest.shift(); Object.assign(r, j.args || {}, { kind: j.kind }); }
      rest.forEach((j) => { also[j.kind] = Object.assign({}, j.args || {}, { at: t }); });
      if (Object.keys(also).length) r.also = also;
      if (re) r.re = re;
      if (Object.keys(keep).length) r.parts = keep;
      return r;
    };
    const label = [wantG ? `매출 ${md(g.from)}~${md(g.to)}` : "", wantM ? `메뉴 ${md(m.from)}~${md(m.to)}` : ""].concat(jobs.map((j) => j.label || j.kind)).filter(Boolean).join(" + ");
    return { act: "request", why: label, label, make, missG, missM, jobs: jobs.map((j) => j.kind) };
  }
  G.autoPlan = autoPlan;
})(typeof self !== "undefined" ? self : globalThis);
