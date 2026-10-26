// MIS 자동 대기: PC의 MIS [주문등록] 화면에서 북마크로 한 번 켜 두면, 폰 발주앱의 [MIS로 보내기]를 기다렸다가 자동으로 넣고 저장
//  1) 20초마다 시트의 전송 상태만 가볍게 확인(?api=1&status=1 — 품목·수량은 안 받음) → misPush(오늘 날짜·pending)가 있으면 mis.js의 입력·저장을 확인창 없이 실행 (이때만 전체를 받음)
//  2) 결과(완료/확인 필요)를 misPush에 적어 폰에서 보이게, 2분마다 misAgent에 "살아 있음" 기록
//  3) MIS 로그인이 풀리지 않게 10분마다 MIS 화면을 가볍게 다시 불러옴 (읽기만)
//  이 탭을 닫거나 새로고침하면 꺼짐 → 북마크를 다시 누르면 됨
//  크롬 확장(gw-agent)이 켤 때는 ?quiet=1 → 알림창 없이, 주문등록 화면이 2분 넘게 안 보이면 새로고침(로그인 풀림 → 확장이 다시 로그인)
(() => {
  const QUIET = /[?&]quiet=1/.test((document.currentScript || {}).src || "");
  const WARM = /[?&]warm=1/.test((document.currentScript || {}).src || ""); // 확장 대기 창: 확장이 요청을 보면 바로 깨움(__misKick), 스스로는 1분마다만
  const say = (m) => { if (!QUIET) alert(m); };
  const API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec";
  const VER = "4";
  const ME = Math.random().toString(36).slice(2, 8); // 이 탭 이름 (탭 2개가 같이 받을 때 하나만 하게)
  if (window.__misAgent) { say("이미 자동 대기 중이에요. (이 탭을 닫지 마세요)"); return; }
  window.__misAgent = true;
  window.__misAgentMode = true;
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // MIS 탭(주문현황·주문등록 …)마다 프레임이 있고 주문현황에도 dataGrid1이 있음 → 주문그룹 버튼(#custBtn)이 있는 주문등록 프레임을 고름
  const find = (top) => {
    const all = [];
    const walk = (w) => { try { if (w.jQuery && w.document.getElementById("dataGrid1")) all.push(w); for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]); } catch (e) {} };
    walk(top);
    const has = (w, sel) => { try { return !!w.document.querySelector(sel); } catch (e) { return false; } };
    return all.find((w) => has(w, "#custBtn input.btn_basic")) || all.find((w) => typeof w.fn_Save === "function" && has(w, "#custBtn")) || all.find((w) => typeof w.fn_Save === "function") || all[0] || null;
  };
  // 가게 키: 확장이 넣어 줄 땐 주소의 k=, 북마크로 켤 땐 이 MIS 브라우저에 저장해 둔 값 (시트가 잠겨 있으면 필요)
  const KEY = (() => { let k = ""; try { k = new URL(document.currentScript.src).searchParams.get("k") || ""; } catch (e) {} try { if (k) localStorage.setItem("orderAppKey", k); else k = localStorage.getItem("orderAppKey") || ""; } catch (e) {} return k; })();
  const withKey = (u) => u + (KEY ? "&k=" + encodeURIComponent(KEY) : "");
  // 가벼운 확인: 상태만(품목·수량 없음) 받고, 맡은 뒤에만 전체를 받음 → 20초마다 시트 전체를 읽지 않음
  //  시트 스크립트가 아직 status=1을 모르면(옛 것) 예전처럼 전체를 받아 씀
  const get = async () => {
    const s = await (await fetch(withKey(API + "?api=1&status=1&t=" + Date.now()))).json();
    if (s && s.status) return s.status;
    if (s && s.ok && s.data) return s.data; // 옛 스크립트는 status=1에도 전체를 줌 → 그대로 씀 (예전엔 한 번 더 받아서 2초 낭비)
    const j = await (await fetch(withKey(API + "?api=1&t=" + Date.now()))).json();
    if (!j.ok && j.auth) { state = "가게 키 필요 (확장 창에서 입력)"; throw new Error("auth"); }
    return j.data || {};
  };
  const getFull = async () => { const j = await (await fetch(withKey(API + "?api=1&t=" + Date.now()))).json(); if (!j.ok && j.auth) { state = "가게 키 필요 (확장 창에서 입력)"; throw new Error("auth"); } return j.data || {}; };
  const set = (key, value) => fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key, value, k: KEY }) });

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

  let busy = false, beatAt = 0, aliveAt = Date.now(), miss = 0;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const db = await get(); last = Date.now();
      const p = db.misPush, W = find(window.top);
      // 대기 창(1분 확인)에서도 2분마다 기록되게 (3분이면 폰이 "연결 안 됨"으로 깜빡임)
      if (Date.now() - beatAt >= 110000) { beatAt = Date.now(); set("misAgent", { at: Date.now(), grid: !!W, ver: VER, auto: QUIET }).catch(() => {}); }
      miss = W ? 0 : miss + 1;
      if (QUIET && miss >= 6) { location.reload(); return; }
      if (p && p.date === today() && p.status === "pending") {
        // 맡았다고 적고 3초 뒤 다시 읽어 내 이름이 남아 있을 때만 실행 (다른 탭이 맡았으면 넘김) — 여기서만 전체를 읽음
        await set("misPush", { ...p, status: "running", startAt: Date.now(), by: ME });
        const filling = loadFill().catch(() => {}); // 고친 mis.js를 매번 새로 받아서 씀 (북마크 다시 안 눌러도 됨) — 확인 기다리는 동안 미리 받음
        await new Promise((ok) => setTimeout(ok, 1200));
        const q = (await get()).misPush || {}; // 상태(id·by)만 보면 됨 → 가벼운 확인으로
        if (q.by !== ME || q.id !== p.id) return;
        state = "MIS 입력 중"; badge();
        let r;
        await filling;
        try { r = await window.__misFill(true); } catch (e) { r = { ok: false, text: "중간에 멈춤: " + (e && e.message ? e.message : e) }; }
        if (!r) r = { ok: false, text: "실행 안 됨" };
        if (/이미 입력 중/.test(r.text || "")) { await set("misPush", { ...p, status: "pending" }); state = "대기 중"; return; } // 다른 입력이 끝나면 다음 확인 때 다시
        await set("misPush", { ...p, status: r.ok ? "done" : "error", doneAt: Date.now(), text: r.text, saved: r.saved, total: r.total });
        state = r.ok ? `${hm(Date.now())} 저장 완료` : `${hm(Date.now())} 확인 필요`;
      }
      // MIS 로그인 유지: 10분마다 지금 화면 주소를 다시 요청 (화면은 안 바뀜)
      if (W && Date.now() - aliveAt > 600000) { aliveAt = Date.now(); fetch(W.location.href, { credentials: "include" }).catch(() => {}); }
      if (state === "대기 중" || /완료|확인 필요/.test(state)) badge();
    } catch (e) {
      if (e.message !== "auth") state = "시트 연결 안 됨"; badge();
    } finally { busy = false; }
  };

  function loadFill() {
    return new Promise((ok, no) => {
      const s = document.createElement("script");
      s.charset = "utf-8";
      s.src = withKey("https://mfgkorea.github.io/label-list/mis.js?agent=1&t=" + Date.now());
      s.onload = () => { s.remove(); ok(); };
      s.onerror = () => { s.remove(); no(new Error("load")); };
      (document.body || document.documentElement).appendChild(s);
    });
  }
  loadFill().then(
    () => { badge(); tick(); setInterval(tick, WARM ? 60000 : 20000); window.__misKick = () => tick(); say("발주앱 자동 대기를 켰어요.\n이 탭은 주문등록 화면으로 열어 두세요 (닫거나 새로고침하면 꺼져요)."); },
    () => { window.__misAgent = false; say("자동입력 스크립트를 못 불러왔어요. 인터넷 연결을 확인해 주세요."); });
})();
