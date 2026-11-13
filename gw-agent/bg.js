// 배경 (1.8.0 — 11/13 KM "크롬이 켜져 있으면 상시 연동": 폰에서 누르지 않아도 PC가 스스로 어제 매출·메뉴 판매와 계획(gw-plan.json)에 있는 것을 받아 옴 → 아래 "상시 수집")
//  1.8.0 원칙: 비밀번호를 다루는 이 확장은 얇게 두고 다시 깔 일을 없앰. 무엇을 받을지(gw-plan.json)와 어떻게 읽을지(mis-sales.js)는 GitHub Pages에서 받아 와 스스로 늘어남
// (1.7.3 — 11/12: 매출 요청은 6시간까지 받고, 새 매출 요청이 오면 옛 창을 바로 닫고, 오류를 적을 때 다른 칸을 안 지움 / 1.7.2 — 11/12: 자동 창을 최소화하지 않고 작은 창으로 맨 위에. 아래에 깔리면 크롬이 느리게 돌려 멈췄음 / 1.7.1, 11/11 — 1.7.0이 "MIS 새 탭을 자동 탭으로"에서 6분 멈추던 문제)
//  1.7.0 그대로: 평소엔 창 없음. 폰에서 [GW 전송]·[Gross 불러오기]를 누르면 그때 최소화된 창 하나만 열어 GW 로그인 → 경영정보 → MIS → 입력·저장 → 창 닫음.
//               한 번 누른 요청은 한 번만 시도. 매장 시간(08~22시)엔 3초마다, 그 밖엔 30초마다 전송 상태만 확인.
//  1.7.1 고친 것
//   ① 작업 기록(job)을 읽고-고쳐-쓰는 곳을 한 줄로 세움(lock). 예전엔 기록 쓰기(log)와 새 탭 넘겨받기(adopt)가 겹치면
//      새 MIS 탭이 작업 탭 목록에서 빠졌고, MIS 탭의 start.js가 "내 탭 아님"으로 조용히 끝나 6분을 그냥 기다림.
//   ② 새 탭은 주소가 MIS일 때만 MIS 탭으로 침(공지 새 창은 딸린 탭으로만 기억). GW 탭은 5초 뒤가 아니라 주문등록 화면이 뜬 뒤에 닫음.
//   ③ 단계(stage)마다 시간 제한과 다시 하기: GW 화면(gw) → MIS 탭 열림(open) → 주문등록 화면(mis) → 전송 받음(start) → 입력(run).
//      3초마다 탭 상태를 직접 살펴(probe) 스크립트가 안 돌았으면 다시 넣고, 새 탭이 안 생기면 경영정보를 다시 누르고, 그래도 없으면 MIS 주소를 직접 엶.
//   ④ 안 되면 6분을 기다리지 않고 바로 misPush를 error로 올림. 글에 "멈춘 곳"과 "무엇을 기다리다 멈췄는지"를 적음(주소는 GW·MIS 구분만, 아이디·비밀번호·주소 뒤 값은 안 적음).
importScripts("common.js", "auto.js");
const get = (k) => chrome.storage.local.get(k);
const put = (o) => chrome.storage.local.set(o);
const VER = chrome.runtime.getManifest().version;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const busyHours = (d = new Date()) => { const h = d.getHours() + d.getMinutes() / 60; return h >= 8 && h < 22; };
const GWMIS = /^https:\/\/(gw|mis)\.madforgarlic\.com/;
const isMis = (u) => /^https:\/\/mis\.madforgarlic\.com/.test(u || "");
const isGw = (u) => /^https:\/\/gw\.madforgarlic\.com/.test(u || "");
// 전체: 로그인~주문등록까지 6분, 입력 시작 뒤엔 12분 (1.7.0과 같음 · 마지막 안전망)
// 단계: gw = GW 창 열림~경영정보 누름(로그인하면 다시 셈), open = 누른 뒤 MIS 탭이 생길 때까지(한 번에), mis = MIS 탭~주문등록 화면, start = 자동 대기 켜짐~전송 받음
const LIMIT = { order: 6 * 60e3, orderRun: 12 * 60e3, sales: 12 * 60e3, gw: 75e3, open: 14e3, mis: 100e3, start: 60e3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, fallback) => Promise.race([p, sleep(ms).then(() => fallback)]);
const netGet = async (url, ms = 15e3) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { return await (await fetch(url, { signal: c.signal })).json(); } finally { clearTimeout(t); } };
const post = (key, value) => { const c = new AbortController(), t = setTimeout(() => c.abort(), 25e3); return fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key, value }), signal: c.signal }).catch(() => {}).finally(() => clearTimeout(t)); };
// 바뀐 칸만 보냄 (1.7.3): 매출 요청(salesPush)에 오류를 적을 때 종류·기간·먼저 끝난 결과(parts)를 지우지 않게
const postMerge = (key, patch) => { const c = new AbortController(), t = setTimeout(() => c.abort(), 25e3); return fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "merge", key, patch }), signal: c.signal }).catch(() => {}).finally(() => clearTimeout(t)); };
// 쓰고 응답(ok)까지 확인 (상시 수집의 요청은 적힌 걸 확인해야 다음으로 감)
const postOk = async (key, value) => { const c = new AbortController(), t = setTimeout(() => c.abort(), 25e3); try { const j = await (await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key, value }), signal: c.signal })).json(); return !!(j && j.ok); } catch (e) { return false; } finally { clearTimeout(t); } };
const readStatus = async () => { const v = await netGet(API + "?api=1&status=1&t=" + Date.now()); return (v && (v.status || v.data)) || {}; };

