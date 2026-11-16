// HR 주간스케쥴 전송 — 배경 쪽 (GW Agent 1.12.0, 11/16 KM)
//  보드(hr-board-teal.vercel.app)의 [전송] → hrsend-board.js → 여기(q "hrSend") → HR 탭에서 hrsStep을 한 단계씩 → 결과를 보드로
//  순서: 검사(hrsCheck) → HR 탭 → 주간스케쥴(시간) → 소속구분·주차 → 검색·상태 → 월~일 [탭 로딩 → 엑셀 → 행 검증 → 팝업 저장] → 메인 저장 → 공지 → 확정
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
  const mode = req.mode === "test" || req.mode === "saveOnly" ? req.mode : "full";
  const savedDays = [];
  const res0 = (o) => Object.assign({ type: "MFG_HR_SEND_RESULT", requestId: id, ok: false, stage: "precheck", day: null, message: "", rowErrors: [], savedDays: savedDays.slice(), noticed: false, confirmed: false, savedEmpNos: [], mode, log: trail }, o);
  const step = async (stage, msg, day, ajax) => { const it = { t: hrsT(), stage, day: day || null, msg: String(msg || "").slice(0, 200) }; if (ajax && ajax.length) it.ajax = ajax.map((x) => `${x.ep} ${x.http}${x.rc != null ? "/" + x.rc : ""}`).join(", "); trail.push(it); await hrsSend(board, { q: "hrSendProgress", requestId: id, item: it }); };
  if (!id) return hrsSend(board, { q: "hrSendResult", res: res0({ message: "requestId가 없어요" }) });
  const { hrSend = {} } = await get("hrSend");
  if (hrSend.last && hrSend.last.id === id) return hrsSend(board, { q: "hrSendResult", res: hrSend.last.res });
  if (hrSend.run && now - hrSend.run.at < HRS.budget) return hrsSend(board, { q: "hrSendResult", res: res0({ stage: "week", message: hrSend.run.id === id ? "같은 전송이 이미 도는 중이에요" : "다른 HR 전송이 도는 중이에요 (끝난 뒤 다시)", busy: true }) });
  const setRun = (o) => put({ hrSend: { last: hrSend.last || null, run: Object.assign({ id, at: now }, o) } });
  await setRun({ stage: "precheck" });
  const alive = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20e3);
  let tabId = null, res = null;
  const D = 60e3; // 업로드·검증·저장 단계 하나의 한도 (저장 뒤 메인 표 재조회 30초 포함)
  try {
    // 1) 보내기 전 검사
    const chk = hrsCheck(req);
    if (!chk.ok) { res = res0({ stage: "precheck", message: `보낼 수 없어요: ${chk.errors.length}건 — ${chk.errors.slice(0, 3).map((e) => (e.name || e.empNo || "") + " " + e.msg).join(" / ")}`, rowErrors: chk.errors }); return; }
    const plan = chk.plan, files = hrsFiles(plan), empNos = plan.emps.map((e) => e.empNo);
    await step("precheck", `${plan.dept} ${plan.weekStart}~${plan.weekEnd} · ${empNos.length}명 · ${mode === "test" ? "시험(월요일 1일)" : mode === "saveOnly" ? "7일 저장까지" : "7일 + 공지·확정"}${chk.warns.length ? " · 경고 " + chk.warns.length + "건" : ""}`);
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
    r = await hrsExec(tabId, "cond", { dept: plan.dept, weekStart: plan.weekStart, weekEnd: plan.weekEnd, site: HRS.site }, 120e3);
    if (!r.ok) { res = res0({ stage: "week", message: r.message }); return; }
    let st = r.status;
    await step("week", `검색: ${r.dept} · ${r.week} · 상태 ${st.join(",") || "없음"}`, null, r.ajax);
    // HR에 있는데 보낸 명단에 없는 직원(신규 입사자 등): 메인 표 기준, 업로드 전에 멈춤. 메인 표가 0행(완전히 빈 주)이면 건너뜀
    const mainEmp = r.mainEmp;
    if (Array.isArray(mainEmp) && mainEmp.length) { const sentSet = new Set(empNos), missing = mainEmp.filter((x) => !sentSet.has(x)); if (missing.length) { res = res0({ stage: "week", message: `HR 메인 표에 있는데 보낸 명단에 없는 직원 ${missing.length}명이 있어요(신규 입사자 등) — 업로드 전에 멈춤`, missing }); return; } }
    await step("week", `메인 표 직원 ${mainEmp == null ? "모름" : mainEmp.length + "명"} · 보낸 ${empNos.length}명`);
    if (st.indexOf("CONFIRM") >= 0) { res = res0({ stage: "week", message: `이미 확정된 주예요 (${r.week}) — 확정취소는 자동으로 하지 않아요`, code: "confirmed" }); return; }
    if (st.indexOf("NOTICE") >= 0) { res = res0({ stage: "week", message: `공지된 주라 수정할 수 없어요 (${r.week}) — 공지취소는 자동으로 하지 않아요`, code: "noticed" }); return; }
    if (!st.length && mode === "full") {
      if (!plan.allowInit) { res = res0({ stage: "week", message: `주차 상태가 없어요 (${r.week}) — 이대로 저장하면 공지·확정이 안 켜져요. HR에서 초기화나 전주복사를 하거나, allowInit으로 다시 보내 주세요`, code: "nostatus" }); return; }
      const ini = await hrsExec(tabId, "init", {}, 40e3);
      if (!ini.ok) { res = res0({ stage: "week", message: ini.message, code: "nostatus" }); return; }
      const s2 = await hrsExec(tabId, "status", {}, 40e3);
      st = s2.status || [];
      await step("week", `초기화: ${ini.toast || "완료"} → 상태 ${st.join(",") || "없음"}`);
      if (st.indexOf("EDIT") < 0) { res = res0({ stage: "week", message: "초기화했는데도 주차 상태가 EDIT가 아니에요", code: "nostatus" }); return; }
    }
    // 3) 요일마다: 탭 로딩 → 업로드 → 행 검증 → 팝업 저장
    for (const f of files) {
      await setRun({ stage: "upload", tab: tabId, day: f.dow });
      r = await hrsExec(tabId, "dayOpen", { dow: f.dow, prevSaved: savedDays.length === files.indexOf(f) }, 220e3); // 첫 로딩 60초 + 요일 전환 30초 × 3번 + 정리 // 앞 요일이 다 저장됐을 때만 "수정중인 데이터" 확인창에 예
      if (!r.ok) { res = res0({ stage: "upload", day: f.dow, message: `${f.dow}(${f.date.slice(5)}) ${r.message}` }); return; }
      const before = r.before, rows0 = r.rows0;
      r = await hrsExec(tabId, "dayUpload", { b64: hrsB64(f.bytes), name: f.name }, D);
      if (!r.ok) { res = res0({ stage: "upload", day: f.dow, message: `${f.dow}(${f.date.slice(5)}) ${r.message}` }); return; }
      r = await hrsExec(tabId, "dayCheck", { dow: f.dow, rows: f.rows }, D);
      if (!r.ok) { res = res0({ stage: "upload", day: f.dow, message: `${f.dow}(${f.date.slice(5)}) ${r.message}`, rowErrors: (r.rowErrors || []).map((e) => ({ empNo: e.empNo, name: e.name, day: f.dow, msg: e.msg })), missing: r.missing || [] }); return; }
      r = await hrsExec(tabId, "daySave", {}, D);
      if (!r.ok) { res = res0({ stage: "save", day: f.dow, message: `${f.dow}(${f.date.slice(5)}) ${r.message}` }); return; }
      savedDays.push(f.dow);
      await step("save", `${f.dow} ${f.date.slice(5)} 업로드·검증 ${rows0}→${f.rows.length}행·저장: ${r.toast}`, f.dow, r.ajax);
    }
    if (mode === "test") { res = res0({ ok: true, stage: "save", day: "MON", message: "시험: 월요일 1일 업로드·검증·팝업 저장까지 했어요 (공지·확정 안 함)", test: true }); return; }
    if (mode === "saveOnly") { res = res0({ ok: true, stage: "save", message: `7일 저장까지 했어요 (공지·확정 안 함, ${empNos.length}명)`, savedEmpNos: empNos }); return; }
    // 4) 메인 저장(켜져 있을 때만) → 공지 → 확정
    await setRun({ stage: "notice", tab: tabId });
    r = await hrsExec(tabId, "final", {}, 90e3);
    (r.steps || []).forEach((x) => trail.push({ t: hrsT(), stage: x.stage, day: null, msg: x.msg }));
    if (!r.ok) { res = res0({ stage: r.stage || "notice", message: r.message, savedEmpNos: empNos, noticed: !!r.noticed }); return; }
    res = res0({ ok: true, stage: "confirm", message: `${plan.dept} ${plan.weekStart}~${plan.weekEnd} 저장·공지·확정까지 끝났어요 (${empNos.length}명)`, savedEmpNos: empNos, noticed: true, confirmed: true });
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
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || (m.q !== "hrSend" && m.q !== "hrSendLast")) return false;
  const t = sender.tab;
  if (!t || !HRS.board.test(t.url || "")) { reply({ ok: false, error: "보드 화면에서만 보낼 수 있어요" }); return false; }
  if (m.q === "hrSendLast") { get("hrSend").then(({ hrSend = {} }) => reply({ ok: true, run: hrSend.run ? { id: hrSend.run.id, stage: hrSend.run.stage, day: hrSend.run.day || null, at: hrSend.run.at } : null, last: hrSend.last && hrSend.last.id === m.requestId ? hrSend.last.res : null })); return true; }
  reply({ ok: true, accepted: true, ver: VER });
  hrsRun(m.req || {}, t.id, t.windowId);
  return false;
});
