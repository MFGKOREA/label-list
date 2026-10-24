// MIS 자동 대기: PC의 MIS [주문등록] 화면에서 북마크로 한 번 켜 두면, 폰 발주앱의 [MIS로 보내기]를 기다렸다가 자동으로 넣고 저장
//  1) 20초마다 구글 시트의 misPush(오늘 날짜·pending)를 확인 → 있으면 mis.js의 입력·저장을 확인창 없이 실행
//  2) 결과(완료/확인 필요)를 misPush에 적어 폰에서 보이게, 2분마다 misAgent에 "살아 있음" 기록
//  3) MIS 로그인이 풀리지 않게 10분마다 MIS 화면을 가볍게 다시 불러옴 (읽기만)
//  이 탭을 닫거나 새로고침하면 꺼짐 → 북마크를 다시 누르면 됨
(() => {
  const API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec";
  const VER = "1";
  if (window.__misAgent) { alert("이미 자동 대기 중이에요. (이 탭을 닫지 마세요)"); return; }
  window.__misAgent = true;
  window.__misAgentMode = true;
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const find = (w) => {
    try { if (w.jQuery && w.document.getElementById("dataGrid1")) return w; } catch (e) { return null; }
    for (let i = 0; i < w.frames.length; i++) { const r = find(w.frames[i]); if (r) return r; }
    return null;
  };
  const get = async () => (await (await fetch(API + "?api=1&t=" + Date.now())).json()).data || {};
  const set = (key, value) => fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key, value }) });

  // 화면 표시: 탭 제목 앞에 [자동대기], 주문등록 화면 오른쪽 아래에 상태 배지
  const baseTitle = document.title.replace(/^\[[^\]]*\]\s*/, "");
  let state = "대기 중", last = 0;
  const badge = () => {
    document.title = `[자동대기] ${baseTitle}`;
    const W = find(window.top), doc = W ? W.document : document;
    let el = doc.getElementById("appAgentBadge");
    if (!el && doc.body && doc.body.tagName === "BODY") {
      el = doc.createElement("div"); el.id = "appAgentBadge";
      el.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;background:#222;color:#fff;font:700 12px/1.4 sans-serif;padding:8px 12px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.25);pointer-events:none";
      doc.body.appendChild(el);
    }
    if (el) el.textContent = `발주앱 자동입력 · ${state}${last ? ` · ${hm(last)} 확인` : ""}${W ? "" : " · 주문등록 화면 아님"}`;
  };

  let busy = false, beatAt = 0, aliveAt = Date.now();
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const db = await get(); last = Date.now();
      const p = db.misPush, W = find(window.top);
      if (Date.now() - beatAt > 120000) { beatAt = Date.now(); set("misAgent", { at: Date.now(), grid: !!W, ver: VER }).catch(() => {}); }
      if (p && p.date === today() && p.status === "pending") {
        state = "MIS 입력 중"; badge();
        await set("misPush", { ...p, status: "running", startAt: Date.now() });
        let r;
        try { r = await window.__misFill(true); } catch (e) { r = { ok: false, text: "중간에 멈춤: " + (e && e.message ? e.message : e) }; }
        if (!r) r = { ok: false, text: "실행 안 됨" };
        await set("misPush", { ...p, status: r.ok ? "done" : "error", doneAt: Date.now(), text: r.text, saved: r.saved, total: r.total });
        state = r.ok ? `${hm(Date.now())} 저장 완료` : `${hm(Date.now())} 확인 필요`;
      }
      // MIS 로그인 유지: 10분마다 지금 화면 주소를 다시 요청 (화면은 안 바뀜)
      if (W && Date.now() - aliveAt > 600000) { aliveAt = Date.now(); fetch(W.location.href, { credentials: "include" }).catch(() => {}); }
      if (state === "대기 중" || /완료|확인 필요/.test(state)) badge();
    } catch (e) {
      state = "시트 연결 안 됨"; badge();
    } finally { busy = false; }
  };

  const s = document.createElement("script");
  s.charset = "utf-8";
  s.src = "https://mfgkorea.github.io/label-list/mis.js?t=" + Date.now();
  s.onload = () => { badge(); tick(); setInterval(tick, 20000); alert("발주앱 자동 대기를 켰어요.\n이 탭은 주문등록 화면으로 열어 두세요 (닫거나 새로고침하면 꺼져요)."); };
  s.onerror = () => { window.__misAgent = false; alert("자동입력 스크립트를 못 불러왔어요. 인터넷 연결을 확인해 주세요."); };
  (document.body || document.documentElement).appendChild(s);
})();