// ---- 저장소 읽고-고쳐-쓰기를 한 줄로 (겹쳐 쓰면 나중 것이 앞의 것을 지움) ----
let q = Promise.resolve();
const lock = (fn) => { const r = q.then(fn); q = r.catch(() => {}); return r; }; // 주의: lock 안에서 lock·log·mutJob을 부르지 않음
const mutJob = (fn) => lock(async () => { const { job } = await get("job"); if (!job) return null; job.n = job.n || {}; job.extra = job.extra || []; if ((await fn(job)) === false) return job; await put({ job }); return job; });
const beat = (job) => post("misAgent", { at: Date.now(), mode: "ondemand", ver: VER, job: job.kind, step: job.step + (job.wait ? " · " + job.wait : ""), stepAt: Date.now(), stage: job.stage || "" });
// 기록. o.quiet: 확장 기록에만(폰에 보이는 단계 글은 그대로) · o.set(job): 같은 순간에 job에 같이 적을 것 (true를 돌려주면 이것도 조용히)
async function log(msg, o = {}) {
  let j = null;
  await lock(async () => {
    const { logs = [], job } = await get(["logs", "job"]);
    logs.unshift(`${new Date().toLocaleString("ko-KR")} ${msg}`);
    const w = { logs: logs.slice(0, 60) };
    if (job && job.kind !== "manual") { job.n = job.n || {}; job.extra = job.extra || []; const hush = (o.set && o.set(job) === true) || o.quiet; if (!hush) { job.step = msg; job.wait = ""; j = job; } w.job = job; }
    await put(w);
  });
  if (j) beat(j); // 작업 중이면 지금 단계를 폰에 보이게 (misAgent.step)
}
let waitBeatAt = 0;
async function noteWait(txt) { // 지금 무엇을 기다리는지 (바뀔 때만 적고, 폰에는 8초에 한 번까지만)
  let j = null;
  await mutJob((job) => { if (job.wait === txt) return false; job.wait = txt; j = job; });
  if (j && Date.now() - waitBeatAt > 8e3) { waitBeatAt = Date.now(); beat(j); }
}

// ---- 창 관리: 이 확장이 연 탭(job.tabs)과 거기서 딸려 열린 탭(job.extra)만 다룸 ----
async function sweep(reason, all = false) {
  // 자동으로 열었던 탭 기록(owned) + 최소화된 창의 GW·MIS 탭 → 닫음. 사람이 띄워 둔 보통 창은 안 건드림 (지금 작업 탭과 그 탭이 연 탭은 남김)
  //  all: 크롬이 막 켜졌을 때 — 그땐 사람이 쓰던 창이 없으니 되살아난 GW·MIS 탭을 다 닫음
  const { owned = [], job } = await get(["owned", "job"]), keep = new Set(job ? [...(job.tabs || []), ...(job.extra || [])] : []);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const wins = new Map((await chrome.windows.getAll().catch(() => [])).map((w) => [w.id, w]));
  const kill = tabs.filter((t) => !keep.has(t.id) && !keep.has(t.openerTabId) && (owned.includes(t.id) || (GWMIS.test(t.url || t.pendingUrl || "") && (all || (wins.get(t.windowId) || {}).state === "minimized"))));
  for (const t of kill) await chrome.tabs.remove(t.id).catch(() => {});
  await lock(async () => { const { owned: o = [], job: j } = await get(["owned", "job"]); const k = new Set(j ? [...(j.tabs || []), ...(j.extra || [])] : []); await put({ owned: o.filter((id) => k.has(id)) }); });
  if (kill.length && reason) await log(`${reason} · 남은 자동 창 ${kill.length}개 닫음`, { quiet: true });
}
const own = (tabId) => lock(async () => { const { owned = [] } = await get("owned"); if (!owned.includes(tabId)) await put({ owned: [...owned, tabId].slice(-20) }); });
const WIN_BOX = { width: 520, height: 720, left: 0, top: 0 };
async function tidy(tabId) { // 자동 탭은 늘 최소화: 혼자 있는 창이면 그 창을, 다른 탭과 같이 있으면 따로 떼어 최소화 (탭마다 한 번만 부름)
  const tab = await chrome.tabs.get(tabId).catch(() => null); if (!tab) return;
  chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  const w = await chrome.windows.get(tab.windowId, { populate: true }).catch(() => null);
  // 1.7.2 (11/12 KM): 창이 최소화·다른 창 아래에 있으면 크롬이 그 탭을 느리게 돌려 자동 입력이 멈춤 → 작은 창을 맨 위로
  if (w && w.tabs.length === 1) { await chrome.windows.update(w.id, { state: "normal", focused: true, ...WIN_BOX }).catch(() => {}); }
  else await chrome.windows.create({ tabId, state: "normal", focused: true, ...WIN_BOX }).catch(() => {});
}
async function openJob(kind, id, msg) {
  await sweep();
  const manual = kind === "manual";
  const win = await chrome.windows.create({ url: GW_URL, state: "normal", focused: true, ...(manual ? {} : WIN_BOX) });
  const tab = win.tabs[0], now = Date.now();
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  const before = (await chrome.tabs.query({}).catch(() => [])).map((t) => t.id); // 이때 이미 있던 탭(사람이 띄운 MIS 탭 등)은 나중에도 안 건드림
  await own(tab.id);
  await lock(() => put({ job: { kind, id, openedAt: now, tabs: [tab.id], extra: [], before, gwTab: tab.id, misTab: null, stage: "gw", stageAt: now, n: {}, step: msg, wait: "" } }));
  await log(msg);
  fast();
}
async function endJob(reason) {
  let job = null;
  await lock(async () => { ({ job } = await get("job")); await chrome.storage.local.remove("job"); });
  if (job) for (const id of [...(job.tabs || []), ...(job.extra || [])]) await chrome.tabs.remove(id).catch(() => {});
  await sweep();
  await log(reason);
  const { auto } = await get("auto");
  post("misAgent", { at: Date.now(), mode: "ondemand", ver: VER, auto: auto === false ? 0 : 1 });
}
// 안 되면 바로 폰에 알림: misPush(또는 salesPush)를 error로 올리고 창 닫음. 그새 입력이 시작됐으면 그대로 둠. 시트에 못 닿으면 다음 확인 때 다시
async function fail(job, why) {
  const now = Date.now(), sec = Math.round((now - job.openedAt) / 1000);
  let d; try { d = await readStatus(); } catch (e) { return; }
  const text = `PC 자동입력이 ${sec}초 만에 멈춤 · 멈춘 곳: ${why} → MIS에 직접 넣어 주세요`;
  if (job.kind === "order") {
    const p = d.misPush || {}, same = "o" + p.id === job.id;
    if (same && p.status === "running") return; // 입력 중 → 건드리지 않음
    if (same && p.status === "pending") await post("misPush", { ...p, status: "error", doneAt: now, text });
  } else if (job.kind === "sales") {
    const sp = d.salesPush || {};
    if ("s" + sp.id === job.id && /pending|running/.test(sp.status)) await postMerge("salesPush", { status: "error", doneAt: now, text: `PC가 ${sec}초 만에 멈춤 · 멈춘 곳: ${why}`, cur: null, prog: null });
  }
  return endJob(`안 됨 (${why}) → 창 닫음`);
}

