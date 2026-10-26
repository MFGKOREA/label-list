// MIS 매출 가져오기: 크롬 확장(발주 GW 자동연동)이 매출 요청 때 MIS 첫 화면에 넣어 줌
//  salesPush.kind = "menu"면 메뉴별 매출현황을 하루씩 조회 → 시트 menuDay.날짜 = [{c 중분류, m 메뉴, q 수량}] (요일별 메뉴 쏠림 → 품목별 주말 배수)
//  매출정보관리 → 매출현황 → MiscellaneousReport → 조회일(salesPush.from ~ to) · 매장 1345090 · 일자별 → 조회
//  → 날짜별 Gross를 읽어 시트 forecast[날짜].act에 넣고 결과를 salesPush에 적음 (MIS에는 아무것도 저장하지 않음, 조회만)
//  어느 단계에서 막히면 그 화면의 칸 이름·표 머리글만 salesDiag에 적어 둠 → 고칠 때 씀 (확장은 다시 설치할 필요 없음)
(async () => {
  if (window.__misSalesBusy) return; window.__misSalesBusy = true; // 대기 창에서는 같은 페이지에서 여러 번 실행됨
  setTimeout(() => { window.__misSalesBusy = false; }, 240e3);
  const API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec";
  const STORE = "1345090";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[,\s원]/g, "")); return isFinite(n) ? n : NaN; };
  // 가게 키: 확장이 넣어 줄 땐 주소의 k=, 북마크로 켤 땐 이 MIS 브라우저에 저장해 둔 값 (시트가 잠겨 있으면 필요)
  const KEY = (() => { let k = ""; try { k = new URL(document.currentScript.src).searchParams.get("k") || ""; } catch (e) {} try { if (k) localStorage.setItem("orderAppKey", k); else k = localStorage.getItem("orderAppKey") || ""; } catch (e) {} return k; })();
  const withKey = (u) => u + (KEY ? "&k=" + encodeURIComponent(KEY) : "");
  const get = async () => (await (await fetch(withKey(API + "?api=1&t=" + Date.now()))).json()).data || {};
  const set = (key, value) => fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "set", key, value, k: KEY }) });
  const ME = Math.random().toString(36).slice(2, 8);
  const frames = () => { const out = []; const walk = (w) => { try { void w.document.body; out.push(w); } catch (e) { return; } for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]); }; walk(window.top); return out; };
  const visible = (el) => el && el.offsetParent !== null;
  // MIS 함수가 window.event를 보므로 그 프레임의 함수로 감싼 이벤트 안에서 누름 (mis.js와 같은 방법)
  const press = (W, el) => { const h = new W.Function("el", "return function () { el.click(); };")(el); W.document.addEventListener("x-sales", h); W.document.dispatchEvent(new W.Event("x-sales")); W.document.removeEventListener("x-sales", h); };
  const byText = (re, sel = ".tree-title, a, span, li, div, td, button, input[type=button]") => {
    for (const w of frames()) { const els = [...w.document.querySelectorAll(sel)].filter((e) => e.children.length === 0 && re.test((e.textContent || e.value || "").trim())); if (els.length) return { w, el: els[els.length - 1] }; }
    return null;
  };

  let job;
  try { job = (await get()).salesPush; } catch (e) { window.__misSalesBusy = false; return; }
  if (!job || job.status !== "pending") { window.__misSalesBusy = false; return; }
  await set("salesPush", { ...job, status: "running", startAt: Date.now(), by: ME });
  await sleep(1000);
  try { const q = (await get()).salesPush || {}; if (q.by !== ME || q.id !== job.id) { window.__misSalesBusy = false; return; } } catch (e) { window.__misSalesBusy = false; return; }

  let step = "시작";
  const diag = {};
  const finish = async (ok, text, extra) => {
    if (!ok) {
      // 막힌 화면의 구조만 (표 머리글, 입력칸 이름, 앞 3줄)
      diag.at = new Date().toString(); diag.step = step;
      diag.frames = frames().map((w) => {
        const d = w.document, $ = w.jQuery, grids = [];
        if ($) d.querySelectorAll("table[id], div[id]").forEach((el) => { if (!$(el).data("datagrid")) return; const o = $(el).datagrid("options"); grids.push({ id: el.id, cols: [].concat(...(o.frozenColumns || []), ...(o.columns || [])).map((c) => `${c.field}=${String(c.title || "").replace(/<[^>]+>/g, "")}`), rows: ($(el).datagrid("getRows") || []).slice(0, 3) }); });
        const inputs = [...d.querySelectorAll("input, select")].filter((i) => i.type !== "password").map((i) => `${i.tagName.toLowerCase()}#${i.id || "-"}[${i.name || ""}].${(i.className || "").split(" ").slice(0, 3).join(".")}=${String(i.value).slice(0, 30)}`).slice(0, 40);
        const buttons = [...d.querySelectorAll("a, button, input[type=button], .l-btn-text")].map((b) => (b.textContent || b.value || "").trim()).filter((t) => t && t.length < 20).slice(0, 30);
        return { url: w.location.href.slice(0, 120), title: d.title, grids, inputs, buttons };
      });
      diag.tree = frames().flatMap((w) => { try { return [...w.document.querySelectorAll(".tree-title")].map((e) => e.textContent.trim()).filter((t) => /매출|메뉴|Report|Misc/i.test(t)); } catch (e) { return []; } }).slice(0, 40);
      diag.kind = job.kind || "gross";
      await set("salesDiag", diag).catch(() => {});
    }
    await set("salesPush", { ...job, status: ok ? "done" : "error", doneAt: Date.now(), text, ...(extra || {}) });
    window.__misSalesBusy = false;
  };

  if (job.kind === "menu") return runMenu();
  try {
    // 1) 메뉴: 매출정보관리 → 매출현황 → MiscellaneousReport
    //  보고서 화면 = 주소에 miscellaneous가 있거나, 왼쪽 메뉴·맨 위가 아닌 프레임 중 날짜칸(datebox)이 있는 곳
    //  (왼쪽 메뉴 프레임에도 "MiscellaneousReport" 글자가 있어서 글자로는 찾지 않음)
    step = "메뉴";
    const isMenu = (w) => { try { return !!w.document.querySelector(".tree-title") || /LeftFrame/i.test(w.location.href); } catch (e) { return true; } };
    const dateInputs = (w) => { try { const $w = w.jQuery; return $w ? [...w.document.querySelectorAll("input")].filter((i) => $w(i).data("datebox")) : []; } catch (e) { return []; } };
    const before = new Set(frames());
    const bodyHas = (w) => { try { return /miscellaneous/i.test(w.document.title + " " + (w.document.body ? w.document.body.innerText.slice(0, 3000) : "")); } catch (e) { return false; } };
    // 주소에 miscellaneous → 화면 글자에 miscellaneous + 날짜칸 → 메뉴를 누른 뒤 새로 생긴 프레임 중 날짜칸이 있는 곳
    const isReport = () => { const fs = frames().filter((w) => w !== window.top && !isMenu(w)); return fs.find((w) => /miscellaneous/i.test(w.location.href)) || fs.find((w) => bodyHas(w) && dateInputs(w).length) || fs.find((w) => !before.has(w) && dateInputs(w).length); };
    const waitFor = async (fn, ms) => { for (let k = 0; k < ms / 200; k++) { const r = fn(); if (r) return r; await sleep(200); } return null; };
    const clickTree = (re) => { const hit = byText(re, ".tree-title"); if (!hit) return false; hit.el.click(); hit.el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; };
    let R = isReport();
    for (let t = 0; t < 3 && !R; t++) {
      // 폴더는 펼쳐질 때까지(자식이 그려질 때까지) 기다린 뒤 다음 단계
      if (!byText(/^miscellaneous\s*report$/i, ".tree-title")) {
        if (!byText(/^매출현황$/, ".tree-title")) { clickTree(/^매출정보관리$/); await waitFor(() => byText(/^매출현황$/, ".tree-title"), 3000); }
        clickTree(/^매출현황$/); await waitFor(() => byText(/^miscellaneous\s*report$/i, ".tree-title"), 3000);
      }
      clickTree(/^miscellaneous\s*report$/i);
      R = await waitFor(isReport, 8000);
    }
    if (!R) return finish(false, "MiscellaneousReport 메뉴를 못 열었어요");
    // 보고서 프레임이 다 그려질 때까지
    for (let k = 0; k < 60 && !(R.jQuery && dateInputs(R).length); k++) { await sleep(250); R = isReport() || R; }
    const $ = R.jQuery, d = R.document;
    if (!$) return finish(false, "보고서 화면에 jQuery가 없어요");

    // 2) 조회일: datebox 2개 (시작·끝). 화면에 있던 값의 모양(2026-10-25 / 20261025)에 맞춰 넣음
    step = "조회일";
    const dbs = [...d.querySelectorAll("input")].filter((i) => $(i).data("datebox"));
    const fmt = (iso, like) => (/^\d{8}$/.test(like) ? iso.replace(/-/g, "") : /^\d{4}\.\d\d\.\d\d$/.test(like) ? iso.replace(/-/g, ".") : /^\d{4}\/\d\d\/\d\d$/.test(like) ? iso.replace(/-/g, "/") : iso);
    if (dbs.length >= 2) {
      const like = $(dbs[0]).datebox("getValue") || "";
      $(dbs[0]).datebox("setValue", fmt(job.from, like)); $(dbs[1]).datebox("setValue", fmt(job.to, like));
    } else {
      const ds = [...d.querySelectorAll("input")].filter((i) => /^\d{4}[-./]?\d\d[-./]?\d\d$/.test(i.value));
      if (ds.length < 2) return finish(false, "조회일 칸을 못 찾았어요");
      ds[0].value = fmt(job.from, ds[0].value); ds[1].value = fmt(job.to, ds[1].value);
    }

    // 3) 매장: 이미 1345090이 잡혀 있으면 그대로, 아니면 매장 코드 칸에 넣음
    step = "매장";
    const all = [...d.querySelectorAll("input")];
    if (!all.some((i) => String(i.value).includes(STORE))) {
      const code = all.find((i) => /store|stor|shop|cd_?str|cd_?shop|매장/i.test(i.id + i.name) && !/nm|name/i.test(i.id + i.name));
      if (!code) return finish(false, "매장 칸을 못 찾았어요 (돋보기로 고르는 방식이면 조정 필요)");
      if ($(code).data("textbox")) $(code).textbox("setValue", STORE); else code.value = STORE;
    }

    // 4) 옵션: 일자별
    step = "일자별";
    const daily = [...d.querySelectorAll("input[type=radio], input[type=checkbox]")].find((i) => { const l = (i.id && d.querySelector(`label[for="${i.id}"]`)) || i.closest("label") || i.nextSibling; return /일자별/.test((l && l.textContent) || i.value || ""); });
    if (daily) { if (!daily.checked) daily.click(); }
    else {
      const sel = [...d.querySelectorAll("select")].find((s) => [...s.options].some((o) => /일자별/.test(o.text)));
      if (sel) { sel.value = [...sel.options].find((o) => /일자별/.test(o.text)).value; sel.dispatchEvent(new Event("change", { bubbles: true })); if ($(sel).data("combobox")) $(sel).combobox("setValue", sel.value); }
      else { const cb = [...d.querySelectorAll("input")].find((i) => $(i).data("combobox") && ($(i).combobox("getData") || []).some((o) => /일자별/.test(JSON.stringify(o)))); if (!cb) return finish(false, "옵션 '일자별'을 못 찾았어요"); const o = $(cb).combobox("getData").find((x) => /일자별/.test(JSON.stringify(x))); $(cb).combobox("select", o[$(cb).combobox("options").valueField]); }
    }

    // 5) 조회
    step = "조회";
    const btn = [...d.querySelectorAll("a, button, input[type=button], span.l-btn-text")].find((b) => /^조\s*회$/.test((b.textContent || b.value || "").trim()));
    if (!btn) return finish(false, "조회 버튼을 못 찾았어요");
    press(R, btn.closest("a, button, input") || btn);
    let grid = null, rows = [];
    for (let k = 0; k < 40; k++) {
      await sleep(250);
      const gs = [...d.querySelectorAll("table[id], div[id]")].filter((el) => $(el).data("datagrid"));
      grid = gs.find((el) => ($(el).datagrid("getRows") || []).length) || null;
      if (grid) { rows = $(grid).datagrid("getRows"); break; }
    }
    if (!grid) return finish(false, "조회 결과가 안 나왔어요");

    // 6) 날짜 칸·Gross 칸 찾기
    step = "읽기";
    const o = $(grid).datagrid("options"), cols = [].concat(...(o.frozenColumns || []), ...(o.columns || [])).filter((c) => c.field);
    const title = (c) => String(c.title || "").replace(/<[^>]+>/g, "").trim();
    // 날짜 칸: 칸 전체가 날짜 하나일 때만 (뒤에 "~ 10/24 합계" 같은 글이 붙은 합계 행은 날짜로 안 봄)
    const toIso = (v) => { const s = String(v ?? "").trim(); let m = /^(\d{4})[-./]?(\d\d)[-./]?(\d\d)(?:\s*\([^)]*\)|\s*[월화수목금토일])?$/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = /^(\d\d?)[-./](\d\d?)(?:\s*\([^)]*\)|\s*[월화수목금토일])?$/.exec(s); if (m) return `${job.to.slice(0, 4)}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; return null; };
    const isTotal = (r) => Object.values(r).some((v) => /합계|소계|총계|^계$|total|~/i.test(String(v ?? "").trim()));
    const dateCol = cols.find((c) => /일자|날짜|date|영업일/i.test(title(c) + c.field) && rows.some((r) => toIso(r[c.field]))) || cols.find((c) => rows.filter((r) => toIso(r[c.field])).length >= Math.min(2, rows.length));
    // Gross 칸: "Gross Sales"가 먼저, 수량·건수·비율 칸은 제외
    const bad = (c) => /qty|수량|건수|율|%|cnt|count|net|순|할인/i.test(title(c) + " " + c.field);
    const grossCol = cols.find((c) => /gross\s*sales/i.test(title(c) + " " + c.field)) || cols.find((c) => /gross/i.test(title(c) + " " + c.field) && !bad(c)) || cols.find((c) => /총\s*매출|매출\s*합계|매출액/.test(title(c)) && !bad(c));
    if (!dateCol || !grossCol) return finish(false, `날짜·Gross 칸을 못 찾았어요 (머리글: ${cols.map(title).join(", ").slice(0, 200)})`);
    const got = {}, dup = [];
    rows.forEach((r) => { if (isTotal(r)) return; const dt = toIso(r[dateCol.field]), v = num(r[grossCol.field]); if (!dt || dt < job.from || dt > job.to || !(v > 0)) return; if (dt in got) dup.push(dt); got[dt] = Math.round(v); });
    if (dup.length) return finish(false, `같은 날짜가 두 번 나와요 (${[...new Set(dup)].map((d) => d.slice(5)).join(", ")}) · 옵션이 '일자별'인지 확인`);
    if (!Object.keys(got).length) return finish(false, `${title(grossCol)} 값이 없어요 (${job.from} ~ ${job.to})`);
    // 말이 안 되는 값이면 안 씀: 하루 Gross가 10만 원 미만·1억 초과, 또는 기존 값의 1/3~3배 밖
    const fc0 = (await get()).forecast || {};
    const odd = Object.entries(got).filter(([dt, v]) => { const old = num((fc0[dt] || {}).act); return v < 1e5 || v > 1e8 || (old > 0 && (v / old > 3 || v / old < 1 / 3)); });
    if (odd.length) return finish(false, `값이 이상해서 안 넣었어요 (${odd.map(([dt, v]) => `${dt.slice(5)} ${Math.round(v / 1e4).toLocaleString("ko-KR")}만`).join(", ")}) · 칸 "${title(grossCol)}"가 맞는지 확인`);

    // 7) 앱 Forecast 실제 칸에 넣기 (MIS 값이 기준: 비었거나 다르면 바꿈)
    step = "저장";
    // 원 단위까지 MIS 값으로 맞추되, 알림에는 빈 칸을 채운 날과 1만 원 넘게 달랐던 날만
    const fc = { ...fc0 }, filled = [], diff = []; let n = 0;
    const man = (v) => `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`, md = (dt) => dt.slice(5).replace("-", "/");
    Object.entries(got).forEach(([dt, v]) => {
      const cur = { ...(fc[dt] || { fc: "" }) }, old = num(cur.act);
      if (old === v) return;
      if (!(old > 0)) filled.push(`${md(dt)} ${man(v)}`); else if (Math.abs(old - v) >= 1e4) diff.push(`${md(dt)} ${man(old)}→${man(v)}`);
      cur.act = String(v); fc[dt] = cur; n++;
    });
    if (n) await set("forecast", fc);
    const parts = [filled.length ? `채움 ${filled.join(", ")}` : "", diff.length ? `고침 ${diff.join(", ")}` : ""].filter(Boolean);
    await finish(true, `${Object.keys(got).length}일 확인${parts.length ? " · " + parts.join(" · ") : " · 모두 같음"}`, { col: title(grossCol), days: Object.keys(got).length });
  } catch (e) {
    await finish(false, `${step}에서 멈춤: ${e && e.message ? e.message : e}`);
  }

  // ---------- 메뉴별 매출현황: 하루씩 조회 ----------
  async function runMenu() {
    try {
      step = "메뉴별 메뉴";
      const isMenu = (w) => { try { return !!w.document.querySelector(".tree-title") || /LeftFrame/i.test(w.location.href); } catch (e) { return true; } };
      const dateInputs = (w) => { try { const $w = w.jQuery; return $w ? [...w.document.querySelectorAll("input")].filter((i) => $w(i).data("datebox")) : []; } catch (e) { return []; } };
      const waitFor = async (fn, ms) => { for (let k = 0; k < ms / 200; k++) { const r = fn(); if (r) return r; await sleep(200); } return null; };
      const clickTree = (re) => { const hit = byText(re, ".tree-title"); if (!hit) return false; hit.el.click(); hit.el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; };
      const MENU_RE = /^메뉴\s*별\s*매출\s*(현황)?$/;
      const before = new Set(frames());
      const bodyHas = (w) => { try { return /메뉴\s*별\s*매출/.test(w.document.title + " " + (w.document.body ? w.document.body.innerText.slice(0, 3000) : "")); } catch (e) { return false; } };
      const isReport = () => { const fs = frames().filter((w) => w !== window.top && !isMenu(w)); return fs.find((w) => /menu/i.test(w.location.pathname) && dateInputs(w).length) || fs.find((w) => bodyHas(w) && dateInputs(w).length) || fs.find((w) => !before.has(w) && dateInputs(w).length); };
      let R = null;
      for (let t = 0; t < 3 && !R; t++) {
        if (!byText(MENU_RE, ".tree-title")) {
          if (!byText(/^매출현황$/, ".tree-title")) { clickTree(/^매출정보관리$/); await waitFor(() => byText(/^매출현황$/, ".tree-title"), 3000); }
          clickTree(/^매출현황$/); await waitFor(() => byText(MENU_RE, ".tree-title"), 3000);
        }
        if (!clickTree(MENU_RE)) break;
        R = await waitFor(isReport, 8000);
      }
      if (!R) return finish(false, "메뉴별 매출현황 메뉴를 못 열었어요");
      for (let k = 0; k < 60 && !(R.jQuery && dateInputs(R).length); k++) { await sleep(250); R = isReport() || R; }
      const $ = R.jQuery, d = R.document;
      if (!$) return finish(false, "메뉴별 매출현황 화면에 jQuery가 없어요");
      const fmt = (iso, like) => (/^\d{8}$/.test(like) ? iso.replace(/-/g, "") : /^\d{4}\.\d\d\.\d\d$/.test(like) ? iso.replace(/-/g, ".") : /^\d{4}\/\d\d\/\d\d$/.test(like) ? iso.replace(/-/g, "/") : iso);
      const dbs = () => [...d.querySelectorAll("input")].filter((i) => $(i).data("datebox"));
      if (dbs().length < 2) { step = "조회일"; return finish(false, "메뉴별 매출현황 조회일 칸을 못 찾았어요"); }
      const all = [...d.querySelectorAll("input")];
      if (!all.some((i) => String(i.value).includes(STORE))) {
        const code = all.find((i) => /store|stor|shop|cd_?str|cd_?shop|매장/i.test(i.id + i.name) && !/nm|name/i.test(i.id + i.name));
        if (!code) { step = "매장"; return finish(false, "메뉴별 매출현황 매장 칸을 못 찾았어요"); }
        if ($(code).data("textbox")) $(code).textbox("setValue", STORE); else code.value = STORE;
      }
      const btn = [...d.querySelectorAll("a, button, input[type=button], span.l-btn-text")].find((b) => /^조\s*회$/.test((b.textContent || b.value || "").trim()));
      if (!btn) { step = "조회"; return finish(false, "메뉴별 매출현황 조회 버튼을 못 찾았어요"); }
      const grids = () => [...d.querySelectorAll("table[id], div[id]")].filter((el) => $(el).data("datagrid"));
      const title = (c) => String(c.title || "").replace(/<[^>]+>/g, "").trim();
      const isTotal = (r) => Object.values(r).some((v) => /합계|소계|총계|^계$|total/i.test(String(v ?? "").trim()));
      // 날짜 목록: from ~ to 중 시트에 아직 없는 날만 (force면 다)
      const have = await get();
      const days = []; for (let x = job.from; x <= job.to; ) { if (job.force || !have["menuDay." + x]) days.push(x); const t = new Date(x + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); x = t.toISOString().slice(0, 10); }
      let saved = 0; const empty = [];
      for (const day of days) {
        step = "조회 " + day;
        const like = $(dbs()[0]).datebox("getValue") || "";
        $(dbs()[0]).datebox("setValue", fmt(day, like)); $(dbs()[1]).datebox("setValue", fmt(day, like));
        const prev = grids().map((g) => $(g).datagrid("getRows"));
        press(R, btn.closest("a, button, input") || btn);
        let grid = null;
        for (let k = 0; k < 48 && !grid; k++) { await sleep(250); grid = grids().find((g, i) => { const rs = $(g).datagrid("getRows"); return rs !== prev[i] && rs && rs.length; }) || null; }
        if (!grid) { empty.push(day); continue; } // 그날 판매 없음(휴무) 또는 안 나옴
        const o = $(grid).datagrid("options"), cols = [].concat(...(o.frozenColumns || []), ...(o.columns || [])).filter((c) => c.field);
        const T = (c) => title(c) + " " + c.field;
        const qtyCol = cols.find((c) => /판매\s*수량/.test(title(c))) || cols.find((c) => /수량|qty/i.test(T(c)) && !/금액|율|%|amt/i.test(T(c)));
        const menuCol = cols.find((c) => /^소분류$|메뉴\s*명/.test(title(c))) || cols.find((c) => /메뉴|menu|상품명|품목명/i.test(T(c)) && !/코드|code|cd_|분류/i.test(T(c)));
        const catCol = cols.find((c) => /^중분류$/.test(title(c))) || cols.find((c) => /분류|구분|cat/i.test(T(c)) && c !== menuCol && !/코드|code|cd_/i.test(T(c)));
        step = "읽기 " + day;
        if (!qtyCol || !menuCol) return finish(false, `메뉴·수량 칸을 못 찾았어요 (머리글: ${cols.map(title).join(", ").slice(0, 200)})`);
        const rows = [];
        $(grid).datagrid("getRows").forEach((r) => { if (isTotal(r)) return; const m = String(r[menuCol.field] ?? "").trim(), q = num(r[qtyCol.field]); if (!m || !(q > 0)) return; rows.push({ c: catCol ? String(r[catCol.field] ?? "").trim() : "", m, q }); });
        if (!rows.length) { empty.push(day); continue; }
        await set("menuDay." + day, { at: Date.now(), rows });
        saved++;
      }
      return finish(true, `메뉴 판매 ${saved}일 저장${empty.length ? ` · 비어 있음 ${empty.map((x) => x.slice(5)).join(", ")}` : ""}${days.length ? "" : " · 새로 받을 날 없음"}`, { days: saved });
    } catch (e) {
      return finish(false, `${step}에서 멈춤: ${e && e.message ? e.message : e}`);
    }
  }
})();
