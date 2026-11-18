// HR 주간스케쥴 전송 — 배경 쪽 (GW Agent 1.12.0, 11/16 KM)
//  보드(hr-board-teal.vercel.app)의 [전송] → hrsend-board.js → 여기(q "hrSend") → HR 탭에서 hrsStep을 한 단계씩 → 결과를 보드로
//  순서(1.14.1, 11/17 KM: 업로드 안 씀 · 소속구분 안 고름): 검사 → HR 탭 → 주간스케쥴(시간) 소속구분 빈칸(전체) [검색] → 근태 코드 → 메인 표 행에 카드 입력(workType U) → [저장] 한 번 → 다시 읽어 확인
//  mode: test(월요일 1일) · saveOnly(7일 저장까지) · full(+ 공지·확정). 상태 없는 주는 full이면 멈춤(allowInit일 때만 업로드 전에 초기화)
//  안전: 요청 하나씩(requestId 잠금) · 로그인·망이 끊기면 바로 멈춤(자동 로그인 안 함) · 이미 확정된 주는 손대지 않음 · 개인정보(이름)는 기록에 남기지 않음
//  bg.js의 get·put·log·VER를 씀 (bg.js가 importScripts로 불러옴)
const HRS = { budget: 25 * 60e3, site: "5090", board: /^https:\/\/hr-board-teal\.vercel\.app\//, hr: /^https:\/\/hr\.pljec\.cloud\// };
const hrsB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const hrsT = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
async function hrsSend(board, msg) { if (board != null) await chrome.tabs.sendMessage(board, msg).catch(() => {}); }
async function hrsExec(tabId, op, arg, ms) {
  const run = chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: hrsStep, args: [op, arg || {}] }).then((r) => (r && r[0] && r[0].result) || { ok: false, stage: "week", message: "HR 화면에서 결과가 안 돌아왔어요" });
  const to = new Promise((res) => setTimeout(() => res({ ok: false, stage: op === "final" ? "notice" : op === "daySave" ? "save" : /^day/.test(op) ? "upload" : "week", message: `HR 화면 단계(${op})가 ${Math.round(ms / 1000)}초 안에 안 끝났어요`, timeout: true }), ms));
  try { return await Promise.race([run, to]); } catch (e) { return { ok: false, stage: "week", message: "HR 화면에 들어가지 못했어요: " + String((e && e.message) || e).slice(0, 160), code: "inject" }; }
}
async function hrsTabReady(tabId, ms) { // 다 열릴 때까지. 오류 화면(망 끊김)이면 null
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return null;
    const u = t.url || t.pendingUrl || "";
    if (/^chrome-error:/.test(u)) return { tab: t, err: true };
    if (t.status === "complete" && HRS.hr.test(u)) return { tab: t };
    await new Promise((r) => setTimeout(r, 400));
  }
  const t = await chrome.tabs.get(tabId).catch(() => null);
  return t ? { tab: t, slow: true } : null;
}
async function hrsRun(req, board, boardWin) {
  const id = String(req.requestId || "").slice(0, 80), now = Date.now(), trail = []; // (이름 주의: log는 bg.js의 기록 함수)
  const mode = req.mode === "test" ? "test" : "saveOnly"; // 11/16 KM: 부서별 전송은 입력·저장까지만. 공지·확정은 매장 전체라 MFG_HR_PUBLISH로 따로 (예전 "full"은 saveOnly로 받음)
  const savedDays = []; let warnsOut = [];
  const res0 = (o) => Object.assign({ type: "MFG_HR_SEND_RESULT", requestId: id, ok: false, stage: "precheck", day: null, message: "", rowErrors: [], warns: warnsOut, savedDays: savedDays.slice(), noticed: false, confirmed: false, savedEmpNos: [], mode, log: trail }, o);
  const step = async (stage, msg, day, ajax) => { const it = { t: hrsT(), stage, day: day || null, msg: String(msg || "").slice(0, 200) }; if (ajax && ajax.length) it.ajax = ajax.map((x) => `${x.ep} ${x.http}${x.rc != null ? "/" + x.rc : ""}`).join(", "); trail.push(it); await hrsSend(board, { q: "hrSendProgress", requestId: id, item: it }); };
  if (!id) return hrsSend(board, { q: "hrSendResult", res: res0({ message: "requestId가 없어요" }) });
  const { hrSend = {} } = await get("hrSend");
  if (hrSend.last && hrSend.last.id === id) return hrsSend(board, { q: "hrSendResult", res: hrSend.last.res });
  if (hrSend.run && now - hrSend.run.at < HRS.budget) return hrsSend(board, { q: "hrSendResult", res: res0({ stage: "week", message: hrSend.run.id === id ? "같은 전송이 이미 도는 중이에요" : "다른 HR 전송이 도는 중이에요 (끝난 뒤 다시)", busy: true }) });
  const setRun = (o) => put({ hrSend: { last: hrSend.last || null, run: Object.assign({ id, at: now }, o) } });
  await setRun({ stage: "precheck" });
  const alive = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20e3);
  let tabId = null, res = null;
    try {
    // 1) 보내기 전 검사
    const chk = hrsCheck(req);
    if (!chk.ok) { res = res0({ stage: "precheck", message: `보낼 수 없어요: ${chk.errors.length}건 — ${chk.errors.slice(0, 3).map((e) => (e.name || e.empNo || "") + " " + e.msg).join(" / ")}`, rowErrors: chk.errors }); return; }
    const plan = chk.plan, empNos = plan.emps.map((e) => e.empNo);
    warnsOut = chk.warns.map((w) => ({ empNo: w.empNo, name: w.name, day: w.day || null, msg: w.msg }));
    await step("precheck", `${plan.dept} ${plan.weekStart}~${plan.weekEnd} · ${empNos.length}명 · ${mode === "test" ? "시험(월요일만)" : "7일 저장"}${chk.warns.length ? " · 경고 " + chk.warns.length + "건" : ""}`);
    chk.warns.forEach((w) => trail.push({ t: hrsT(), stage: "precheck", day: null, msg: `경고: ${w.name || w.empNo} ${w.msg}` }));
    // 2) HR 탭 (있으면 그 탭, 없으면 보드 창에 새 탭). 화면이 그려져야 해서 앞으로 띄움
    const { hrTab } = await get("hrTab");
    let t = (await chrome.tabs.query({ url: "https://hr.pljec.cloud/*" }).catch(() => [])).filter((x) => x.id !== hrTab)[0];
    if (t) await chrome.tabs.update(t.id, { active: true }).catch(() => {});
    else t = await chrome.tabs.create({ url: "https://hr.pljec.cloud/", active: true, windowId: boardWin != null ? boardWin : undefined }); // own()은 안 씀: 발주 창 정리(sweep)가 이 탭을 닫지 않게
    tabId = t.id; chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
    await setRun({ stage: "week", tab: tabId });
    const rd = await hrsTabReady(tabId, 40e3);
    if (!rd || rd.err) { res = res0({ stage: "week", message: "HR(hr.pljec.cloud)에 접속이 안 돼요 — 회사망(SSL VPN) 연결을 확인해 주세요", code: "network" }); return; }
    let pr = await hrsExec(tabId, "probe", {}, 15e3);
    for (let k = 0; k < 20 && pr.ok && !pr.login && !pr.menu && !pr.screen; k++) { await new Promise((r) => setTimeout(r, 500)); pr = await hrsExec(tabId, "probe", {}, 15e3); }
    if (!pr.ok) { res = res0({ stage: "week", message: pr.message, code: pr.code || "inject" }); return; }
    if (pr.login || (!pr.loggedIn && !pr.menu && !pr.screen)) { res = res0({ stage: "week", message: "HR 로그인이 풀려 있어요 — 이 크롬에서 HR에 로그인한 뒤 다시 전송해 주세요 (자동 로그인은 하지 않음)", code: "login" }); return; }
    let r = await hrsExec(tabId, "open", {}, 50e3);
    if (!r.ok) { res = res0({ stage: "week", message: r.message, code: r.code }); return; }
    // 3) 소속구분은 고르지 않음(빈칸 = 전체: BOH·FOH·STORE가 다 나옴, 11/17 KM) → 한 화면에서 보낸 직원을 모두 찾음
    const sentSet = new Set(empNos);
    { const sv = await hrsExec(tabId, "settle", { ms: 20e3 }, 30e3); if (sv && sv.waited > 1500) await step("week", `HR 화면이 앞 작업(저장·다시 불러오기)을 끝낼 때까지 ${Math.round(sv.waited / 1000)}초 기다림`); }
    r = await hrsExec(tabId, "cond", { dept: "", weekStart: plan.weekStart, weekEnd: plan.weekEnd, site: HRS.site }, 120e3);
    if (!r.ok) { res = res0({ stage: "week", message: r.message }); return; }
    let st = r.status; const week = r.week;
    await step("week", `검색(전체): ${r.week} · 주차 상태 ${st.length ? st.map((x) => x === "EDIT" ? "EDIT(작성 중 · 공지 전)" : x).join(",") : "없음"} — 저장 안 된 변경 여부와는 따로 봄`, null, r.ajax);
    if (st.indexOf("CONFIRM") >= 0) { res = res0({ stage: "week", message: `이미 확정된 주예요 (${week}) — 확정취소는 자동으로 하지 않아요`, code: "confirmed" }); return; }
    if (st.indexOf("NOTICE") >= 0) { res = res0({ stage: "week", message: `공지된 주라 수정할 수 없어요 (${week}) — 공지취소는 자동으로 하지 않아요`, code: "noticed" }); return; }
    if (!st.length && plan.allowInit) { // 상태 없는 주: 이대로 저장하면 공지·확정이 안 켜짐 → allowInit일 때만 저장 전에 [초기화]
      const ini = await hrsExec(tabId, "init", {}, 40e3);
      if (!ini.ok) { res = res0({ stage: "week", message: ini.message, code: "nostatus" }); return; }
      const s2 = await hrsExec(tabId, "status", {}, 40e3); st = s2.status || [];
      await step("week", `초기화: ${ini.toast || "완료"} → 상태 ${st.join(",") || "없음"}`);
      if (st.indexOf("EDIT") < 0) { res = res0({ stage: "week", message: "초기화했는데도 주차 상태가 EDIT가 아니에요", code: "nostatus" }); return; }
    } else if (!st.length) await step("week", "주차 상태 없음 — 저장은 되지만 공지·확정이 안 켜질 수 있어요 (HR에서 초기화·전주복사 또는 allowInit)");
    const m = await hrsExec(tabId, "cardMap", {}, 30e3);
    if (!m.ok) { res = res0({ stage: "week", message: m.message }); return; }
    if (m.dirty) { // (1.17.2) 방금 이 확장이 저장한 행(30분 안, 서버 값 확인함)뿐이면 표시만 지우고 계속. 남의 행이 섞이면 예전처럼 멈춤
      const { hrSaved: ls } = await get("hrSaved"), own = ls && ls.week === plan.weekStart && Date.now() - ls.at < 30 * 60e3 && ls.rows ? ls.rows : null;
      const dr = own ? await hrsExec(tabId, "dropOwn", { own }, 10e3) : { dirty: true, dirtyNos: m.dirtyNos || [] };
      if (dr && dr.dropped) await step("week", `저장 안 된 변경 표시 ${dr.dropped}행은 방금 이 확장이 저장한 행이라 지움(서버 값과 같음)`);
      if (!dr || dr.dirty) { const nos = (dr && dr.dirtyNos) || m.dirtyNos || []; res = res0({ stage: "save", message: `HR 표에 저장 안 된 변경이 ${nos.length || "몇"}행 있어요${nos.length ? " (사번 " + nos.slice(0, 5).join(", ") + (nos.length > 5 ? " 외" : "") + ")" : ""} — 이 확장이 저장한 행이 아니라 누가 화면에서 고치는 중일 수 있어 멈춤. 주차 상태 EDIT(작성 중)와는 다른 것. HR에서 [검색]으로 새로 고친 뒤 다시`, code: "dirty", dirtyNos: nos }); return; }
    }
    const inHr = new Set(m.rows.map((x) => x.empNo));
    const nowhere = empNos.filter((n) => !inHr.has(n)); // 표에 없는 사람은 건너뛰고 보고 (11/17 KM: HR '누락건 추가'로 따로)
    if (nowhere.length) await step("week", `표에 없는 사번 ${nowhere.length}명은 건너뜀: ${nowhere.join(", ")}`);
    // (11/17 KM) 부서 칸으로 "안 보낸 직원"을 가리는 검사는 하지 않음 — 보낸 직원만 넣고, 안 보낸 직원 행은 건드리지 않음
    await step("week", `표 ${m.rows.length}명(전체) · 보낸 ${empNos.length}명 모두 있음`);
    // 4) 근태 코드: 출근 10·휴무 17은 확인됨. 주휴일·공휴일은 표의 근태 칸 드롭다운 목록에서 (보드가 codes로 줄 수도 있음)
    const CODE = { 출근: "10", 휴무: "17", 주휴일: "18" }, need = new Set(); // 11/17 KM 확인: 18 = 주휴일 plan.emps.forEach((e) => e.days.forEach((d) => { if (!CODE[d.kind]) need.add(d.kind); }));
    if (need.size) {
      Object.assign(CODE, req.codes || {});
      if ([...need].some((k) => !CODE[k])) {
        const lc = await hrsExec(tabId, "learnCodes", {}, 30e3);
        (lc.list || []).forEach((x) => { if (/주휴/.test(x.t) && !CODE["주휴일"]) CODE["주휴일"] = x.v; if (/공휴/.test(x.t) && !CODE["공휴일"]) CODE["공휴일"] = x.v; if (/^출근/.test(x.t) && x.v !== "10") trail.push({ t: hrsT(), stage: "week", day: null, msg: `참고: 출근 코드가 ${x.v}로 보임` }); });
        await step("week", `근태 코드표 ${(lc.list || []).length}개 읽음: ${(lc.list || []).map((x) => x.v + "=" + x.t).join(" ").slice(0, 150)}`);
      }
      const unk = [...need].filter((k) => !CODE[k]);
      if (unk.length) { res = res0({ stage: "week", message: `근태 코드를 몰라요: ${unk.join(", ")} — 저장 전에 멈춤`, code: "nocode" }); return; }
    }
    // 5) 바뀐 칸만 카드 입력(d.set) → 그 행 workType 'U' → hrt2325.saveData() → 다시 읽어 확인 (11/17 KM 실제 방식)
    const days = mode === "test" ? ["MON"] : ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const KN = { 출근: "출근", 휴무: "휴무", 주휴일: "주휴일", 공휴일: "공휴일" };
    await setRun({ stage: "save", tab: tabId });
    const emps = plan.emps.filter((e) => inHr.has(e.empNo)).map((e) => ({ empNo: e.empNo, name: e.name, days: e.days.filter((d) => days.indexOf(d.dow) >= 0).map((d) => ({ dow: d.dow, code: CODE[d.kind], kname: KN[d.kind], in: d.in, out: d.out, brk: d.brk })) }));
    const keep = chk.warns.filter((w) => w.keepWeekly).map((w) => w.empNo);
    const { hrSaved: ls2 } = await get("hrSaved"), own2 = ls2 && ls2.week === plan.weekStart && Date.now() - ls2.at < 30 * 60e3 && ls2.rows ? ls2.rows : null;
    r = await hrsExec(tabId, "cardApply", { emps, keep, weekly: CODE["주휴일"], own: own2 }, 90e3);
    if (r && r.code === "dirty") { res = res0({ stage: "save", message: r.message, code: "dirty", dirtyNos: r.dirtyNos || [] }); return; }
    if (r && r.droppedOwn) await step("save", `저장 안 된 변경 표시 ${r.droppedOwn}행은 방금 이 확장이 저장한 행이라 지움(표 값이 저장한 값과 같음)`);
    const extra = { skipped: [...(r.skipped || []), ...nowhere.map((n) => ({ empNo: n, name: (plan.emps.find((e) => e.empNo === n) || {}).name, msg: "표에 없음 — 건너뜀" }))], kept: r.kept || [], locked: r.locked || [], changed: (r.changes || []).length };
    if (!r.ok) { res = res0(Object.assign({ stage: "save", message: `저장: ${r.message}`, code: r.code, rowErrors: (r.notSaved || []).map((x) => ({ empNo: x.empNo, name: x.name, day: x.dow, msg: "저장 뒤 값이 다름 · " + x.msg })) }, extra)); return; }
    await step("save", `바뀐 칸 ${r.applied}개(${r.rowsTouched || 0}명) 입력 → 저장 → 다시 읽어 확인 맞음${extra.kept.length ? ` · 주휴일 유지 ${extra.kept.length}` : ""}${extra.locked.length ? ` · 수정 불가 ${extra.locked.length}` : ""}${extra.skipped.length ? ` · 건너뜀 ${extra.skipped.length}명` : ""}`, null, r.ajax);
    const saved = emps.map((e) => e.empNo).filter((n) => !extra.skipped.some((x) => x.empNo === n));
    await put({ hrSaved: { at: Date.now(), week: plan.weekStart, rows: Object.fromEntries(emps.filter((e) => saved.includes(e.empNo)).map((e) => [e.empNo, Object.fromEntries(e.days.map((d) => [d.dow, { code: d.code, in: d.in || "", out: d.out || "", brk: d.brk || "" }]))])) } }); // (1.17.2) 다음 실행이 이 행들을 '남의 변경'으로 보지 않게
    days.forEach((d) => savedDays.push(d));
    if (mode === "test") { res = res0(Object.assign({ ok: true, stage: "save", day: "MON", message: `시험: 월요일만 넣고 저장했어요 (바뀐 칸 ${extra.changed}개, 공지·확정 안 함)`, test: true }, extra)); return; }
    res = res0(Object.assign({ ok: true, stage: "save", message: `${plan.dept} 7일 저장까지 했어요 (${saved.length}명 · 바뀐 칸 ${extra.changed}개${extra.kept.length || extra.skipped.length || extra.locked.length ? " · 확인 필요 있음" : ""}). 공지·확정은 BOH·FOH 모두 저장된 뒤 [공지·확정]으로`, savedEmpNos: saved }, extra));
  } catch (e) {
    res = res0({ stage: "week", message: "확장 오류: " + String((e && e.message) || e).slice(0, 200) });
  } finally {
    clearInterval(alive);
    if (tabId != null) await hrsExec(tabId, "done", {}, 5e3).catch(() => {});
    if (!res) res = res0({ stage: "week", message: "끝까지 못 갔어요" });
    await put({ hrSend: { run: null, last: { id, at: Date.now(), res } } });
    await log(`HR 전송 ${res.ok ? "끝" : "멈춤"}: ${res.mode} · ${res.stage}${res.day ? " · " + res.day : ""} · 저장 ${res.savedDays.length}일 · ${res.stage === "precheck" ? "검사 오류 " + res.rowErrors.length + "건" : String(res.message).replace(/[^\s(]+님/g, "○○님").slice(0, 80)}`, { quiet: true }); // 이름은 안 남김 (HR 문구 "OOO님의 …"도 가림)
    await hrsSend(board, { q: "hrSendResult", res });
    if (board != null) chrome.tabs.update(board, { active: true }).catch(() => {}); // 보드로 돌아감 (HR 탭은 결과 확인용으로 열어 둠)
  }
}

