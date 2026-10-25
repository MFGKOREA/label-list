// 배경
//  매장 시간(매일 08:00~22:00): 최소화된 "대기 창"에 GW 로그인 → 경영정보 → MIS 주문등록을 미리 열어 둠 (warm)
//   → 3~5초마다 시트 확인, 폰에서 GW 전송·Gross 불러오기를 누르면 열린 MIS에서 바로 실행 (10초 안팎)
//   → 22시가 되면 대기 창을 닫음. 로그인이 풀리면(자동 대기 응답 6분 없음) GW부터 다시
//  그 밖의 시간: 창 없이 30초마다 확인 → 요청이 오면 그때 창을 열고, 끝나면 닫음 (필요할 때만)
//  시트가 새 Apps Script(?ver=1 지원)면 버전만 가볍게 묻고 바뀌었을 때만 전체를 받음
//  창이 없어도 크롬이 꺼지지 않게 manifest에 "background" 권한 (크롬 설정 "백그라운드 앱 계속 실행" 켜짐 필요)
importScripts("common.js");
const get = (k) => chrome.storage.local.get(k);
const put = (o) => chrome.storage.local.set(o);
const log = async (msg) => { const { logs = [] } = await get("logs"); logs.unshift(`${new Date().toLocaleString("ko-KR")} ${msg}`); await put({ logs: logs.slice(0, 30) }); };
const pad = (n) => String(n).padStart(2, "0");
const orderHours = (d = new Date()) => { if (self.__forceFast) return true; const h = d.getHours() + d.getMinutes() / 60; return h >= 8 && h < 22; }; // 매장 시간(매일 08~22시)엔 10초마다
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function openWin(reason, manual, job = "order") {
  const win = await chrome.windows.create({ url: GW_URL, state: manual ? "normal" : "minimized", focused: !!manual });
  const tab = win.tabs[0];
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}); // 메모리 절약 모드가 탭을 잠재우지 않게
  await put({ tabId: tab.id, openedAt: Date.now(), manual: !!manual, job });
  await log(reason);
  return tab;
}
async function closeWin(reason) {
  const { tabId } = await get("tabId");
  await chrome.storage.local.remove(["tabId", "openedAt", "manual", "job"]);
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (tab) { const w = await chrome.windows.get(tab.windowId, { populate: true }).catch(() => null); if (w && w.tabs.length === 1) chrome.windows.remove(w.id).catch(() => {}); else chrome.tabs.remove(tab.id).catch(() => {}); }
  await log(reason);
}

// 열린 대기 창(MIS 첫 화면) 안에서 스크립트 실행 (페이지 쪽)
const inTab = (tabId, func, args = []) => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "MAIN", func, args }).catch(() => null);
const addScript = (url) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = url; (document.body || document.documentElement).appendChild(s); };
let lastVer = null, hasVer = null, lastData = null;

