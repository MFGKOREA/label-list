// 배경: 자동입력을 켜 두면 MIS 탭 하나를 "자동 탭"으로 맡아 둠
//  크롬이 켜질 때·5분마다: 자동 탭이 없으면 새로 열고, 시트의 살아 있음(misAgent)이 10분 넘게 끊기면 그 탭을 새로고침
importScripts("common.js");
const get = (k) => chrome.storage.local.get(k);
const log = async (msg) => { const { logs = [] } = await get("logs"); logs.unshift(`${new Date().toLocaleString("ko-KR")} ${msg}`); await chrome.storage.local.set({ logs: logs.slice(0, 30) }); };

async function ensure(reason) {
  const { on, tabId } = await get(["on", "tabId"]);
  if (!on) return;
  let tab = null;
  if (tabId != null) tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    tab = await chrome.tabs.create({ url: MIS_URL, pinned: true, active: false });
    chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}); // 메모리 절약 모드가 탭을 잠재우지 않게
    await chrome.storage.local.set({ tabId: tab.id });
    await log(`MIS 자동 탭 열기 (${reason})`);
    return;
  }
  // 살아 있음 확인: 자동 대기가 2분마다 시트 misAgent.at을 적음
  try {
    const d = (await (await fetch(API + "?api=1&t=" + Date.now())).json()).data || {};
    const at = (d.misAgent || {}).at || 0, { startedAt = 0 } = await get("startedAt");
    if (Date.now() - at > 10 * 60e3 && Date.now() - startedAt > 10 * 60e3) {
      await chrome.storage.local.set({ startedAt: Date.now() });
      await chrome.tabs.update(tab.id, { url: MIS_URL });
      await log("자동 대기 응답 없음 → MIS 다시 열기");
    }
  } catch (e) { /* 인터넷·VPN 끊김: 다음 확인 때 다시 */ }
}

chrome.runtime.onStartup.addListener(() => ensure("크롬 시작"));
chrome.runtime.onInstalled.addListener(() => ensure("설치"));
chrome.alarms.create("watch", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(() => ensure("5분 확인"));
chrome.tabs.onRemoved.addListener(async (id) => { const { tabId } = await get("tabId"); if (id === tabId) { await chrome.storage.local.remove("tabId"); setTimeout(() => ensure("탭 닫힘"), 3000); } });

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const { tabId, on } = await get(["tabId", "on"]);
    if (m.q === "managed") return reply({ managed: !!on && sender.tab && sender.tab.id === tabId });
    if (m.q === "log") { await log(m.msg); return reply({}); }
    if (m.q === "started") {
      await chrome.storage.local.set({ startedAt: Date.now(), tries: [] });
      await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: "MAIN",
        func: (url) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = url; (document.body || document.documentElement).appendChild(s); },
        args: ["https://mfgkorea.github.io/label-list/mis-agent.js?quiet=1&t=" + Date.now()],
      }).then(() => log("주문등록 화면 · 자동 대기 켬"), (e) => log("자동 대기 못 켬: " + e.message));
      return reply({});
    }
    if (m.q === "toMis") { if (sender.tab) chrome.tabs.update(sender.tab.id, { url: MIS_URL }); return reply({}); }
    if (m.q === "ensure") { await ensure("설정 저장"); return reply({}); }
    reply({});
  })();
  return true;
});
