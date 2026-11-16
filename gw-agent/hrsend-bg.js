// HR 주간스케쥴 전송 — 배경 쪽 (GW Agent 1.12.0, 11/16 KM)
//  보드(hr-board-teal.vercel.app)의 [전송] → hrsend-board.js → 여기(q "hrSend") → HR 탭에서 hrsStep을 한 단계씩 → 결과를 보드로
//  순서: 검사(hrsCheck) → HR 탭 → 주간스케쥴(시간) → 소속구분·주차 → 검색 → 월~일 [일자별 수정·엑셀·팝업 저장] → 메인 저장 → 공지 → 확정
//  안전: 요청 하나씩(requestId 잠금) · 로그인·망이 끊기면 바로 멈춤(자동 로그인 안 함) · 이미 확정된 주는 손대지 않음 · 개인정보(이름)는 기록에 남기지 않음
//  bg.js의 get·put·log·VER를 씀 (bg.js가 importScripts로 불러옴)
const HRS = { budget: 15 * 60e3, site: "5090", board: /^https:\/\/hr-board-teal\.vercel\.app\//, hr: /^https:\/\/hr\.pljec\.cloud\// };
const hrsB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const hrsT = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
async function hrsSend(board, msg) { if (board != null) await chrome.tabs.sendMessage(board, msg).catch(() => {}); }
async function hrsExec(tabId, op, arg, ms) {
  const run = chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: hrsStep, args: [op, arg || {}] }).then((r) => (r && r[0] && r[0].result) || { ok: false, stage: "open", message: "HR 화면에서 결과가 안 돌아왔어요" });
  const to = new Promise((res) => setTimeout(() => res({ ok: false, stage: op === "final" ? "notice" : op === "day" ? "upload" : "open", message: `HR 화면 단계(${op})가 ${Math.round(ms / 1000)}초 안에 안 끝났어요`, timeout: true }), ms));
  try { return await Promise.race([run, to]); } catch (e) { return { ok: false, stage: "open", message: "HR 화면에 들어가지 못했어요: " + String((e && e.message) || e).slice(0, 160), code: "inject" }; }
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
  const res0 = (o) => Object.assign({ type: "MFG_HR_SEND_RESULT", requestId: id, ok: false, stage: "validate", day: null, message: "", savedEmpNos: [], confirmed: false, mode: req.mode === "test" ? "test" : "full", log: trail }, o);
  const step = async (stage, msg, day) => { const it = { t: hrsT(), stage, day: day || null, msg: String(msg || "").slice(0, 200) }; trail.push(it); await hrsSend(board, { q: "hrSendProgress", requestId: id, item: it }); };
  if (!id) return hrsSend(board, { q: "hrSendResult", res: res0({ message: "requestId가 없어요" }) });
  // 요청 잠금: 하나씩. 같은 requestId를 다시 받으면 지난 결과를 다시 보냄
  const { hrSend = {} } = await get("hrSend");
  if (hrSend.last && hrSend.last.id === id) return hrsSend(board, { q: "hrSendResult", res: hrSend.last.res });
  if (hrSend.run && now - hrSend.run.at < HRS.budget) return hrsSend(board, { q: "hrSendResult", res: res0({ requestId: id, stage: "open", message: hrSend.run.id === id ? "같은 전송이 이미 도는 중이에요" : "다른 HR 전송이 도는 중이에요 (끝난 뒤 다시)", busy: true }) });
  await put({ hrSend: { ...hrSend, run: { id, at: now, stage: "validate" } } });
  const alive = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20e3); // 몇 분 걸리는 동안 배경이 잠들지 않게
  let tabId = null, res = null, opened = false;
  try {
    // 1) 검사
    const chk = hrsCheck(req);
    if (!chk.ok) { res = res0({ stage: "validate", message: `보낼 수 없어요: ${chk.errors.length}건 (${chk.errors.slice(0, 3).map((e) => (e.empNo ? e.empNo + " " : "") + e.msg).join(" / ")})`, errors: chk.errors }); return; }
    const plan = chk.plan, files = hrsFiles(plan), empNos = plan.emps.map((e) => e.empNo);
    await step("validate", `${plan.dept} ${plan.weekStart}~${plan.weekEnd} · ${empNos.length}명 · ${plan.mode === "test" ? "시험(월요일 1일)" : "7일"}${chk.warns.length ? " · 시간 비움 " + chk.warns.length + "건" : ""}`);
    // 2) HR 탭 (있으면 그 탭, 없으면 보드 창에 새 탭). 화면이 그려져야 해서 앞으로 띄움
    const { hrTab } = await get("hrTab");
    const tabs = (await chrome.tabs.query({ url: "https://hr.pljec.cloud/*" }).catch(() => [])).filter((t) => t.id !== hrTab);
    let t = tabs[0];
    if (t) { await chrome.tabs.update(t.id, { active: true }).catch(() => {}); }
    else { t = await chrome.tabs.create({ url: "https://hr.pljec.cloud/", active: true, windowId: boardWin != null ? boardWin : undefined }); opened = true; } // own()은 안 씀: 발주 창 정리(sweep)가 이 탭을 닫지 않게
    tabId = t.id; chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
    await put({ hrSend: { ...hrSend, run: { id, at: now, stage: "open", tab: tabId } } });
    const rd = await hrsTabReady(tabId, 40e3);
    if (!rd || rd.err) { res = res0({ stage: "open", message: "HR(hr.pljec.cloud)에 접속이 안 돼요 — 회사망(SSL VPN) 연결을 확인해 주세요", code: "network" }); return; }
    let pr = await hrsExec(tabId, "probe", {}, 15e3);
    for (let k = 0; k < 20 && pr.ok && !pr.login && !pr.menu && !pr.screen; k++) { await new Promise((r) => setTimeout(r, 500)); pr = await hrsExec(tabId, "probe", {}, 15e3); } // 첫 화면이 그려지길
    if (!pr.ok) { res = res0({ stage: "open", message: pr.message, code: pr.code || "inject" }); return; }
    if (pr.login) { res = res0({ stage: "open", message: "HR 로그인이 풀려 있어요 — 매장 PC에서 HR에 로그인한 뒤 다시 전송해 주세요 (자동 로그인은 하지 않음)", code: "login" }); return; }
    if (!pr.menu && !pr.screen) { res = res0({ stage: "open", message: "HR 첫 화면에 메뉴가 안 보여요 (로그인 상태 확인)", code: "login" }); return; }
    await step("open", "HR 접속 확인");
    let r = await hrsExec(tabId, "open", {}, 60e3);
    if (!r.ok) { res = res0({ stage: "open", message: r.message, code: r.code }); return; }
    await step("open", "주간스케쥴(시간) 화면");
    r = await hrsExec(tabId, "cond", { dept: plan.dept, weekStart: plan.weekStart, weekEnd: plan.weekEnd, site: HRS.site }, 120e3);
    if (!r.ok) { res = res0({ stage: "open", message: r.message }); return; }
    await step("open", `검색: ${r.dept} · ${r.week} · 상태 ${r.status.join(",") || "모름"}${r.hrEmp ? " · HR 직원 " + r.hrEmp.length + "명" : ""}`);
    if (r.status.indexOf("CONFIRM") >= 0) { res = res0({ stage: "open", message: `이미 확정된 주예요 (${r.week}) — 확정취소는 자동으로 하지 않아요`, code: "confirmed" }); return; }
    // 3) 요일별 업로드·팝업 저장
    const extra = new Set();
    for (const f of files) {
      await put({ hrSend: { ...hrSend, run: { id, at: now, stage: "upload", tab: tabId, day: f.dow } } });
      r = await hrsExec(tabId, "day", { dow: f.dow, date: f.date, name: f.name, b64: hrsB64(f.bytes), empNos: f.empNos }, 120e3);
      if (!r.ok) { res = res0({ stage: r.stage || "upload", day: f.dow, message: `${f.dow}(${f.date.slice(5)}) ${r.message}`, notInHr: r.notInHr }); return; }
      (r.notInFile || []).forEach((x) => extra.add(x));
      await step("save", `${f.dow} ${f.date.slice(5)} 업로드·저장: ${r.toast}${r.rows != null ? " (" + r.rows + "행)" : ""}`, f.dow);
    }
    if (plan.mode === "test") { res = res0({ ok: true, stage: "save", day: "MON", message: "시험: 월요일 1일 업로드·팝업 저장까지 했어요 (공지·확정은 안 함)", test: true }); return; }
    if (extra.size) { res = res0({ stage: "notice", message: `HR엔 있는데 보낸 파일에 없는 직원이 있어 공지 전에 멈췄어요: 사번 ${[...extra].join(", ")}`, savedEmpNos: empNos, notInFile: [...extra] }); return; }
    // 4) 메인 저장 → 공지 → 확정
    await put({ hrSend: { ...hrSend, run: { id, at: now, stage: "notice", tab: tabId } } });
    r = await hrsExec(tabId, "final", {}, 180e3);
    (r.steps || []).forEach((s) => trail.push({ t: hrsT(), stage: s.stage, day: null, msg: s.toast }));
    if (!r.ok) { res = res0({ stage: r.stage || "notice", message: r.message, savedEmpNos: empNos }); return; }
    res = res0({ ok: true, stage: "confirm", message: `${plan.dept} ${plan.weekStart}~${plan.weekEnd} 저장·공지·확정까지 끝났어요 (${empNos.length}명)`, savedEmpNos: empNos, confirmed: true });
  } catch (e) {
    res = res0({ stage: "open", message: "확장 오류: " + String((e && e.message) || e).slice(0, 200) });
  } finally {
    clearInterval(alive);
    if (tabId != null) await hrsExec(tabId, "done", {}, 5e3).catch(() => {});
    if (!res) res = res0({ stage: "open", message: "끝까지 못 갔어요" });
    await put({ hrSend: { run: null, last: { id, at: Date.now(), res } } });
    await log(`HR 전송 ${res.ok ? "끝" : "멈춤"}: ${res.mode} · ${res.stage}${res.day ? " · " + res.day : ""} · ${String(res.message).replace(/[^\s(]+님/g, "○○님").slice(0, 80)}`, { quiet: true }); // 이름은 안 남김 (HR 문구 "OOO님의 …"도 가림)
    await hrsSend(board, { q: "hrSendResult", res });
    if (board != null) chrome.tabs.update(board, { active: true }).catch(() => {}); // 보드로 돌아감 (HR 탭은 열어 둠: 결과 확인용)
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