// ---- 탭 살펴보기: 지금 어떤 화면인지 (주소는 GW·MIS 구분만 봄) ----
async function probe(tabId) {
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) return { gone: true };
  const u = tab.url || tab.pendingUrl || "";
  const o = { load: tab.status, at: isMis(u) ? "MIS" : isGw(u) ? "GW" : !u || u.startsWith("about:") ? "빈 탭" : "다른 주소", url: u };
  const r = await within(chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const vis = (el) => el && el.offsetParent !== null && !el.disabled, d = document;
      return { pw: [...d.querySelectorAll('input[type="password"]')].some(vis), tree: !!d.querySelector(".tree-title"), cust: !!d.querySelector("#custBtn input.btn_basic"), rs: d.readyState, lg: window.__gwLogin || "", st: !!window.__gwStart };
    },
  }).then((x) => x, (e) => ({ err: String((e && e.message) || e) })), 2500, { err: "hang" });
  if (r.err) { o.err = /error page/i.test(r.err) ? "errpage" : r.err === "hang" ? "hang" : "noaccess"; return o; }
  for (const f of r) { const v = f.result; if (!v) continue; o.pw = o.pw || v.pw; o.tree = o.tree || v.tree; o.cust = o.cust || v.cust; if (f.frameId === 0) { o.rs = v.rs; o.lg = v.lg; o.st = v.st; } }
  return o;
}
const runFile = (tabId, file, allFrames) => chrome.scripting.executeScript({ target: allFrames ? { tabId, allFrames: true } : { tabId }, files: [file] }).catch(() => {});

// ---- 새 탭 넘겨받기 ----
// 작업 탭(또는 딸린 탭)이 연 새 탭 → 일단 딸린 탭(extra)으로 기억하고 최소화. 주소가 MIS면(지금 또는 나중에) MIS 탭으로 올림
async function adopt(newId, fromId, url) {
  if (fromId == null || newId == null) return;
  let added = false, manual = false;
  await mutJob(async (job) => {
    manual = job.kind === "manual";
    if (!(job.tabs.includes(fromId) || job.extra.includes(fromId)) || job.tabs.includes(newId) || job.extra.includes(newId)) return false;
    if (!(await chrome.tabs.get(newId).catch(() => null))) return false;
    job.extra.push(newId); added = true;
  });
  if (!added) return;
  await own(newId);
  if (!manual) await tidy(newId);
  const tab = await chrome.tabs.get(newId).catch(() => null), u = url || (tab && (tab.pendingUrl || tab.url)) || "";
  if (isMis(u)) await seeUrl(newId, u);
  else await log("GW가 새 탭을 엶 (아직 MIS 주소 아님 · 지켜봄)", { quiet: true });
}
// 작업에 딸린 탭이 MIS 주소로 감 → 그 탭이 MIS 탭 (새 탭이든, 같은 탭에서 넘어갔든). MIS 탭은 하나만
async function seeUrl(tabId, url) {
  if (!isMis(url)) return;
  let what = "";
  await mutJob(async (job) => {
    const inTabs = job.tabs.includes(tabId), inExtra = job.extra.includes(tabId);
    if (!inTabs && !inExtra) return false;
    if (job.misTab != null && job.misTab !== tabId) {
      const old = await chrome.tabs.get(job.misTab).catch(() => null);
      if (old && isMis(old.url || old.pendingUrl)) { if (!inExtra) return false; job.extra = job.extra.filter((x) => x !== tabId); what = "dup"; return; } // 이미 MIS 탭이 있음 → 새로 열린 건 닫음
    }
    if (job.misTab === tabId && job.stage !== "gw" && job.stage !== "open") return false;
    if (inExtra) { job.extra = job.extra.filter((x) => x !== tabId); job.tabs.push(tabId); }
    if (job.gwTab === tabId) job.gwTab = null;
    job.misTab = tabId; job.stage = "mis"; job.stageAt = Date.now(); what = inExtra ? "new" : "same";
  });
  if (what === "dup") { await chrome.tabs.remove(tabId).catch(() => {}); await log("MIS 탭이 하나 더 열려서 닫음", { quiet: true }); }
  else if (what) await log(what === "new" ? "MIS 새 탭을 자동 탭으로 → MIS 화면 기다림" : "같은 탭에서 MIS로 넘어감 → MIS 화면 기다림");
}
chrome.tabs.onCreated.addListener((tab) => adopt(tab.id, tab.openerTabId, tab.pendingUrl || tab.url));
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => adopt(d.tabId, d.sourceTabId, d.url));
chrome.webNavigation.onCommitted.addListener(async (d) => {
  const { job } = await get("job");
  if (!job || !([...(job.tabs || []), ...(job.extra || [])].includes(d.tabId))) return;
  if (d.frameId === 0) seeUrl(d.tabId, d.url);
  // 자동 창에서는 GW·MIS 알림창(alert)·확인창(confirm)이 사람 없이 멈추게 함 → 기록만 하고 넘김, 확인창은 "예"
  if (job.kind === "manual" || !GWMIS.test(d.url)) return;
  chrome.scripting.executeScript({
    target: { tabId: d.tabId, frameIds: [d.frameId] }, world: "MAIN", injectImmediately: true,
    func: () => {
      if (window.__gwQuiet) return; window.__gwQuiet = true;
      const note = (m) => { try { (window.top.__gwNotes = window.top.__gwNotes || []).push(String(m)); } catch (e) {} };
      window.alert = (m) => note(m);
      window.confirm = (m) => { note("확인: " + m); return true; };
    },
  }).catch(() => {});
});

