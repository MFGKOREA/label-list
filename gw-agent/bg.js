// 배경 (1.7.0, 11/6 KM: "전송 눌렀을 때 그때 한 번만", 크롬 창이 3개씩 뜨지 않게)
//  - 평소엔 창 없음. 폰에서 [GW 전송]·[Gross 불러오기]를 누르면 그때 최소화된 창 하나만 열어 GW 로그인 → 경영정보 → MIS → 입력·저장 → 창 닫음
//  - 한 번 누른 요청은 한 번만 시도 (안 되면 다시 열지 않고 시트에 "어디서 멈췄는지"를 적어 폰에 ⚠로 보임 → 다시 누르면 새로 시도)
//  - 창을 열기 전에 예전에 자동으로 열었던 GW·MIS 창(크롬이 다시 켜지며 되살린 것 포함)을 닫음 → 늘 창 하나
//  - 확인이 겹쳐 돌지 않게 한 줄로 세움 (예전엔 30초 알람·3초 타이머·시작이 겹쳐 창이 두 번 열리기도 함)
//  - 매장 시간(08~22시)엔 3초마다, 그 밖엔 30초마다 전송 상태만 가볍게 확인
importScripts("common.js");
const get = (k) => chrome.storage.local.get(k);
const put = (o) => chrome.storage.local.set(o);
const VER = chrome.runtime.getManifest().version;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const busyHours = (d = new Date()) => { const h = d.getHours() + d.getMinutes() / 60; return h >= 8 && h < 22; };
const GWMIS = /^https:\/\/(gw|mis)\.madforgarlic\.com/;
const LIMIT = { order: 6 * 60e3, orderRun: 12 * 60e3, sales: 12 * 60e3 }; // 로그인~주문등록까지 6분, 입력 시작 뒤엔 12분까지

const post = (key, value) => fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key, value }) }).catch(() => {});
async function log(msg) {
  const { logs = [], job } = await get(["logs", "job"]);
  logs.unshift(`${new Date().toLocaleString("ko-KR")} ${msg}`);
  await put({ logs: logs.slice(0, 40) });
  // 작업 중이면 지금 단계를 폰에 보이게 (misAgent.step) — 멈추면 이 글자가 "어디서 멈췄는지"가 됨
  if (job && job.kind !== "manual") { job.step = msg; await put({ job }); post("misAgent", { at: Date.now(), mode: "ondemand", ver: VER, job: job.kind, step: msg, stepAt: Date.now() }); }
}

// ---- 창 관리: 이 확장이 연 탭(job.tabs)만 다룸 ----
async function sweep(reason, all = false) {
  // 자동으로 열었던 탭 기록(owned) + 최소화된 창의 GW·MIS 탭 → 닫음. 사람이 띄워 둔 보통 창은 안 건드림 (지금 작업 탭은 남김)
  //  all: 크롬이 막 켜졌을 때 — 그땐 사람이 쓰던 창이 없으니 되살아난 GW·MIS 탭을 다 닫음
  const { owned = [], job } = await get(["owned", "job"]), keep = new Set((job && job.tabs) || []);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const wins = new Map((await chrome.windows.getAll().catch(() => [])).map((w) => [w.id, w]));
  const kill = tabs.filter((t) => !keep.has(t.id) && (owned.includes(t.id) || (GWMIS.test(t.url || t.pendingUrl || "") && (all || (wins.get(t.windowId) || {}).state === "minimized"))));
  for (const t of kill) await chrome.tabs.remove(t.id).catch(() => {});
  await put({ owned: owned.filter((id) => keep.has(id)) });
  if (kill.length && reason) await log(`${reason} · 남은 자동 창 ${kill.length}개 닫음`);
}
async function own(tabId) { const { owned = [] } = await get("owned"); if (!owned.includes(tabId)) await put({ owned: [...owned, tabId].slice(-20) }); }
async function openJob(kind, id, msg) {
  await sweep();
  const manual = kind === "manual";
  const win = await chrome.windows.create({ url: GW_URL, state: manual ? "normal" : "minimized", focused: manual });
  const tab = win.tabs[0];
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  await own(tab.id);
  await put({ job: { kind, id, openedAt: Date.now(), tabs: [tab.id], step: msg } });
  await log(msg);
}
async function endJob(reason) {
  const { job } = await get("job");
  await chrome.storage.local.remove("job");
  if (job) for (const id of job.tabs || []) await chrome.tabs.remove(id).catch(() => {});
  await sweep();
  await log(reason);
  post("misAgent", { at: Date.now(), mode: "ondemand", ver: VER });
}
const isJobTab = async (id) => { const { job } = await get("job"); return !!job && (job.tabs || []).includes(id); };

