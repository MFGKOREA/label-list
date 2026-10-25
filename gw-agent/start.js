// MIS 첫 화면(자동 탭): 왼쪽 메뉴에서 주문정보관리 → 주문등록을 열고, 매장이 잡히면 자동 대기(mis-agent.js)를 켬
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const info = await chrome.runtime.sendMessage({ q: "managed" }).catch(() => null);
  if (!info || !info.managed) return;
  if (document.querySelector('input[type="password"]')) return; // 로그인 화면은 login.js가
  const frames = () => { const out = []; const walk = (w) => { try { void w.document; out.push(w); } catch (e) { return; } for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]); }; walk(window); return out; };
  const q = (sel) => { for (const w of frames()) { try { const el = w.document.querySelector(sel); if (el) return el; } catch (e) {} } return null; };
  const ready = () => !!q("#custBtn input.btn_basic");
  // 메뉴 글자(정확히 같은 글자)를 찾아 누름. 같은 이름이 여럿이면(주문등록 폴더 > 주문등록 화면) 맨 뒤 = 가장 안쪽
  const clickText = (txt) => {
    for (const sel of [".tree-title", "a, span, li, div, td"]) {
      const els = [];
      for (const w of frames()) { try { els.push(...[...w.document.querySelectorAll(sel)].filter((e) => e.children.length === 0 && e.textContent.trim() === txt)); } catch (e) {} }
      if (els.length) { const el = els[els.length - 1]; el.scrollIntoView && el.scrollIntoView({ block: "center" }); el.click(); el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; }
    }
    return false;
  };
  for (let t = 0; t < 30 && !q(".tree-title") && !ready(); t++) await sleep(500); // 메뉴가 그려질 때까지
  // 매출 가져오기 창이면 주문등록 대신 매출 스크립트(mis-sales.js)에 맡김 — 메뉴 이동·조회·읽기는 그쪽이 함
  if (info.job === "sales") { await sleep(1000); chrome.runtime.sendMessage({ q: "startSales" }); return; }
  for (let t = 0; t < 4 && !ready(); t++) {
    if (t === 0 || t === 2) clickText("주문정보관리");
    await sleep(800);
    clickText("주문등록");
    for (let k = 0; k < 10 && !ready(); k++) await sleep(500);
  }
  if (!ready()) { chrome.runtime.sendMessage({ q: "log", msg: "주문등록 화면을 못 열었어요 (메뉴를 못 찾음)" }); return; }
  await sleep(1500);
  // 확장 안에서 만든 script 태그는 확장 보안 규칙에 막힘 → 배경이 페이지 쪽(MAIN)에서 넣어 줌 (북마크를 누른 것과 같음)
  chrome.runtime.sendMessage({ q: "started" });
})();