// ---- 단계별 감시 (확인 때마다 = 3초마다) ----
// 스크립트가 보낸 글로 단계를 넘기고, 바로 끝낼 실패는 여기서 가림
const FATAL = [/비밀번호가 저장 안 돼 있어/, /GW 로그인 2번 실패/, /자동입력 못 켬/, /매출 가져오기 못 켬/];
async function onSay(msg, sender) {
  const tid = sender.tab && sender.tab.id, now = Date.now();
  let act = "";
  await log(msg, { set: (job) => {
    if (/GW 로그인 시도/.test(msg)) { job.loginAt = now; job.stage = "gw"; job.stageAt = now; }
    else if (/경영정보\(MIS\) 열기/.test(msg)) { if (job.stage !== "gw" && job.stage !== "open") return true; /* 새 탭이 먼저 잡힘 → 단계 글을 되돌리지 않음 */ job.stage = "open"; job.stageAt = now; job.n.click = (job.n.click || 0) + 1; if (tid != null) job.gwTab = tid; }
    else if (/'경영정보' 메뉴를 못 찾음/.test(msg)) { job.n.noMenu = (job.n.noMenu || 0) + 1; act = job.n.noMenu > 1 ? "fail" : "reloadGw"; if (act === "reloadGw") job.stageAt = now; }
    else if (/주문등록 화면을 못 열었어요/.test(msg)) { job.n.noOrder = (job.n.noOrder || 0) + 1; act = job.n.noOrder > 1 ? "fail" : "reloadMis"; if (act === "reloadMis") job.stageAt = now; }
    else if (FATAL.some((re) => re.test(msg))) act = "fail";
  } });
  const { job } = await get("job"); if (!job || job.kind === "manual" || !act) return;
  if (act === "fail") return tick("fail:" + msg);
  if (act === "reloadGw" && tid != null) { await chrome.tabs.reload(tid).catch(() => {}); await log("'경영정보' 메뉴를 못 찾아 GW 화면을 다시 불러옴 (1번만)"); }
  if (act === "reloadMis" && tid != null) { await chrome.tabs.reload(tid).catch(() => {}); await log("주문등록 메뉴를 못 찾아 MIS 화면을 다시 불러옴 (1번만)"); }
}
async function watch(job, now, L) {
  const e = now - (job.stageAt || job.openedAt), n = job.n || {};
  const bump = (fn) => mutJob((j) => { fn(j); });
  if (job.stage === "gw") {
    const g = await probe(job.gwTab);
    if (g.gone) return fail(job, "GW 탭이 닫힘");
    if (g.at === "MIS") return seeUrl(job.gwTab, g.url);
    let w;
    if (g.err === "errpage") {
      w = "GW 화면이 안 열림 (연결 오류)";
      if ((n.gwReload || 0) < 2) { if (now - Math.max(job.stageAt, n.gwReloadAt || 0) > 6e3) { await bump((j) => { j.n.gwReload = (j.n.gwReload || 0) + 1; j.n.gwReloadAt = now; }); await chrome.tabs.reload(job.gwTab).catch(() => {}); await log(`GW 화면이 안 열려 다시 불러옴 (${(n.gwReload || 0) + 1}/2)`); return; } }
      else if (now - n.gwReloadAt > 10e3) return fail(job, "GW에 연결 안 됨 (매장 인터넷 확인 · 2번 다시 불러옴)");
    } else if (g.err === "hang") w = "GW 화면이 응답 없음 (알림창이 떠 있을 수 있음)";
    else if (g.load === "loading" && g.rs !== "complete" && g.rs !== "interactive") w = "GW 화면이 뜨길 기다림";
    else if (g.err) w = "GW 화면을 확인 못 함";
    else if (g.pw) {
      if (!job.loginAt) { w = "GW 로그인 화면 · 로그인 스크립트를 기다림"; if (e > 8e3 && !n.loginInj) { await bump((j) => { j.n.loginInj = 1; }); await runFile(job.gwTab, "login.js", true); await log("GW 로그인 스크립트가 안 돌아 다시 넣음", { quiet: true }); } }
      else { w = "GW 로그인 뒤 첫 화면을 기다림"; if (now - job.loginAt > 30e3) return fail(job, "GW 로그인이 안 됨 (30초째 로그인 화면 · 아이디·비밀번호 확인)"); }
    } else if (!g.lg) { // 로그인된 GW 화면인데 login.js가 안 돎
      w = "GW 첫 화면 · 경영정보 누르기 전";
      if (e > 5e3 && (n.clickInj || 0) < 2 && now - (n.clickInjAt || 0) > 20e3) { await bump((j) => { j.n.clickInj = (j.n.clickInj || 0) + 1; j.n.clickInjAt = now; }); await runFile(job.gwTab, "login.js", false); await log("GW 화면에서 스크립트가 안 돌아 다시 넣음", { quiet: true }); }
    } else w = g.lg === "nomenu" ? "GW에서 '경영정보' 메뉴를 못 찾음" : g.lg === "clicked" ? "경영정보를 누름 · 새 탭을 기다림" : "GW 왼쪽 메뉴에서 '경영정보'를 찾는 중";
    await noteWait(w);
    if (e > L.gw) return fail(job, w);
    return;
  }
  if (job.stage === "open") {
    // 이벤트를 놓쳤을 때: 딸린 탭이 이미 MIS로 갔나 / 누가 열었는지 모르는 MIS 새 탭이 있나 (작업 전에 있던 탭은 사람 것 → 안 건드림)
    for (const id of [...job.tabs, ...job.extra]) { const t = await chrome.tabs.get(id).catch(() => null); if (t && isMis(t.url || t.pendingUrl)) return seeUrl(id, t.url || t.pendingUrl); }
    const lost = (await chrome.tabs.query({}).catch(() => [])).find((t) => isMis(t.url || t.pendingUrl) && !(job.before || []).includes(t.id) && !job.tabs.includes(t.id) && !job.extra.includes(t.id));
    if (lost) { await mutJob((j) => { j.extra.push(lost.id); }); await own(lost.id); await tidy(lost.id); await log("누가 열었는지 모르는 MIS 새 탭을 넘겨받음", { quiet: true }); return seeUrl(lost.id, lost.url || lost.pendingUrl); }
    const w = job.extra.length ? "새 탭은 열렸는데 MIS 주소로 안 감" : "경영정보를 눌렀는데 MIS 새 탭이 안 생김";
    if (e > L.open) {
      const g = await probe(job.gwTab);
      if ((n.click || 1) < 2 && !g.gone && g.at === "GW" && !g.err && !g.pw) { await bump((j) => { j.n.click = 2; j.stageAt = now; }); await log(`${w} → 경영정보를 다시 누름`); await runFile(job.gwTab, "login.js", false); return; }
      if (!n.direct) {
        const win = await chrome.windows.create({ url: MIS_URL, state: "normal", focused: true, ...WIN_BOX }).catch(() => null);
        if (!win) return fail(job, `${w} · MIS 주소도 직접 못 엶`);
        const t = win.tabs[0]; chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {});
        await own(t.id);
        await mutJob((j) => { j.n.direct = 1; j.tabs.push(t.id); j.misTab = t.id; j.stage = "mis"; j.stageAt = Date.now(); });
        await log(`${w} → MIS 주소를 직접 엶`);
        return;
      }
      return fail(job, w);
    }
    return noteWait(w);
  }
  if (job.stage === "mis") {
    const m = await probe(job.misTab);
    if (m.gone) { // MIS 탭이 닫힘 → GW 탭이 살아 있으면 한 번 더 누름
      const g = await probe(job.gwTab);
      if (!n.reopen && !g.gone && g.at === "GW") { await bump((j) => { j.n.reopen = 1; j.n.click = 1; j.tabs = j.tabs.filter((x) => x !== j.misTab); j.misTab = null; j.stage = "open"; j.stageAt = now - L.open; }); await log("MIS 탭이 닫힘 → 경영정보를 다시 누름", { quiet: true }); return; }
      return fail(job, "MIS 탭이 닫힘");
    }
    let w;
    if (m.at === "GW") { await bump((j) => { j.gwTab = j.misTab; j.misTab = null; j.stage = "gw"; j.stageAt = now; }); return; } // MIS 탭이 GW로 돌아감(로그인 풀림) → GW 단계부터
    if (m.err === "errpage") {
      w = "MIS 화면이 안 열림 (연결 오류)";
      if ((n.misReload || 0) < 2) { if (now - Math.max(job.stageAt, n.misReloadAt || 0) > 5e3) { await bump((j) => { j.n.misReload = (j.n.misReload || 0) + 1; j.n.misReloadAt = now; }); await chrome.tabs.reload(job.misTab).catch(() => {}); await log(`MIS 화면이 안 열려 다시 불러옴 (${(n.misReload || 0) + 1}/2)`); return; } }
      else if (now - n.misReloadAt > 10e3) return fail(job, "MIS에 연결 안 됨 (매장 인터넷·VPN 확인 · 2번 다시 불러옴)");
    } else if (m.err === "hang") w = "MIS 화면이 응답 없음 (알림창이 떠 있을 수 있음)";
    else if (m.load === "loading" && m.rs !== "complete" && m.rs !== "interactive") {
      w = "MIS 화면이 뜨길 기다림";
      if (e > 30e3 && !n.misSlow) { await bump((j) => { j.n.misSlow = 1; }); await chrome.tabs.reload(job.misTab).catch(() => {}); await log("MIS 화면이 30초째 안 떠서 다시 불러옴"); return; }
    } else if (m.err) w = "MIS 화면을 확인 못 함";
    else if (m.pw) { // MIS 로그인 화면 = GW를 안 거친 것 → login.js가 GW로 보냄 (안 돌았으면 다시 넣음)
      w = "MIS가 로그인 화면으로 나옴";
      if (e > 6e3 && !m.lg && !n.misLoginInj) { await bump((j) => { j.n.misLoginInj = 1; }); await runFile(job.misTab, "login.js", true); }
    } else if (!m.st) { // 화면은 떴는데 start.js가 안 돎 (그때 내 탭이 아니라고 들었거나, 배경이 잠들어 대답을 못 받음)
      w = "MIS 첫 화면 · 시작 스크립트를 기다림";
      if (e > 6e3 && (n.startInj || 0) < 2 && now - (n.startInjAt || 0) > 25e3) { await bump((j) => { j.n.startInj = (j.n.startInj || 0) + 1; j.n.startInjAt = now; }); await runFile(job.misTab, "start.js", false); await log("MIS 화면에서 시작 스크립트가 안 돌아 다시 넣음", { quiet: true }); }
    } else w = m.cust ? "주문등록 화면이 열림 · 자동 대기를 켜는 중" : m.tree ? "MIS 메뉴에서 주문등록을 여는 중" : "MIS 왼쪽 메뉴가 그려지길 기다림";
    await noteWait(w);
    if (e > L.mis) return fail(job, w);
    return;
  }
  if (job.stage === "start" && job.kind === "order") {
    if (e > 20e3 && !n.agentInj) { // 자동 대기(mis-agent.js)가 안 떴으면 한 번 더 넣음
      const has = await within(chrome.scripting.executeScript({ target: { tabId: job.misTab }, world: "MAIN", func: () => !!window.__misAgent }).then((x) => !!(x[0] && x[0].result), () => null), 2500, null);
      await bump((j) => { j.n.agentInj = 1; });
      if (has === false) { await inject(job.misTab, 0, AGENT_URL()); await log("자동 대기 스크립트가 안 떠서 다시 넣음", { quiet: true }); }
    }
    await noteWait("자동 대기가 전송을 받길 기다림");
    if (e > L.start) return fail(job, "주문등록 화면까지 갔지만 자동 대기가 전송을 못 받음 (스크립트를 못 받았거나 시트 연결 안 됨)");
  }
}