async function tick(reason) {
  const { on, tabId, openedAt = 0, manual, job = "order", lastPoll = 0, lastBeat = 0, tried = {}, kicked = {}, warmAt = 0 } = await get(["on", "tabId", "openedAt", "manual", "job", "lastPoll", "lastBeat", "tried", "kicked", "warmAt"]);
  if (!on) return;
  const now = Date.now(), hours = orderHours();
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab && tabId != null) await chrome.storage.local.remove(["tabId", "openedAt", "manual", "job"]);
  if ((reason === "alarm" || reason === "fast") && now - lastPoll < (reason === "fast" ? 2500 : 25e3)) return;
  await put({ lastPoll: now });
  // 매장 시간인데 대기 창이 없으면 미리 열어 둠 (실패 반복 막으려고 10분에 한 번까지)
  if (hours && !tab && now - warmAt > 10 * 60e3) { await put({ warmAt: now }); await openWin("매장 시간 · MIS 대기 창 열기", false, "warm"); return; }
  let d;
  try {
    // 새 Apps Script면 버전만 물어봄 (가벼움) → 바뀐 게 없으면 전에 받은 내용 그대로
    if (hasVer !== false) { const v = await (await fetch(API + "?api=1&ver=1&t=" + now)).json(); if (v && v.ver) { hasVer = true; if (v.ver === lastVer && lastData) d = lastData; else lastVer = v.ver; } else { hasVer = false; if (v && v.data && Object.keys(v.data).length) d = lastData = v.data; } }
    if (!d) { d = (await (await fetch(API + "?api=1&t=" + now)).json()).data || {}; lastData = d; }
  } catch (e) { return; } // 인터넷·VPN 끊김: 다음에 다시
  // 폰에 "PC 대기 중"으로 보이게 10분마다 기록 (창이 열려 있을 땐 자동 대기가 2분마다 따로 적음)
  if (!tab && now - lastBeat > 10 * 60e3) { await put({ lastBeat: now }); fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key: "misAgent", value: { at: now, mode: "ondemand", ver: chrome.runtime.getManifest().version } }) }).catch(() => {}); }
  const p = d.misPush || {}, mine = p.date === ymd();
  const waiting = mine && p.status === "pending";
  // 매출 가져오기 요청 (Forecast 탭 [GW에서 가져오기]): 30분 안에 누른 것만
  const sp = d.salesPush || {}, salesWaiting = sp.status === "pending" && now - (sp.at || 0) < 30 * 60e3;
  if (!tab) {
    const req = waiting ? { id: p.id, job: "order", msg: "폰 전송 받음 → GW·MIS 열기" } : salesWaiting ? { id: "s" + sp.id, job: "sales", msg: "매출 가져오기 받음 → GW·MIS 열기" } : null;
    if (!req) return;
    if ((tried[req.id] || 0) >= 2) return; // 같은 요청은 두 번까지만 (로그인 실패 반복 방지)
    tried[req.id] = (tried[req.id] || 0) + 1; await put({ tried: Object.fromEntries(Object.entries(tried).slice(-10)) });
    await openWin(`${req.msg}${tried[req.id] > 1 ? " (다시 시도)" : ""}`, false, req.job);
    return;
  }
  if (manual) return; // [자동 탭 보기]로 연 창은 사람이 닫음
  if (job === "warm") {
    // 대기 창: 열린 MIS에서 바로 실행
    // MIS 첫 화면이 다 열리고 자동 대기가 켜진 뒤에만 (크롬이 막 켜졌을 땐 자동 대기가 켜지면서 스스로 처리)
    const ready = /mis\.madforgarlic/.test(tab.url || "") && ((d.misAgent || {}).at || 0) > openedAt;
    if (ready && waiting && kicked.o !== p.id) { await put({ kicked: { ...kicked, o: p.id } }); await inTab(tab.id, () => window.__misKick && window.__misKick()); await log("폰 전송 → 대기 창에서 바로 입력"); }
    if (ready && salesWaiting && kicked.s !== sp.id) { await put({ kicked: { ...kicked, s: sp.id } }); await inTab(tab.id, addScript, ["https://mfgkorea.github.io/label-list/mis-sales.js?quiet=1&t=" + now]); await log("Gross 불러오기 → 대기 창에서 바로 조회"); }
    // 로그인 풀림 등으로 자동 대기 응답이 6분 넘게 없으면 GW부터 다시
    const at = (d.misAgent || {}).at || 0;
    if (now - openedAt > 6 * 60e3 && now - at > 6 * 60e3) { await put({ openedAt: now }); chrome.tabs.update(tab.id, { url: GW_URL }); await log("대기 창 응답 없음 → GW부터 다시"); }
    if (!hours && !waiting && !salesWaiting && !(mine && p.status === "running") && sp.status !== "running") await closeWin("매장 시간 끝 → 대기 창 닫음"); // 어제 날짜 running은 무시
    return;
  }
  if (job === "sales") { if (/done|error/.test(sp.status) && (sp.doneAt || 0) > openedAt) await closeWin(`매출 ${sp.status === "done" ? "가져옴" : "못 가져옴"} → 창 닫음`); else if (now - openedAt > 12 * 60e3) await closeWin("12분 안에 못 끝냄 → 창 닫음 (기록 확인)"); return; }
  if (mine && /done|error/.test(p.status) && (p.doneAt || 0) > openedAt) { await closeWin(`입력 ${p.status === "done" ? "완료" : "확인 필요"} → 창 닫음`); return; }
  if (now - openedAt > 12 * 60e3) await closeWin("12분 안에 못 끝냄 → 창 닫음 (기록 확인)");
}

