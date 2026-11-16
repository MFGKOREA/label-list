// MFG HR Board ↔ GW Agent 다리 (1.12.0) — hr-board-teal.vercel.app 화면에 들어감
//  보드 → 확장: window.postMessage({ type: "MFG_HR_SEND", requestId, dept, weekStart, weekEnd, mode, employees }, location.origin)
//  확장 → 보드: { type: "MFG_HR_AGENT_READY", ver } (열릴 때·MFG_HR_PING에 대답)
//               { type: "MFG_HR_SEND_ACK", requestId, ok, error? } (받았음)
//               { type: "MFG_HR_SEND_PROGRESS", requestId, item: { t, stage, day, msg } } (단계마다)
//               { type: "MFG_HR_SEND_RESULT" | "MFG_HR_PUBLISH_RESULT", requestId, ok, stage, … } (끝)
//  같은 창(window)·같은 주소(origin)에서 온 메시지만 받음
(() => {
  if (window.__gwHrBoard) return; window.__gwHrBoard = 1;
  const O = location.origin, ver = chrome.runtime.getManifest().version;
  const out = (o) => window.postMessage(o, O);
  out({ type: "MFG_HR_AGENT_READY", ver });
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== O) return;
    const d = e.data || {};
    if (d.type === "MFG_HR_PING") return out({ type: "MFG_HR_AGENT_READY", ver });
    if (d.type === "MFG_HR_SEND_STATUS") { chrome.runtime.sendMessage({ q: "hrSendLast", requestId: String(d.requestId || "") }).then((r) => out({ type: "MFG_HR_SEND_STATUS_RESULT", requestId: d.requestId, run: r && r.run, result: r && r.last })).catch(() => {}); return; }
    if (d.type !== "MFG_HR_SEND" && d.type !== "MFG_HR_PUBLISH") return; // PUBLISH = 매장 전체 공지·확정 (BOH·FOH 저장 뒤)
    const req = JSON.parse(JSON.stringify(d)); // 모양만 복사(함수·DOM 제외)
    chrome.runtime.sendMessage({ q: d.type === "MFG_HR_PUBLISH" ? "hrPublish" : "hrSend", req }).then((r) => out({ type: "MFG_HR_SEND_ACK", requestId: d.requestId, ok: !!(r && r.ok), error: r && r.error, ver: r && r.ver }))
      .catch((err) => out({ type: "MFG_HR_SEND_ACK", requestId: d.requestId, ok: false, error: "확장에 못 보냄: " + String((err && err.message) || err) }));
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.q === "hrSendProgress") out({ type: "MFG_HR_SEND_PROGRESS", requestId: m.requestId, item: m.item });
    if (m && m.q === "hrSendResult") out(m.res);
  });
})();