// ---- 확인 (한 줄로: 겹쳐 돌지 않게) ----
let chain = Promise.resolve();
const tick = (why) => (chain = chain.then(() => within(tickOnce(why), 90e3)).catch(() => {}));
async function tickOnce(why) {
  let { on, job, tried = {}, lastBeat = 0, limits = {} } = await get(["on", "job", "tried", "lastBeat", "limits"]);
  const L = { ...LIMIT, ...limits }; // limits: 시험용으로 시간 제한을 줄일 때만 (평소엔 없음)
  if (!on) return;
  const now = Date.now();
  // 작업 탭이 다 닫혔으면(사람이 닫음) 작업 끝 — 1.7.1: 기다리던 전송이면 폰에 바로 알림
  let closed = null;
  if (job) {
    const alive = []; for (const id of job.tabs || []) if (await chrome.tabs.get(id).catch(() => null)) alive.push(id);
    const extra = []; for (const id of job.extra || []) if (await chrome.tabs.get(id).catch(() => null)) extra.push(id);
    if (!alive.length && !extra.length) closed = job;
    else if (alive.length !== job.tabs.length || extra.length !== (job.extra || []).length) job = (await mutJob(async (j) => { const keep = async (ids) => { const out = []; for (const id of ids) if (await chrome.tabs.get(id).catch(() => null)) out.push(id); return out; }; j.tabs = await keep(j.tabs); j.extra = await keep(j.extra); })) || job;
  }
  let d;
  try { d = await readStatus(); } catch (e) { return; } // 인터넷 끊김: 다음에
  const p = d.misPush || {}, sp = d.salesPush || {};
  if (closed) {
    await lock(() => chrome.storage.local.remove("job"));
    if (closed.kind === "order" && "o" + p.id === closed.id && p.status === "pending") await post("misPush", { ...p, status: "error", doneAt: now, text: `PC 자동입력이 ${Math.round((now - closed.openedAt) / 1000)}초 만에 멈춤 · 멈춘 곳: 자동 창이 닫힘 (${closed.step || ""}) → MIS에 직접 넣어 주세요` });
    await log("자동 창이 닫혀 있음 → 작업 끝");
    return;
  }
  if (!job && now - lastBeat > 10 * 60e3) { await put({ lastBeat: now }); const { auto } = await get("auto"); post("misAgent", { at: now, mode: "ondemand", ver: VER, auto: auto === false ? 0 : 1 }); } // 폰에 "PC 대기 중" (auto: 상시 수집 켜짐)
  const orderWaiting = p.date === ymd() && p.status === "pending" && now - (p.at || 0) < 30 * 60e3;
  const salesWaiting = sp.status === "pending" && now - (sp.at || 0) < 6 * 3600e3; // 1.7.3: 매출 요청은 6시간까지 받음 (PC가 꺼져 있다 켜져도. 예전엔 30분이 지나면 버림)

  if (!job) {
    const req = orderWaiting ? { kind: "order", id: "o" + p.id, msg: "폰 전송 받음 → GW·MIS 열기" } : salesWaiting ? { kind: "sales", id: "s" + sp.id, msg: "Gross 불러오기 받음 → GW·MIS 열기" } : null;
    if (!req) return autoCheck(now, L); // 기다리는 요청이 없음 → 스스로 받아 올 게 있나 (1.8.0)
    if (tried[req.id]) return; // 같은 요청은 한 번만 (안 되면 폰에 ⚠, 다시 누르면 새 요청)
    await put({ tried: Object.fromEntries([...Object.entries(tried), [req.id, now]].slice(-10)) });
    try { await openJob(req.kind, req.id, req.msg); }
    catch (e) { // 창을 못 엶 → 바로 알림 (예전엔 아무 말 없이 끝)
      await log("자동 창을 못 엶: " + ((e && e.message) || e));
      if (req.kind === "order") await post("misPush", { ...p, status: "error", doneAt: now, text: "PC 크롬이 자동 창을 못 엶 · 멈춘 곳: 창 열기 → MIS에 직접 넣어 주세요" });
    }
    return;
  }
  if (job.kind === "manual") return; // [자동 창 보기]로 연 창은 사람이 닫음 (그 창에서도 MIS 자동 대기가 전송을 처리)
  const age = now - job.openedAt, where = () => (job.step || "알 수 없음") + (job.wait ? ` · 기다리던 것: ${job.wait}` : "");
  if (job.kind === "order") {
    const same = "o" + p.id === job.id;
    if (same && /done|error/.test(p.status) && (p.doneAt || 0) > job.openedAt) return endJob(`입력 ${p.status === "done" ? "완료" : "확인 필요"} → 창 닫음`);
    if (!same && p.id) return endJob("새 전송이 들어옴 → 이 창 닫고 새로"); // 다음 확인 때 새 요청으로 엶
    const running = same && p.status === "running";
    if (running && job.stage !== "run") { await mutJob((j) => { j.stage = "run"; j.stageAt = now; j.wait = ""; }); return; }
    if (age > (running ? L.orderRun : L.order)) {
      if (same && /pending|running/.test(p.status)) await post("misPush", { ...p, status: "error", doneAt: now, text: `PC 자동입력이 ${Math.round(age / 60e3)}분 안에 못 끝냄 · 멈춘 곳: ${where()} → MIS에 직접 넣어 주세요` });
      return endJob(`시간 초과 (${job.step || ""}) → 창 닫음`);
    }
    if (/^fail:/.test(why || "")) return fail(job, String(why).slice(5));
    if (!running) return watch(job, now, L);
    return;
  }
  if (job.kind === "sales") {
    const same = "s" + sp.id === job.id;
    if (same && /done|error/.test(sp.status) && (sp.doneAt || 0) > job.openedAt) {
      // 1.8.0: 스스로 보낸 요청이었으면 설정 창에 보일 상태를 고침 (됐으면 1분 뒤 다시 확인해 "다 받아 둠"으로, 안 됐으면 정해 둔 30분 뒤에 다시)
      const { autoSt = {} } = await get("autoSt");
      if ("s" + autoSt.reqId === job.id) await put({ autoSt: { ...autoSt, msg: sp.status === "done" ? "스스로 받음" : "스스로 받다가 못 받음 · 조금 뒤 다시", doneAt: now, ...(sp.status === "done" ? { next: now + 60e3 } : {}) } });
      return endJob(`매출 ${sp.status === "done" ? "가져옴" : "못 가져옴"} → 창 닫음`);
    }
    // 1.8.0: 스스로 받던 중에 폰에서 [GW 전송]이 오면 발주가 먼저 (받던 것은 멈추고, 30분 뒤 스스로 다시 받음)
    if (orderWaiting && same && /pending|running/.test(sp.status)) { const { autoSt = {} } = await get("autoSt"); if ("s" + autoSt.reqId === job.id) { await postMerge("salesPush", { status: "error", doneAt: now, text: "발주 전송이 먼저라 멈춤 · 조금 뒤 스스로 다시 받아요", cur: null, prog: null }); return endJob("발주 전송이 들어옴 → 스스로 받던 매출은 멈추고 양보"); } }
    if (!same && sp.id && sp.status === "pending") return endJob("새 매출 요청이 들어옴 → 이 창 닫고 새로"); // 1.7.3: 예전엔 12분을 다 기다린 뒤에야 새 요청을 받음
    if (age > L.sales) { if (same && /pending|running/.test(sp.status)) await postMerge("salesPush", { status: "error", doneAt: now, text: `PC가 12분 안에 못 끝냄 · 멈춘 곳: ${where()}`, cur: null, prog: null }); return endJob("매출 시간 초과 → 창 닫음"); }
    if (/^fail:/.test(why || "")) return fail(job, String(why).slice(5));
    if (job.stage !== "run") return watch(job, now, L);
  }
}

