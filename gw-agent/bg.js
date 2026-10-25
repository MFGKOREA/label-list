// 배경: 평소엔 창 없이 조용히 있다가, 폰에서 [GW 전송]을 누르면 그때만 MIS를 엶 (필요할 때만)
//  발주 시간(08:00~14:35, 일요일 제외)엔 10초마다, 그 밖엔 30초마다 시트 misPush를 확인 → 폰에서 누르면 10~30초 안에 창이 열림
//  → 오늘 전송 요청(pending)이 있으면 최소화된 창으로 GW 로그인 → 경영정보 → MIS 주문등록 → 자동 대기가 입력·저장
//  → 결과(done/error)가 적히면 창을 닫음. 12분 안에 못 끝내면 닫고 같은 요청은 한 번만 다시 시도
//  창이 없어도 크롬이 꺼지지 않게 manifest에 "background" 권한 (크롬 설정 "백그라운드 앱 계속 실행" 켜짐 필요)
importScripts("common.js");
const get = (k) => chrome.storage.local.get(k);
const put = (o) => chrome.storage.local.set(o);
const log = async (msg) => { const { logs = [] } = await get("logs"); logs.unshift(`${new Date().toLocaleString("ko-KR")} ${msg}`); await put({ logs: logs.slice(0, 30) }); };
const pad = (n) => String(n).padStart(2, "0");
const orderHours = (d = new Date()) => { if (self.__forceFast) return true; const h = d.getHours() + d.getMinutes() / 60; return d.getDay() !== 0 && h >= 8 && h < 14.6; };
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function openWin(reason, manual) {
  const win = await chrome.windows.create({ url: GW_URL, state: manual ? "normal" : "minimized", focused: !!manual });
  const tab = win.tabs[0];
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}); // 메모리 절약 모드가 탭을 잠재우지 않게
  await put({ tabId: tab.id, openedAt: Date.now(), manual: !!manual });
  await log(reason);
  return tab;
}
async function closeWin(reason) {
  const { tabId } = await get("tabId");
  await chrome.storage.local.remove(["tabId", "openedAt", "manual"]);
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (tab) { const w = await chrome.windows.get(tab.windowId, { populate: true }).catch(() => null); if (w && w.tabs.length === 1) chrome.windows.remove(w.id).catch(() => {}); else chrome.tabs.remove(tab.id).catch(() => {}); }
  await log(reason);
}

async function tick(reason) {
  const { on, tabId, openedAt = 0, manual, lastPoll = 0, lastBeat = 0, tried = {} } = await get(["on", "tabId", "openedAt", "manual", "lastPoll", "lastBeat", "tried"]);
  if (!on) return;
  const now = Date.now();
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab && tabId != null) await chrome.storage.local.remove(["tabId", "openedAt", "manual"]);
  if (!tab && (reason === "alarm" || reason === "fast") && now - lastPoll < (reason === "fast" ? 8e3 : 25e3)) return;
  await put({ lastPoll: now });
  let d;
  try { d = (await (await fetch(API + "?api=1&t=" + now)).json()).data || {}; } catch (e) { return; } // 인터넷·VPN 끊김: 다음에 다시
  // 폰에 "PC 대기 중"으로 보이게 10분마다 기록 (창이 열려 있을 땐 자동 대기가 2분마다 따로 적음)
  if (!tab && now - lastBeat > 10 * 60e3) { await put({ lastBeat: now }); fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key: "misAgent", value: { at: now, mode: "ondemand", ver: "bg1.3" } }) }).catch(() => {}); }
  const p = d.misPush || {}, mine = p.date === ymd();
  const waiting = mine && p.status === "pending";
  if (!tab) {
    if (!waiting) return;
    if ((tried[p.id] || 0) >= 2) return; // 같은 요청은 두 번까지만 (로그인 실패 반복 방지)
    tried[p.id] = (tried[p.id] || 0) + 1; await put({ tried: Object.fromEntries(Object.entries(tried).slice(-10)) });
    await openWin(`폰 전송 받음 → GW·MIS 열기${tried[p.id] > 1 ? " (다시 시도)" : ""}`);
    return;
  }
  if (manual) return; // [자동 탭 보기]로 연 창은 사람이 닫음
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
  const step = async () => { if (!orderHours()) { fastOn = false; return; } await tick("fast").catch(() => {}); setTimeout(step, 10e3); };
  setTimeout(step, 10e3);
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
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => adopt(d.tabId, d.sourceTabId)); // window.open·새 창도 확실히 잡음
chrome.tabs.onRemoved.addListener(async (id) => { const { tabId } = await get("tabId"); if (id === tabId) await chrome.storage.local.remove(["tabId", "openedAt", "manual"]); }); // 닫으면 다시 안 엶

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const { tabId, on } = await get(["tabId", "on"]);
    if (m.q === "managed") return reply({ managed: !!on && sender.tab && sender.tab.id === tabId });
    if (m.q === "log") { await log(m.msg); return reply({}); }
    if (m.q === "started") {
      await put({ tries: [] });
      await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: "MAIN",
        func: (url) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = url; (document.body || document.documentElement).appendChild(s); },
        args: ["https://mfgkorea.github.io/label-list/mis-agent.js?quiet=1&t=" + Date.now()],
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