chrome.runtime.onStartup.addListener(() => tick("start"));
chrome.runtime.onInstalled.addListener(() => tick("start"));
chrome.alarms.create("watch", { periodInMinutes: 0.5 }); // 크롬이 허락하는 가장 짧은 간격(30초)
chrome.alarms.onAlarm.addListener(() => { tick("alarm"); fast(); });
// 발주 시간엔 10초마다: 크롬 알람은 30초가 최소라 배경이 깨어 있는 동안 10초 타이머로 더 자주 봄 (배경이 잠들면 30초 알람이 다시 깨움)
let fastOn = false;
function fast() {
  if (fastOn) return; fastOn = true;
  // 버전만 물어볼 수 있으면 3초, 아니면 5초마다 (전체를 받아야 해서)
  const gap = () => (hasVer ? 3e3 : 5e3);
  const step = async () => { if (!orderHours()) { fastOn = false; return; } await tick("fast").catch(() => {}); setTimeout(step, gap()); };
  setTimeout(step, gap());
}
fast();
// GW 경영정보가 MIS를 새 탭(창)으로 열면 그 탭을 자동 탭으로 넘겨받고, GW 탭은 닫음 (탭이 쌓이지 않게)
async function adopt(newId, fromId) {
  const { tabId, on } = await get(["tabId", "on"]);
  if (!on || fromId == null || fromId !== tabId || newId === tabId) return;
  const tab = await chrome.tabs.get(newId).catch(() => null); if (!tab) return;
  await put({ tabId: tab.id });
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  // GW가 MIS를 새 탭·새 창으로 열면 그 탭도 최소화된 자기 창으로
  const w = await chrome.windows.get(tab.windowId, { populate: true }).catch(() => null);
  const { manual } = await get("manual");
  if (!manual) { if (w && w.tabs.length === 1) chrome.windows.update(w.id, { state: "minimized" }).catch(() => {}); else chrome.windows.create({ tabId: tab.id, state: "minimized", focused: false }).catch(() => {}); }
  setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 5000);
  await log("MIS 새 탭을 자동 탭으로");
}
chrome.tabs.onCreated.addListener((tab) => adopt(tab.id, tab.openerTabId));
// 자동 창에서는 GW·MIS 알림창(alert)·확인창(confirm)이 사람 없이 멈추게 함 (예: 일요일 "주문 가능 시간이 아닙니다")
//  → 페이지가 뜨자마자 그 창의 모든 프레임에서 알림창을 기록만 하고 넘김, 확인창은 "예"
//  사람이 직접 연 창([MIS 직접 열어 보기])과 다른 크롬 창에는 안 함
chrome.webNavigation.onCommitted.addListener(async (d) => {
  const { tabId, manual } = await get(["tabId", "manual"]);
  if (d.tabId !== tabId || manual || !/madforgarlic\.com/.test(d.url)) return;
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
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => adopt(d.tabId, d.sourceTabId)); // window.open·새 창도 확실히 잡음
chrome.tabs.onRemoved.addListener(async (id) => { const { tabId } = await get("tabId"); if (id === tabId) await chrome.storage.local.remove(["tabId", "openedAt", "manual", "job"]); }); // 닫으면 (매장 시간엔 10분 뒤 대기 창을 다시 엶)

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const { tabId, on } = await get(["tabId", "on"]);
    if (m.q === "managed") { const { job = "order" } = await get("job"); return reply({ managed: !!on && sender.tab && sender.tab.id === tabId, job }); }
    if (m.q === "startSales") { // MIS 첫 화면 → 매출 가져오기 스크립트(GitHub에서 매번 새로 받음)를 페이지 쪽에 넣음
      await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: "MAIN",
        func: (url) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = url; (document.body || document.documentElement).appendChild(s); },
        args: ["https://mfgkorea.github.io/label-list/mis-sales.js?quiet=1&t=" + Date.now()],
      }).then(() => log("MIS 첫 화면 · 매출 가져오기 시작"), (e) => log("매출 가져오기 못 켬: " + e.message));
      return reply({});
    }
    if (m.q === "log") { await log(m.msg); return reply({}); }
    if (m.q === "started") {
      await put({ tries: [] });
      await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: "MAIN",
        func: (url) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = url; (document.body || document.documentElement).appendChild(s); },
        args: ["https://mfgkorea.github.io/label-list/mis-agent.js?quiet=1" + ((await get("job")).job === "warm" ? "&warm=1" : "") + "&t=" + Date.now()],
      }).then(() => log("주문등록 화면 · 자동 대기 켬"), (e) => log("자동 대기 못 켬: " + e.message));
      return reply({});
    }
    if (m.q === "toGw") { if (sender.tab) chrome.tabs.update(sender.tab.id, { url: GW_URL }); return reply({}); }
    if (m.q === "ensure") { await tick("save"); return reply({}); }
    if (m.q === "show") { // [자동 창 보기]: 열려 있으면 앞으로, 없으면 사람이 보는 창으로 열기(자동으로 안 닫힘)
      const { tabId: id } = await get("tabId"), tab = id != null ? await chrome.tabs.get(id).catch(() => null) : null;
      if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { state: "normal", focused: true }); }
      else await openWin("직접 열기 (자동 창 보기)", true);
      return reply({});
    }
    reply({});
  })();
  return true;
});