// ---- 상시 수집 (1.8.0): 크롬이 켜져 있는 동안 PC가 스스로 ----
//  30분마다 시트를 한 번 읽어, 어제까지의 실제 매출·메뉴 판매가 비었거나 계획(gw-plan.json)에 아직 안 한 일이 있으면 스스로 요청(salesPush)을 적음
//  → 그 뒤는 폰 버튼과 같은 길(창 하나 열어 GW·MIS에서 받아 오고 닫음). 다 받아 뒀으면 3시간 쉼. 하루 4번까지만 스스로 요청(MIS가 막혔을 때 계속 두드리지 않게)
//  요청하지 않는 때(발주 시간대 12:30~14:45, 발주 전송 중, 밤, 다른 요청이 도는 중, 시트 비정상)는 auto.js에. 끄기: 확장 설정의 [상시 수집]
const AUTO = { every: 30 * 60e3, idle: 3 * 3600e3, retry: 5 * 60e3, max: 4 };
const PLAN_URL = "https://mfgkorea.github.io/label-list/gw-plan.json";
async function autoCheck(now, L) {
  const { auto, autoSt = {} } = await get(["auto", "autoSt"]);
  if (auto === false || now < (autoSt.next || 0)) return;
  const day = ymd(new Date(now)), st = autoSt.day === day ? { ...autoSt } : { day, n: 0 };
  st.at = now; st.next = now + (L.autoEvery || AUTO.every);
  if (!L.autoAnyTime) { // 쉬는 시간대면 시트를 읽지도 않고 그 시간이 끝날 때 다시 봄 (밤새 30분마다 시트 전체를 받지 않게)
    const dt = new Date(now), hm = dt.getHours() * 60 + dt.getMinutes(), at = (h, m, plus) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + (plus || 0), h, m, 0).getTime();
    const rest = hm >= 12 * 60 + 30 && hm <= 14 * 60 + 45 ? ["쉼: 발주 시간대(12:30~14:45)", at(14, 46)] : hm < 6 * 60 ? ["쉼: 밤", at(6, 0)] : hm > 23 * 60 + 30 ? ["쉼: 밤", at(6, 0, 1)] : null;
    if (rest) { st.msg = rest[0]; st.next = rest[1]; await put({ autoSt: st }); return; }
  }
  await put({ autoSt: st }); // 먼저 적어 둠: 시트를 읽는 동안 다음 확인이 겹쳐도 한 번만
  let d, plan = [];
  try { const v = await netGet(API + "?api=1&t=" + now, 45e3); if (!v || !v.ok || !v.data) throw new Error("x"); d = v.data; }
  catch (e) { st.msg = "시트를 못 읽음 (인터넷 확인)"; st.next = now + AUTO.retry; await put({ autoSt: st }); return; }
  try { const p = await netGet(PLAN_URL + "?t=" + now, 8e3); if (Array.isArray(p)) plan = p; } catch (e) {} // 계획을 못 받으면 매출·메뉴만
  const r = autoPlan(d, now, plan, { pc: true, forceTime: !!L.autoAnyTime });
  let go = false;
  if (r.act === "request") {
    if (st.n >= (L.autoMax || AUTO.max)) { st.msg = `오늘 ${st.n}번 요청했지만 다 못 받음 · 내일 다시`; st.next = now + AUTO.idle; }
    else {
      const req = r.make(now);
      if (await postOk("salesPush", req)) { st.n++; st.reqId = req.id; st.reqAt = now; st.msg = `스스로 받는 중: ${r.label}`; go = true; await log(`상시 수집 · ${r.label} → 스스로 요청`, { quiet: true }); }
      else { st.msg = "요청을 시트에 못 적음"; st.next = now + AUTO.retry; }
    }
  } else if (r.act === "none") { st.msg = r.why === "최신" ? "다 받아 둠" : r.why; st.okAt = now; st.next = now + (L.autoIdle || AUTO.idle); }
  else st.msg = "쉼: " + r.why;
  await put({ autoSt: st });
  if (go) { fast(); setTimeout(() => tick("auto"), 500); }
}