// ---- 확인 (한 줄로: 겹쳐 돌지 않게) ----
let chain = Promise.resolve();
const tick = (why) => (chain = chain.then(() => tickOnce(why)).catch(() => {}));
async function tickOnce(why) {
  const { on, job, tried = {}, lastBeat = 0, limits = {} } = await get(["on", "job", "tried", "lastBeat", "limits"]);
  const L = { ...LIMIT, ...limits }; // limits: 시험용으로 시간 제한을 줄일 때만 (평소엔 없음)
  if (!on) return;
  const now = Date.now();
  // 작업 탭이 다 닫혔으면(사람이 닫음) 작업 끝
  if (job) { const alive = []; for (const id of job.tabs || []) if (await chrome.tabs.get(id).catch(() => null)) alive.push(id); if (!alive.length) { await chrome.storage.local.remove("job"); await log("자동 창이 닫혀 있음 → 작업 끝"); return; } if (alive.length !== job.tabs.length) await put({ job: { ...job, tabs: alive } }); }
  let d;
  try { const v = await (await fetch(API + "?api=1&status=1&t=" + now)).json(); d = (v && (v.status || v.data)) || {}; } catch (e) { return; } // 인터넷 끊김: 다음에
  if (!job && now - lastBeat > 10 * 60e3) { await put({ lastBeat: now }); post("misAgent", { at: now, mode: "ondemand", ver: VER }); } // 폰에 "PC 대기 중"
  const p = d.misPush || {}, sp = d.salesPush || {};
  const orderWaiting = p.date === ymd() && p.status === "pending" && now - (p.at || 0) < 30 * 60e3;
  const salesWaiting = sp.status === "pending" && now - (sp.at || 0) < 30 * 60e3;

  if (!job) {
    const req = orderWaiting ? { kind: "order", id: "o" + p.id, msg: "폰 전송 받음 → GW·MIS 열기" } : salesWaiting ? { kind: "sales", id: "s" + sp.id, msg: "Gross 불러오기 받음 → GW·MIS 열기" } : null;
    if (!req || tried[req.id]) return; // 같은 요청은 한 번만 (안 되면 폰에 ⚠, 다시 누르면 새 요청)
    await put({ tried: Object.fromEntries([...Object.entries(tried), [req.id, now]].slice(-10)) });
    await openJob(req.kind, req.id, req.msg);
    return;
  }
  if (job.kind === "manual") return; // [자동 창 보기]로 연 창은 사람이 닫음 (그 창에서도 MIS 자동 대기가 전송을 처리)
  const age = now - job.openedAt;
  if (job.kind === "order") {
    const same = "o" + p.id === job.id;
    if (same && /done|error/.test(p.status) && (p.doneAt || 0) > job.openedAt) return endJob(`입력 ${p.status === "done" ? "완료" : "확인 필요"} → 창 닫음`);
    if (!same && p.id) return endJob("새 전송이 들어옴 → 이 창 닫고 새로"); // 다음 확인 때 새 요청으로 엶
    const running = same && p.status === "running";
    if (age > (running ? L.orderRun : L.order)) {
      if (same && /pending|running/.test(p.status)) post("misPush", { ...p, status: "error", doneAt: now, text: `PC 자동입력이 ${Math.round(age / 60e3)}분 안에 못 끝냄 · 멈춘 곳: ${job.step || "알 수 없음"} → MIS에 직접 넣어 주세요` });
      return endJob(`시간 초과 (${job.step || ""}) → 창 닫음`);
    }
    return;
  }
  if (job.kind === "sales") {
    const same = "s" + sp.id === job.id;
    if (same && /done|error/.test(sp.status) && (sp.doneAt || 0) > job.openedAt) return endJob(`매출 ${sp.status === "done" ? "가져옴" : "못 가져옴"} → 창 닫음`);
    if (age > L.sales) { if (same && /pending|running/.test(sp.status)) post("salesPush", { ...sp, status: "error", doneAt: now, text: `PC가 12분 안에 못 끝냄 · 멈춘 곳: ${job.step || "알 수 없음"}` }); return endJob("매출 시간 초과 → 창 닫음"); }
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.remove("job"); await put({ owned: [] });
  await sweep("크롬 시작", true); setTimeout(() => sweep("크롬 시작 (되살아난 창)", true), 4000); setTimeout(() => sweep("크롬 시작 (되살아난 창)", true), 12000);
  tick("start");
});
chrome.runtime.onInstalled.addListener(async () => { await chrome.storage.local.remove(["job", "tabId", "openedAt", "manual", "warmAt", "kicked"]); await sweep("확장 설치·업데이트"); tick("start"); });
chrome.alarms.create("watch", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { tick("alarm"); fast(); });
let fastOn = false;
function fast() { // 매장 시간엔 3초마다 (배경이 잠들면 30초 알람이 다시 깨움)
  if (fastOn) return; fastOn = true;
  const step = async () => { if (!busyHours()) { fastOn = false; return; } await tick("fast"); setTimeout(step, 3e3); };
  setTimeout(step, 3e3);
}
fast();