// ---- 공지·확정 (매장 전체, 11/16 KM) ----
//  보드 → { type: "MFG_HR_PUBLISH", requestId, weekStart, weekEnd, action: "notice"|"confirm"|"both", codes? }
//  소속구분 빈칸(전체)으로 한 번 [검색] → 전원 점검(시간 없는 출근 0 · 주휴일 1일 · 52시간) → 걸리면 안 누름 → 같은 화면에서 EDIT면 공지, NOTICE면 확정만
async function hrsPublish(req, board, boardWin) {
  const id = String(req.requestId || "").slice(0, 80), now = Date.now(), trail = [];
  const action = /^(notice|confirm|both)$/.test(req.action) ? req.action : "both";
  const res0 = (o) => Object.assign({ type: "MFG_HR_PUBLISH_RESULT", requestId: id, ok: false, stage: "precheck", message: "", rowErrors: [], noticed: false, confirmed: false, action, log: trail }, o);
  const step = async (stage, msg) => { const it = { t: hrsT(), stage, day: null, msg: String(msg || "").slice(0, 200) }; trail.push(it); await hrsSend(board, { q: "hrSendProgress", requestId: id, item: it }); };
  if (!id) return hrsSend(board, { q: "hrSendResult", res: res0({ message: "requestId가 없어요" }) });
  const ws = String(req.weekStart || ""), we = /^\d{4}-\d\d-\d\d$/.test(ws) ? new Date(Date.parse(ws + "T00:00:00Z") + 6 * 864e5).toISOString().slice(0, 10) : "";
  if (!we || new Date(Date.parse(ws + "T00:00:00Z")).getUTCDay() !== 1) return hrsSend(board, { q: "hrSendResult", res: res0({ message: `주 시작일(월요일)이 틀려요: ${ws}` }) });
  const { hrSend = {} } = await get("hrSend");
  if (hrSend.last && hrSend.last.id === id) return hrsSend(board, { q: "hrSendResult", res: hrSend.last.res });
  if (hrSend.run && now - hrSend.run.at < HRS.budget) return hrsSend(board, { q: "hrSendResult", res: res0({ stage: "week", message: "다른 HR 전송이 도는 중이에요", busy: true }) });
  await put({ hrSend: { last: hrSend.last || null, run: { id, at: now, stage: "precheck", kind: "publish" } } });
  const alive = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20e3);
  let tabId = null, res = null;
  try {
    const { hrTab } = await get("hrTab");
    let t = (await chrome.tabs.query({ url: "https://hr.pljec.cloud/*" }).catch(() => [])).filter((x) => x.id !== hrTab)[0];
    if (t) await chrome.tabs.update(t.id, { active: true }).catch(() => {});
    else t = await chrome.tabs.create({ url: "https://hr.pljec.cloud/", active: true, windowId: boardWin != null ? boardWin : undefined });
    tabId = t.id; chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
    const rd = await hrsTabReady(tabId, 40e3);
    if (!rd || rd.err) { res = res0({ stage: "week", message: "HR(hr.pljec.cloud)에 접속이 안 돼요 — 회사망(SSL VPN) 확인", code: "network" }); return; }
    let pr = await hrsExec(tabId, "probe", {}, 15e3);
    for (let k = 0; k < 20 && pr.ok && !pr.login && !pr.menu && !pr.screen; k++) { await new Promise((r) => setTimeout(r, 500)); pr = await hrsExec(tabId, "probe", {}, 15e3); }
    if (!pr.ok || pr.login || (!pr.loggedIn && !pr.menu && !pr.screen)) { res = res0({ stage: "week", message: "HR 로그인이 풀려 있어요 — 이 크롬에서 HR에 로그인한 뒤 다시 (자동 로그인 안 함)", code: "login" }); return; }
    let r = await hrsExec(tabId, "open", {}, 50e3);
    if (!r.ok) { res = res0({ stage: "week", message: r.message, code: r.code }); return; }
    // 1) 전체(소속구분 빈칸) 한 번 [검색] → 메인 표 전원(BOH·FOH·STORE) 점검 (11/17 KM: 부서 따로 안 고름)
    await hrsExec(tabId, "settle", { ms: 20e3 }, 30e3); // (1.17.2) 앞 저장·다시 불러오기가 끝난 뒤 검색
    r = await hrsExec(tabId, "cond", { dept: "", weekStart: ws, weekEnd: we, site: HRS.site }, 120e3);
    if (!r.ok) { res = res0({ stage: "precheck", message: "전체 검색: " + r.message }); return; }
    const st0 = r.status, wk0 = r.week;
    const w0 = await hrsExec(tabId, "weekRows", {}, 30e3);
    if (!w0.ok) { res = res0({ stage: "precheck", message: w0.message }); return; }
    const tabs = [{ dept: "전체", rows: w0.rows, labels: w0.labels }];
    await step("precheck", `전체 검색: ${wk0} · ${w0.rows.length}명 · 상태 ${st0.join(",") || "없음"}`);
    // 근태 코드표(주휴일·공휴일): 근태 칸 드롭다운 목록에서 (보드가 codes로 주면 그게 우선)
    const lc = await hrsExec(tabId, "learnCodes", {}, 30e3), over = {};
    (lc.list || []).forEach((x) => { if (/주휴/.test(x.t)) over[x.v] = "주휴일"; else if (/공휴/.test(x.t)) over[x.v] = "공휴일"; else if (/^출근/.test(x.t)) over[x.v] = "출근"; else if (/^휴무/.test(x.t)) over[x.v] = "휴무"; });
    Object.entries(req.codes || {}).forEach(([k, v]) => { over[v] = k; }); // req.codes: { 주휴일: "18" } 모양
    const chk = hrsPublishCheck(tabs, Object.keys(over).length ? over : null);
    await step("precheck", `점검 ${chk.n}명 · 걸린 것 ${chk.errors.length}건 · 코드 ${Object.entries(chk.codes).map(([c, k]) => c + "=" + k).join(" ")}`);
    if (!chk.ok) { res = res0({ stage: "precheck", message: `공지 전 점검에서 ${chk.errors.length}건 — 공지·확정을 누르지 않았어요`, rowErrors: chk.errors.map((e) => ({ empNo: e.empNo, name: e.name, dept: e.dept, day: e.day, msg: e.msg })) }); return; }
    // 2) 같은 전체 화면에서 공지 → 확정 (HR의 validateConfirm은 화면에 불러온 행만 검사)
    const st = st0;
    if (st.indexOf("CONFIRM") >= 0) { res = res0({ ok: true, stage: "confirm", message: `이미 확정된 주예요 (${wk0})`, noticed: true, confirmed: true, already: true }); return; }
    if (!st.length) { res = res0({ stage: "week", message: `주차 상태가 없어요 (${wk0}) — 공지·확정 단추가 안 켜져요. HR에서 초기화·전주복사가 필요해요`, code: "nostatus" }); return; }
    const noticed = st.indexOf("NOTICE") >= 0;
    if (action === "notice" && noticed) { res = res0({ ok: true, stage: "notice", message: "이미 공지된 주예요", noticed: true }); return; }
    if (action === "confirm" && !noticed) { res = res0({ stage: "confirm", message: "아직 공지 전이라 확정할 수 없어요 (공지 먼저)" }); return; }
    await put({ hrSend: { last: hrSend.last || null, run: { id, at: now, stage: "notice", kind: "publish", tab: tabId } } });
    r = await hrsExec(tabId, "final", { skipNotice: noticed, stopBefore: action === "notice" ? "confirm" : null }, 90e3);
    (r.steps || []).forEach((x) => trail.push({ t: hrsT(), stage: x.stage, day: null, msg: x.msg }));
    if (!r.ok) { res = res0({ stage: r.stage || "notice", message: r.message, noticed: noticed || !!r.noticed }); return; }
    res = res0({ ok: true, stage: r.confirmed ? "confirm" : "notice", message: r.confirmed ? `${ws}~${we} 매장 전체 공지·확정 끝 (${chk.n}명)` : `${ws}~${we} 매장 전체 공지 끝 (${chk.n}명)`, noticed: true, confirmed: !!r.confirmed });
  } catch (e) {
    res = res0({ stage: "week", message: "확장 오류: " + String((e && e.message) || e).slice(0, 200) });
  } finally {
    clearInterval(alive);
    if (tabId != null) await hrsExec(tabId, "done", {}, 5e3).catch(() => {});
    if (!res) res = res0({ stage: "week", message: "끝까지 못 갔어요" });
    await put({ hrSend: { run: null, last: { id, at: Date.now(), res } } });
    await log(`HR 공지·확정 ${res.ok ? "끝" : "멈춤"}: ${res.action} · ${res.stage} · ${res.stage === "precheck" ? "점검 " + res.rowErrors.length + "건" : String(res.message).replace(/[^\s(]+님/g, "○○님").slice(0, 80)}`, { quiet: true });
    await hrsSend(board, { q: "hrSendResult", res });
    if (board != null) chrome.tabs.update(board, { active: true }).catch(() => {});
  }
}
// 1.16.0 보드 [HR 현재 값 불러와 비교] → { type: "MFG_HR_READ", requestId, weekStart } — 읽기만 (아무 칸도 안 바꿈)
//  결과 { type: "MFG_HR_READ_RESULT", requestId, ok, message, week, status, rows:[{empNo, name, dept, days:[{dow, kind, code, in, out, brk, edit}]}] }
//  직책(duty_name) 칸은 휴대폰 번호가 같이 있어 읽지 않음
async function hrsRead(req, board, boardWin) {
  const id = String(req.requestId || "").slice(0, 80);
  const res0 = (o) => Object.assign({ type: "MFG_HR_READ_RESULT", requestId: id, ok: false, message: "", week: "", status: [], rows: [] }, o);
  const ws = String(req.weekStart || ""), we = /^\d{4}-\d\d-\d\d$/.test(ws) ? new Date(Date.parse(ws + "T00:00:00Z") + 6 * 864e5).toISOString().slice(0, 10) : "";
  if (!id) return;
  if (!we || new Date(Date.parse(ws + "T00:00:00Z")).getUTCDay() !== 1) return hrsSend(board, { q: "hrSendResult", res: res0({ message: `주 시작일(월요일)이 틀려요: ${ws}` }) });
  const { hrSend = {} } = await get("hrSend");
  if (hrSend.run && Date.now() - hrSend.run.at < HRS.budget) return hrsSend(board, { q: "hrSendResult", res: res0({ message: "HR 전송이 도는 중이에요 (끝난 뒤 다시)", busy: true }) });
  let tabId = null, res = null;
  try {
    const { hrTab } = await get("hrTab");
    let t = (await chrome.tabs.query({ url: "https://hr.pljec.cloud/*" }).catch(() => [])).filter((x) => x.id !== hrTab)[0];
    if (t) await chrome.tabs.update(t.id, { active: true }).catch(() => {});
    else t = await chrome.tabs.create({ url: "https://hr.pljec.cloud/", active: true, windowId: boardWin != null ? boardWin : undefined });
    tabId = t.id;
    const rd = await hrsTabReady(tabId, 40e3);
    if (!rd || rd.err) { res = res0({ message: "HR(hr.pljec.cloud)에 접속이 안 돼요 — 회사망(SSL VPN) 확인", code: "network" }); return; }
    let pr = await hrsExec(tabId, "probe", {}, 15e3);
    for (let k = 0; k < 20 && pr.ok && !pr.login && !pr.menu && !pr.screen; k++) { await new Promise((r) => setTimeout(r, 500)); pr = await hrsExec(tabId, "probe", {}, 15e3); }
    if (!pr.ok || pr.login || (!pr.loggedIn && !pr.menu && !pr.screen)) { res = res0({ message: "HR 로그인이 풀려 있어요 — 이 크롬에서 HR에 로그인한 뒤 다시 (자동 로그인 안 함)", code: "login" }); return; }
    let r = await hrsExec(tabId, "open", {}, 50e3);
    if (!r.ok) { res = res0({ message: r.message, code: r.code }); return; }
    await hrsExec(tabId, "settle", { ms: 20e3 }, 30e3); // (1.17.2) 앞 저장·다시 불러오기가 끝난 뒤 검색
    r = await hrsExec(tabId, "cond", { dept: "", weekStart: ws, weekEnd: we, site: HRS.site }, 120e3);
    if (!r.ok) { res = res0({ message: "전체 검색: " + r.message }); return; }
    const status = r.status || [], week = r.week || "";
    const w = await hrsExec(tabId, "weekRows", {}, 30e3);
    if (!w.ok) { res = res0({ message: w.message, week, status }); return; }
    const KIND = { 10: "출근", 17: "휴무", 18: "주휴일" };
    const kindOf = (d) => KIND[d.code] || (/주휴/.test(d.kname) ? "주휴일" : /공휴/.test(d.kname) ? "공휴일" : /휴무/.test(d.kname) ? "휴무" : /출근/.test(d.kname) ? "출근" : (w.labels || {})[d.code] || d.kname || (d.code ? "코드 " + d.code : ""));
    const T = (x) => { const m = /^(\d{1,2}):?(\d{2})$/.exec(String(x || "").trim()); return m ? m[1].padStart(2, "0") + ":" + m[2] : ""; };
    const rows = w.rows.map((x) => ({ empNo: x.empNo, name: x.name, dept: x.dept, days: x.days.map((d) => ({ dow: d.dow, kind: kindOf(d), code: d.code, in: T(d.in), out: T(d.out), brk: T(d.brk), edit: d.edit === "N" ? "N" : "Y" })) }));
    res = res0({ ok: true, message: `${week} · ${rows.length}명 읽음`, week, status, rows });
  } catch (e) {
    res = res0({ message: "확장 오류: " + String((e && e.message) || e).slice(0, 200) });
  } finally {
    if (tabId != null) await hrsExec(tabId, "done", {}, 5e3).catch(() => {});
    if (!res) res = res0({ message: "끝까지 못 갔어요" });
    await log(`HR 읽기 ${res.ok ? "끝" : "멈춤"}: ${res.ok ? res.rows.length + "명" : String(res.message).replace(/[^\s(]+님/g, "○○님").slice(0, 80)}`, { quiet: true });
    await hrsSend(board, { q: "hrSendResult", res });
    if (board != null) chrome.tabs.update(board, { active: true }).catch(() => {});
  }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || (m.q !== "hrSend" && m.q !== "hrSendLast" && m.q !== "hrPublish" && m.q !== "hrRead")) return false;
  const t = sender.tab;
  if (!t || !HRS.board.test(t.url || "")) { reply({ ok: false, error: "보드 화면에서만 보낼 수 있어요" }); return false; }
  if (m.q === "hrSendLast") { get("hrSend").then(({ hrSend = {} }) => reply({ ok: true, run: hrSend.run ? { id: hrSend.run.id, stage: hrSend.run.stage, day: hrSend.run.day || null, at: hrSend.run.at } : null, last: hrSend.last && hrSend.last.id === m.requestId ? hrSend.last.res : null })); return true; }
  reply({ ok: true, accepted: true, ver: VER });
  if (m.q === "hrRead") hrsRead(m.req || {}, t.id, t.windowId); else if (m.q === "hrPublish") hrsPublish(m.req || {}, t.id, t.windowId); else hrsRun(m.req || {}, t.id, t.windowId);
  return false;
});