chrome.runtime.onStartup.addListener(async () => {
  await lock(() => chrome.storage.local.remove("job")); await put({ owned: [] });
  { const { autoSt = {} } = await get("autoSt"); await put({ autoSt: { ...autoSt, next: Date.now() + 60e3 } }); } // 크롬이 막 켜졌으면 1분 뒤에 첫 확인
  await sweep("크롬 시작", true); setTimeout(() => sweep("크롬 시작 (되살아난 창)", true), 4000); setTimeout(() => sweep("크롬 시작 (되살아난 창)", true), 12000);
  tick("start");
});
chrome.runtime.onInstalled.addListener(async () => { await chrome.storage.local.remove(["job", "tabId", "openedAt", "manual", "warmAt", "kicked"]); { const { autoSt = {} } = await get("autoSt"); await put({ autoSt: { ...autoSt, next: Date.now() + 30e3 } }); } await sweep("확장 설치·업데이트"); tick("start"); });
chrome.alarms.create("watch", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { tick("alarm"); fast(); });
let fastOn = false;
function fast() { // 매장 시간이거나 작업 중이면 3초마다 (배경이 잠들면 30초 알람이 다시 깨움)
  if (fastOn) return; fastOn = true;
  const step = async () => { const { job } = await get("job"); if (!busyHours() && !job) { fastOn = false; return; } await tick("fast"); setTimeout(step, 3e3); };
  setTimeout(step, 3e3);
}
fast();

