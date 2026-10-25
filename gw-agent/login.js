// 자동 탭 로그인 흐름: GW 로그인 → GW 경영정보 → MIS (MIS에 바로 로그인하면 주문등록이 안 보여서 꼭 GW를 거침)
//  - MIS 로그인 화면이 뜨면(로그인 풀림) → GW로 보냄
//  - GW 로그인 화면이면 저장해 둔 아이디·비밀번호로 로그인 (30분에 2번까지만 → 계정 잠김 방지)
//  - GW에 로그인된 화면이면 왼쪽 메뉴 "경영정보"를 눌러 MIS를 엶 (새 탭으로 열리면 배경이 그 탭을 자동 탭으로 넘겨받음)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.offsetParent !== null && !el.disabled;
  const say = (msg) => chrome.runtime.sendMessage({ q: "log", msg });
  let pw = null;
  for (let t = 0; t < 5 && !visible(pw); t++) { pw = [...document.querySelectorAll('input[type="password"]')].find(visible) || null; if (!pw) await sleep(200); }
  const managed = await chrome.runtime.sendMessage({ q: "managed" }).then((r) => r && r.managed, () => false);
  if (!managed) return;
  const onGw = location.host.startsWith("gw.");
  if (!onGw) { if (pw) { say("MIS 로그인 화면 → GW로 다시 들어감"); chrome.runtime.sendMessage({ q: "toGw" }); } return; }
  if (!pw) { if (window === window.top) openMis(); return; }
  const cfg = await chrome.storage.local.get(["id", "pw", "tries"]);
  if (!cfg.pw) { say("비밀번호가 저장 안 돼 있어 로그인 못 함"); return; }
  const now = Date.now(), tries = (cfg.tries || []).filter((t) => now - t < 30 * 60e3);
  if (tries.length >= 2) { say("GW 로그인 2번 실패 · 30분 쉬고 다시 (비밀번호 확인)"); return; }
  tries.push(now); await chrome.storage.local.set({ tries });
  const setV = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const ids = [...document.querySelectorAll("input")].filter((i) => visible(i) && /^(text|email|)$/i.test(i.getAttribute("type") || "") && (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING));
  const idIn = ids.pop();
  if (idIn && cfg.id) setV(idIn, cfg.id);
  setV(pw, cfg.pw);
  await sleep(150);
  const btn = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="image"], a')].find((b) => visible(b) && /log\s*in|로그인/i.test(b.textContent || b.value || b.alt || ""));
  if (btn) btn.click();
  else if (pw.form) (pw.form.requestSubmit ? pw.form.requestSubmit() : pw.form.submit());
  else ["keydown", "keypress", "keyup"].forEach((type) => pw.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })));
  say("GW 로그인 시도");

  async function openMis() {
    const frames = () => { const out = []; const walk = (w) => { try { void w.document; out.push(w); } catch (e) { return; } for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]); }; walk(window); return out; };
    // 메뉴가 접혀 있으면(아이콘만) 글자가 숨어 있음 → 숨은 것도 찾되 보이는 걸 먼저. title·툴팁 글자, MIS 주소 링크도 봄
    const find = () => {
      const hits = [];
      for (const w of frames()) {
        try {
          const d = w.document;
          d.querySelectorAll("a, span, li, div, button, p, em, strong, i").forEach((e) => {
            const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
            if (own === "경영정보" || (e.getAttribute("title") || "").trim() === "경영정보" || (e.getAttribute("aria-label") || "").trim() === "경영정보") hits.push(e);
          });
          d.querySelectorAll('a[href*="mis.madforgarlic"]').forEach((e) => hits.push(e));
        } catch (e) {}
      }
      return hits.sort((a, b) => visible(b) - visible(a))[0] || null;
    };
    let el = null;
    for (let t = 0; t < 60 && !el; t++) { el = find(); if (!el) await sleep(250); }
    if (!el) { say("GW에서 '경영정보' 메뉴를 못 찾음"); return; }
    const target = el.closest("a, button, li, [onclick]") || el;
    target.click();
    say(`GW → 경영정보(MIS) 열기 (${visible(el) ? "보이는 메뉴" : "접힌 메뉴"} · ${target.tagName.toLowerCase()})`);
  }
})();