// GW 경영정보가 MIS를 새 탭·새 창으로 열면 그 탭도 이 작업에 넣고 최소화, GW 탭은 5초 뒤 닫음
async function adopt(newId, fromId) {
  const { job } = await get("job");
  if (!job || fromId == null || !(job.tabs || []).includes(fromId) || job.tabs.includes(newId)) return;
  const tab = await chrome.tabs.get(newId).catch(() => null); if (!tab) return;
  job.tabs.push(newId); await put({ job }); await own(newId);
  chrome.tabs.update(newId, { autoDiscardable: false }).catch(() => {});
  if (job.kind !== "manual") {
    const w = await chrome.windows.get(tab.windowId, { populate: true }).catch(() => null);
    if (w && w.tabs.length === 1) chrome.windows.update(w.id, { state: "minimized" }).catch(() => {});
    else chrome.windows.create({ tabId: newId, state: "minimized", focused: false }).catch(() => {});
  }
  setTimeout(async () => { const { job: j } = await get("job"); if (j && j.tabs.includes(fromId) && j.tabs.length > 1) { await chrome.tabs.remove(fromId).catch(() => {}); j.tabs = j.tabs.filter((x) => x !== fromId); await put({ job: j }); } }, 5000);
  await log("MIS 새 탭을 자동 탭으로");
}
chrome.tabs.onCreated.addListener((tab) => adopt(tab.id, tab.openerTabId));
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => adopt(d.tabId, d.sourceTabId));
// 자동 창에서는 GW·MIS 알림창(alert)·확인창(confirm)이 사람 없이 멈추게 함 → 기록만 하고 넘김, 확인창은 "예"
chrome.webNavigation.onCommitted.addListener(async (d) => {
  const { job } = await get("job");
  if (!job || job.kind === "manual" || !(job.tabs || []).includes(d.tabId) || !GWMIS.test(d.url)) return;
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

const inject = (sender, url) => chrome.scripting.executeScript({
  target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: "MAIN",
  func: (u) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = u; (document.body || document.documentElement).appendChild(s); },
  args: [url],
});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const { on, job } = await get(["on", "job"]);
    if (m.q === "managed") return reply({ managed: !!on && !!sender.tab && (await isJobTab(sender.tab.id)), job: job ? (job.kind === "manual" ? "order" : job.kind) : "order" });
    if (m.q === "startSales") { await inject(sender, "https://mfgkorea.github.io/label-list/mis-sales.js?quiet=1&t=" + Date.now()).then(() => log("MIS 첫 화면 · 매출 가져오기 시작"), (e) => log("매출 가져오기 못 켬: " + e.message)); return reply({}); }
    if (m.q === "log") { await log(m.msg); return reply({}); }
    if (m.q === "started") { await put({ tries: [] }); await inject(sender, "https://mfgkorea.github.io/label-list/mis-agent.js?quiet=1&t=" + Date.now()).then(() => log("주문등록 화면 · 입력 시작"), (e) => log("자동입력 못 켬: " + e.message)); return reply({}); }
    if (m.q === "toGw") { if (sender.tab) chrome.tabs.update(sender.tab.id, { url: GW_URL }); return reply({}); }
    if (m.q === "ensure") { tick("save"); return reply({}); }
    if (m.q === "show") { // [자동 창 보기]: 작업 창이 있으면 앞으로, 없으면 사람이 보는 창으로 열기(자동으로 안 닫힘)
      const id = job && job.tabs && job.tabs[job.tabs.length - 1], tab = id != null ? await chrome.tabs.get(id).catch(() => null) : null;
      if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { state: "normal", focused: true }); }
      else await openJob("manual", "manual", "직접 열기 (자동 창 보기)");
      return reply({});
    }
    reply({});
  })();
  return true;
});