const AGENT_URL = () => "https://mfgkorea.github.io/label-list/mis-agent.js?quiet=1&t=" + Date.now();
const inject = (tabId, frameId, url) => chrome.scripting.executeScript({
  target: { tabId, frameIds: [frameId || 0] }, world: "MAIN",
  func: (u) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = u; (document.body || document.documentElement).appendChild(s); },
  args: [url],
});
// 자동 대기를 켠 뒤: GW 탭과 딸린 탭(공지 등)은 이제 필요 없음 → 닫음 (1.7.0은 MIS 새 탭이 생기고 5초 뒤에 닫아, 늦게 뜨는 MIS를 놓칠 수 있었음)
async function settle(misId, stage) {
  let drop = [];
  await mutJob((j) => { if (j.kind === "manual") return false; drop = [...j.tabs.filter((x) => x !== misId), ...j.extra]; j.tabs = [misId]; j.extra = []; j.misTab = misId; j.gwTab = null; j.stage = stage; j.stageAt = Date.now(); });
  for (const id of drop) await chrome.tabs.remove(id).catch(() => {});
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const tid = sender.tab ? sender.tab.id : null;
    if (m.q === "managed") {
      await q.catch(() => {}); // 새 탭 넘겨받기가 끝난 뒤에 대답 (예전엔 넘겨받기 전에 물으면 "아님"으로 듣고 조용히 끝남)
      let { on, job } = await get(["on", "job"]);
      if (on && job && tid != null && !(job.tabs || []).includes(tid)) { // 늦게라도: 이 탭을 연 탭이 작업 탭이면 지금 넘겨받고, MIS 주소면 MIS 탭으로
        if (sender.tab.openerTabId != null) await adopt(tid, sender.tab.openerTabId, sender.tab.url);
        if ((sender.frameId || 0) === 0) await seeUrl(tid, sender.tab.url);
        ({ job } = await get("job"));
      }
      return reply({ managed: !!on && !!job && tid != null && (job.tabs || []).includes(tid), job: job ? (job.kind === "manual" ? "order" : job.kind) : "order" });
    }
    if (m.q === "startSales") { await inject(tid, sender.frameId, "https://mfgkorea.github.io/label-list/mis-sales.js?quiet=1&t=" + Date.now()).then(async () => { await settle(tid, "run"); await log("MIS 첫 화면 · 매출 가져오기 시작"); }, (e) => onSay("매출 가져오기 못 켬: " + e.message, sender)); return reply({}); }
    if (m.q === "log") { await onSay(String(m.msg || ""), sender); return reply({}); }
    if (m.q === "started") { await put({ tries: [] }); await inject(tid, sender.frameId, AGENT_URL()).then(async () => { await settle(tid, "start"); await log("주문등록 화면 · 입력 시작"); }, (e) => onSay("자동입력 못 켬: " + e.message, sender)); return reply({}); }
    if (m.q === "toGw") { // MIS 로그인 화면(로그인 풀림) → 그 탭을 GW로. 직접 연 MIS 탭이 이러면 더 할 게 없음 → 바로 알림
      const { job } = await get("job");
      if (job && job.kind !== "manual" && tid === job.misTab && (job.n || {}).direct) { tick("fail:MIS 새 탭이 안 생겨 MIS 주소를 직접 열었지만 MIS 로그인 화면이 나옴 (크롬에서 gw 사이트 팝업 허용 확인)"); return reply({}); }
      if (job && job.kind !== "manual" && (job.n || {}).toGw >= 1) { tick("fail:GW를 거쳐도 MIS가 로그인 화면으로 나옴 (2번째)"); return reply({}); }
      await mutJob((j) => { j.n.toGw = (j.n.toGw || 0) + 1; if (tid === j.misTab) { j.gwTab = tid; j.misTab = null; } j.stage = "gw"; j.stageAt = Date.now(); j.loginAt = 0; });
      if (sender.tab) chrome.tabs.update(sender.tab.id, { url: GW_URL });
      return reply({});
    }
    if (m.q === "ensure") { tick("save"); return reply({}); }
    if (m.q === "show") { // [자동 창 보기]: 작업 창이 있으면 앞으로, 없으면 사람이 보는 창으로 열기(자동으로 안 닫힘)
      const { job } = await get("job");
      const id = job && job.tabs && job.tabs[job.tabs.length - 1], tab = id != null ? await chrome.tabs.get(id).catch(() => null) : null;
      if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { state: "normal", focused: true }); }
      else await openJob("manual", "manual", "직접 열기 (자동 창 보기)");
      return reply({});
    }
    reply({});
  })();
  return true;
});
