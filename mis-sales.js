// MIS 매출 가져오기: 크롬 확장(GW Agent)이 매출 요청 때 MIS 첫 화면에 넣어 줌
//  salesPush.kind = "menu"면 메뉴별 매출현황을 하루씩 조회 → 시트 menuDay.날짜 = [{c 중분류, m 메뉴, q 수량}] (요일별 메뉴 쏠림 → 품목별 주말 배수)
//  매출정보관리 → 매출현황 → MiscellaneousReport → 조회일(salesPush.from ~ to) · 매장 1345090 · 일자별 → 조회
//  → 날짜별 Gross를 읽어 시트 forecast[날짜].act에 넣고 결과를 salesPush에 적음 (MIS에는 아무것도 저장하지 않음, 조회만)
//  어느 단계에서 막히면 그 화면의 칸 이름·표 머리글만 salesDiag에 적어 둠 → 고칠 때 씀 (확장은 다시 설치할 필요 없음)
(async () => {
  if (window.__misSalesBusy) return; window.__misSalesBusy = true; // 대기 창에서는 같은 페이지에서 여러 번 실행됨
  // 11/12 안정화: budget = 이 창에서 쓸 수 있는 시간(확장이 창을 연 지 12분이면 닫으므로 그 전에 스스로 마무리), q = 조회 하나를 기다리는 시간,
  //  settle = 요청이 끝난 뒤 결과가 비었다고 확정하기까지, emptyWait = 요청이 보이지 않을 때 빈 결과로 확정하기까지. (시험에서는 window.__salesTest로 줄여 씀)
  const T = Object.assign({ budget: 10 * 60e3, total: 11 * 60e3, q: 45e3, settle: 500, emptyWait: 2500, retry: [1500, 4000], reserve: 15e3 }, window.__salesTest || {});
  setTimeout(() => { window.__misSalesBusy = false; }, T.budget + 150e3);
  const API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec";
  const STORE = "1345090";
  // 기다리기: 자동 창이 최소화·다른 창 아래에 있으면 크롬이 화면 타이머를 느리게 돌림(0.25초가 1초 이상, 5분 넘으면 1분에 한 번)
  //  → 워커의 타이머로 잼(워커는 안 느려짐). 워커를 못 만들면(보안 설정 등) 예전처럼 화면 타이머로. 워커가 죽었을 때를 대비해 화면 타이머도 같이 걸어 둠
  const sleep = (() => {
    const plain = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const w = new Worker(URL.createObjectURL(new Blob(["onmessage=function(e){setTimeout(function(){postMessage(e.data[0])},e.data[1])}"], { type: "text/javascript" })));
      const cb = new Map(); let n = 0, dead = false;
      w.onmessage = (e) => { const f = cb.get(e.data); if (f) { cb.delete(e.data); f(); } };
      w.onerror = () => { dead = true; };
      return (ms) => (dead ? plain(ms) : new Promise((r) => { const id = ++n; cb.set(id, r); w.postMessage([id, ms]); setTimeout(() => { if (cb.delete(id)) r(); }, ms + 2000); }));
    } catch (e) { return plain; }
  })();
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[,\s원]/g, "")); return isFinite(n) ? n : NaN; };
  // 가게 키: 확장이 넣어 줄 땐 주소의 k=, 북마크로 켤 땐 이 MIS 브라우저에 저장해 둔 값 (시트가 잠겨 있으면 필요)
  const KEY = (() => { let k = ""; try { k = new URL(document.currentScript.src).searchParams.get("k") || ""; } catch (e) {} try { if (k) localStorage.setItem("orderAppKey", k); else k = localStorage.getItem("orderAppKey") || ""; } catch (e) {} return k; })();
  const withKey = (u) => u + (KEY ? "&k=" + encodeURIComponent(KEY) : "");
  const get = async () => (await (await fetch(withKey(API + "?api=1&t=" + Date.now()))).json()).data || {};
  // 시트 쓰기: 응답(ok)을 확인하고, 안 되면 두 번 더 (예전엔 실패해도 모르고 "저장"으로 셌음)
  const call = async (body) => {
    let err;
    for (let t = 0; t <= T.retry.length; t++) {
      try { const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, k: KEY }) }); const j = await r.json(); if (j && j.ok) return j.data || {}; err = new Error((j && j.error) || "시트 응답 오류"); }
      catch (e) { err = e; }
      if (t < T.retry.length) await sleep(T.retry[t]);
    }
    throw err;
  };
  const set = (key, value) => call({ action: "set", key, value });
  const merge = (key, patch) => call({ action: "merge", key, patch }); // 바뀐 칸만 (앱이 그새 덧붙인 요청·다른 칸을 덮지 않게)
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
  try { await merge("salesPush", { status: "running", startAt: Date.now(), by: ME }); } catch (e) { window.__misSalesBusy = false; return; }
  await sleep(1000);
  try { const q = (await get()).salesPush || {}; if (q.by !== ME || q.id !== job.id) { window.__misSalesBusy = false; return; } } catch (e) { window.__misSalesBusy = false; return; }

  // 쓸 수 있는 시간: 요청한 지 얼마 안 됐으면(=PC가 바로 받음) 요청 시각부터 total(11분)까지, 오래된 요청(PC가 꺼져 있다 켜짐)이면 GW 로그인에 90초 썼다고 봄
  const sinceReq = Date.now() - (job.at || Date.now()), spent = sinceReq >= 0 && sinceReq < T.total ? sinceReq : 90e3;
  const BUDGET = Math.max(Math.min(60e3, T.budget), Math.min(T.budget, T.total - spent));
  const t0 = Date.now(), left = () => BUDGET - (Date.now() - t0);
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
    return { ok: !!ok, text, extra: extra || {} };
  };
  // 조회 결과 기다리기 (11/12): 표의 줄 목록이 새것으로 바뀌면 불러온 것. 요청이 다 끝났는데도 비어 있으면 "빈 결과"로 확정(휴무일 등),
  //  시간 안에 아무 변화가 없으면 null(못 받음). 다음 조회는 앞 요청이 다 끝난 뒤에만 보냄 → 늦게 온 앞 날짜 결과가 다음 날짜로 들어가는 일 방지
  const loader = ($, d) => {
    const grids = () => [...d.querySelectorAll("table[id], div[id]")].filter((el) => $(el).data("datagrid"));
    const raw = (g) => { try { return $(g).datagrid("getRows"); } catch (e) { return null; } };
    // 진행 중인 요청 수($.active). 화면에 늘 떠 있는 요청(세션 확인 등)이 있으면 그만큼은 빼고 봄 (처음 0.8초 동안의 가장 작은 값 = 바탕)
    let base = null;
    const rawActive = () => { try { return $.active || 0; } catch (e) { return 0; } };
    const calib = async () => { if (base !== null) return; let m = Infinity; for (let i = 0; i < 8; i++) { m = Math.min(m, rawActive()); await sleep(100); } base = m === Infinity ? 0 : m; };
    const active = () => Math.max(0, rawActive() - (base || 0));
    const idle = async (ms) => { await calib(); const t = Date.now(); while (active() > 0 && Date.now() - t < ms) await sleep(100); return active() === 0; };
    const refs = () => grids().map(raw);
    const awaitLoad = async (prev, ms) => {
      const t = Date.now(); let emptyAt = 0, saw = active() > 0, quietAt = 0;
      while (Date.now() - t < ms) {
        await sleep(120);
        const a = active(); if (a > 0) { saw = true; quietAt = 0; } else if (!quietAt) quietAt = Date.now();
        const gs = grids(), ch = gs.find((g, i) => raw(g) !== prev[i]);
        if (ch) {
          const rs = raw(ch) || [];
          if (rs.length) return { grid: ch, rows: rs };
          if (!emptyAt) emptyAt = Date.now();
          if (a === 0 && Date.now() - emptyAt >= (saw ? T.settle : T.emptyWait)) return { grid: ch, rows: [] };
        } else if (saw && a === 0 && quietAt && Date.now() - quietAt >= T.settle) {
          const g = gs.find((x) => (raw(x) || []).length) || gs[0]; // 요청은 끝났는데 줄 목록이 그대로(같은 목록을 고쳐 쓰는 화면): 지금 표를 결과로
          if (g) return { grid: g, rows: raw(g) || [] };
        }
      }
      return null;
    };
    return { grids, raw, idle, refs, awaitLoad };
  };
  let replaced = false; // 그새 다른 요청으로 바뀜(폰에서 다시 누름) → 하던 일을 멈추고 시트는 건드리지 않음
  let progAt = 0, progQ = Promise.resolve();
  const prog = (text) => { // 진행 상황을 폰에 (20초에 한 번, 조회를 막지 않게 뒤에서)
    if (Date.now() - progAt < (T.progEvery || 20e3)) return; progAt = Date.now();
    progQ = progQ.then(() => merge("salesPush", { prog: text, progAt: Date.now() })).then((d) => { if (d && d.salesPush && d.salesPush.id !== job.id) replaced = true; }, () => {});
  };

  async function runGross() {
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
    const L = loader($, d);
    await L.idle(T.q);
    let hit = null;
    for (let t = 0; t < 2 && !(hit && hit.rows.length); t++) { // 결과가 안 오면 한 번 더 누름 (예전엔 10초만 기다리고 포기)
      const prev = L.refs();
      press(R, btn.closest("a, button, input") || btn);
      hit = await L.awaitLoad(prev, T.q);
      if (!hit) await L.idle(T.q);
    }
    if (!hit) { const g = L.grids().find((x) => (L.raw(x) || []).length); if (g) hit = { grid: g, rows: L.raw(g) }; } // 변화를 못 봤어도 표에 결과가 있으면 그걸로 (예전 방식)
    if (!hit) return finish(false, `조회 결과가 ${Math.round(T.q / 1000)}초 안에 안 나왔어요 (MIS가 느리거나 멈춤)`);
    if (!hit.rows.length) return finish(false, `조회 결과가 비어 있어요 (${job.from} ~ ${job.to})`);

    // 6) 날짜 칸·Gross 칸 찾기 (표가 여러 개인 화면이면 날짜·Gross 칸이 다 있는 표를 고름)
    step = "읽기";
    const title = (c) => String(c.title || "").replace(/<[^>]+>/g, "").trim();
    // 날짜 칸: 칸 전체가 날짜 하나일 때만 (뒤에 "~ 10/24 합계" 같은 글이 붙은 합계 행은 날짜로 안 봄)
    const toIso = (v) => { const s = String(v ?? "").trim(); let m = /^(\d{4})[-./]?(\d\d)[-./]?(\d\d)(?:\s*\([^)]*\)|\s*[월화수목금토일])?$/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = /^(\d\d?)[-./](\d\d?)(?:\s*\([^)]*\)|\s*[월화수목금토일])?$/.exec(s); if (m) return `${job.to.slice(0, 4)}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; return null; };
    const isTotal = (r) => Object.values(r).some((v) => /합계|소계|총계|^계$|total|~/i.test(String(v ?? "").trim()));
    // Gross 칸: "Gross Sales"가 먼저, 수량·건수·비율 칸은 제외
    const bad = (c) => /qty|수량|건수|율|%|cnt|count|net|순|할인/i.test(title(c) + " " + c.field);
    let rows = hit.rows, cols = null, dateCol, grossCol;
    for (let t = 0; t < 8 && !(dateCol && grossCol); t++) { // 다른 표가 조금 늦게 채워질 수 있어 2초까지 다시 봄
      for (const g of [hit.grid, ...L.grids().filter((x) => x !== hit.grid && (L.raw(x) || []).length)]) {
        const o = $(g).datagrid("options"), cs = [].concat(...(o.frozenColumns || []), ...(o.columns || [])).filter((c) => c.field), rs = L.raw(g) || [];
        const dc = cs.find((c) => /일자|날짜|date|영업일/i.test(title(c) + c.field) && rs.some((r) => toIso(r[c.field]))) || cs.find((c) => rs.length && rs.filter((r) => toIso(r[c.field])).length >= Math.min(2, rs.length));
        const gc = cs.find((c) => /gross\s*sales/i.test(title(c) + " " + c.field)) || cs.find((c) => /gross/i.test(title(c) + " " + c.field) && !bad(c)) || cs.find((c) => /총\s*매출|매출\s*합계|매출액/.test(title(c)) && !bad(c));
        if (!cols || (dc && gc)) { rows = rs; cols = cs; dateCol = dc; grossCol = gc; }
        if (dc && gc) break;
      }
      if (!(dateCol && grossCol)) await sleep(250);
    }
    if (!dateCol || !grossCol) return finish(false, `날짜·Gross 칸을 못 찾았어요 (머리글: ${(cols || []).map(title).join(", ").slice(0, 200)})`);
    const got = {}, dup = [];
    rows.forEach((r) => { if (isTotal(r)) return; const dt = toIso(r[dateCol.field]), v = num(r[grossCol.field]); if (!dt || dt < job.from || dt > job.to || !(v > 0)) return; if (dt in got) dup.push(dt); got[dt] = Math.round(v); });
    if (dup.length) return finish(false, `같은 날짜가 두 번 나와요 (${[...new Set(dup)].map((d) => d.slice(5)).join(", ")}) · 옵션이 '일자별'인지 확인`);
    if (!Object.keys(got).length) return finish(false, `${title(grossCol)} 값이 없어요 (${job.from} ~ ${job.to})`);
    // 11/12 KM: kind "now" = 오늘 지금까지 Gross만 보기. 영업 중 값이라 Forecast 실제 칸(학습)에는 넣지 않고 결과 글에만 적음
    if (job.kind === "now") { const v = got[job.to] || 0; return finish(true, `${job.to.slice(5).replace("-", "/")} 지금까지 Gross ${v.toLocaleString("ko-KR")}원 (${new Date().toTimeString().slice(0, 5)} 조회 · 학습엔 안 씀)`, { now: v, nowAt: Date.now() }); }
    // 말이 안 되는 값이면 안 씀: 하루 Gross가 10만 원 미만·1억 초과, 또는 기존 값의 1/3~3배 밖
    const fc0 = (await get()).forecast || {};
    const odd = Object.entries(got).filter(([dt, v]) => { const old = num((fc0[dt] || {}).act); return v < 1e5 || v > 1e8 || (old > 0 && (v / old > 3 || v / old < 1 / 3)); });
    if (odd.length) return finish(false, `값이 이상해서 안 넣었어요 (${odd.map(([dt, v]) => `${dt.slice(5)} ${Math.round(v / 1e4).toLocaleString("ko-KR")}만`).join(", ")}) · 칸 "${title(grossCol)}"가 맞는지 확인`);

    // 7) 앱 Forecast 실제 칸에 넣기 (MIS 값이 기준: 비었거나 다르면 바꿈)
    step = "저장";
    // 원 단위까지 MIS 값으로 맞추되, 알림에는 빈 칸을 채운 날과 1만 원 넘게 달랐던 날만
    const patch = {}, filled = [], diff = []; let n = 0;
    const man = (v) => `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`, md = (dt) => dt.slice(5).replace("-", "/");
    Object.entries(got).forEach(([dt, v]) => {
      const cur = fc0[dt] || {}, old = num(cur.act);
      if (old === v) return;
      if (!(old > 0)) filled.push(`${md(dt)} ${man(v)}`); else if (Math.abs(old - v) >= 1e4) diff.push(`${md(dt)} ${man(old)}→${man(v)}`);
      patch[dt] = fc0[dt] ? { act: String(v) } : { fc: "", act: String(v) }; n++;
    });
    if (n) await merge("forecast", patch);
    const parts = [filled.length ? `채움 ${filled.join(", ")}` : "", diff.length ? `고침 ${diff.join(", ")}` : ""].filter(Boolean);
    return finish(true, `${Object.keys(got).length}일 확인${parts.length ? " · " + parts.join(" · ") : " · 모두 같음"}`, { col: title(grossCol), days: Object.keys(got).length });
  } catch (e) {
    return finish(false, `${step}에서 멈춤: ${e && e.message ? e.message : e}`);
  }
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
      const L = loader($, d);
      let saved = 0; const empty = [], failed = [], saveErr = []; let rem = [], hung = false;
      // 시트 저장은 뒤에서 차례로 (하루 저장에 2~4초 → 조회를 막지 않게). 실패한 날은 따로 모음
      let saveQ = Promise.resolve();
      const save = (day, rows) => { saveQ = saveQ.then(() => set("menuDay." + day, { at: Date.now(), rows })).then(() => { saved++; }, () => { saveErr.push(day); }); };
      const readDay = async (day) => {
        step = "조회 " + day;
        if (!(await L.idle(T.q))) return "busy"; // 앞 조회가 아직 안 끝남 → 이 날은 나중에
        const like = $(dbs()[0]).datebox("getValue") || "";
        $(dbs()[0]).datebox("setValue", fmt(day, like)); $(dbs()[1]).datebox("setValue", fmt(day, like));
        const prev = L.refs();
        press(R, btn.closest("a, button, input") || btn);
        const hit = await L.awaitLoad(prev, T.q);
        if (!hit) return "timeout";
        if (!hit.rows.length) return "empty"; // 그날 판매 없음(휴무)
        const grid = hit.grid, o = $(grid).datagrid("options"), cols = [].concat(...(o.frozenColumns || []), ...(o.columns || [])).filter((c) => c.field);
        const TT = (c) => title(c) + " " + c.field;
        const qtyCol = cols.find((c) => /판매\s*수량/.test(title(c))) || cols.find((c) => /수량|qty/i.test(TT(c)) && !/금액|율|%|amt/i.test(TT(c)));
        const menuCol = cols.find((c) => /^소분류$|메뉴\s*명/.test(title(c))) || cols.find((c) => /메뉴|menu|상품명|품목명/i.test(TT(c)) && !/코드|code|cd_|분류/i.test(TT(c)));
        const catCol = cols.find((c) => /^중분류$/.test(title(c))) || cols.find((c) => /분류|구분|cat/i.test(TT(c)) && c !== menuCol && !/코드|code|cd_/i.test(TT(c)));
        step = "읽기 " + day;
        if (!qtyCol || !menuCol) throw new Error(`메뉴·수량 칸을 못 찾았어요 (머리글: ${cols.map(title).join(", ").slice(0, 200)})`);
        const rows = [];
        hit.rows.forEach((r) => { if (isTotal(r)) return; const m = String(r[menuCol.field] ?? "").trim(), q = num(r[qtyCol.field]); if (!m || !(q > 0)) return; rows.push({ c: catCol ? String(r[catCol.field] ?? "").trim() : "", m, q }); });
        if (!rows.length) return "empty";
        save(day, rows); return "ok";
      };
      try {
        const again = []; let stuck = 0;
        for (let i = 0; i < days.length && !replaced; i++) {
          if (left() < T.q + T.reserve) { rem = days.slice(i); break; } // 시간이 다 돼 가면 여기까지만 (남은 날은 다시 누르면 이어서)
          const r = await readDay(days[i]);
          if (r === "empty") empty.push(days[i]); else if (r !== "ok") again.push(days[i]);
          if (r === "ok" || r === "empty") stuck = 0;
          else if (++stuck >= 2) { hung = true; failed.push(...again.splice(0)); rem = days.slice(i + 1); break; } // 두 번 연달아 응답 없음 = MIS가 멈춤 → 남은 날을 하나하나 기다리지 않고 바로 알림
          prog(`${i + 1}/${days.length}일`);
        }
        for (const day of again) { // 못 받은 날은 한 번 더
          if (replaced || left() < T.q + T.reserve) { failed.push(day); continue; }
          const r = await readDay(day);
          if (r === "empty") empty.push(day); else if (r !== "ok") failed.push(day);
        }
      } finally { await saveQ.catch(() => {}); }
      const md = (x) => x.slice(5).replace("-", "/"), bad = [...new Set([...failed, ...saveErr])].sort();
      const text = `메뉴 판매 ${saved}일 저장` + (empty.length ? ` · 판매 없음 ${empty.map(md).join(", ")}` : "") + (hung ? " · MIS가 응답하지 않아 멈췄어요" : "") + (bad.length ? ` · 못 받은 날 ${bad.map(md).join(", ")} (다시 누르면 그날만 받아요)` : "") +
        (rem.length ? ` · 남은 ${rem.length}일은 다시 누르면 이어서 받아요` : "") + (days.length ? "" : " · 새로 받을 날 없음");
      if (bad.length) { step = failed.length ? "조회 " + failed[0] : "시트 저장"; return finish(false, text, { days: saved, bad: bad.length, more: rem.length }); }
      return finish(true, text, { days: saved, more: rem.length });
    } catch (e) {
      return finish(false, `${step}에서 멈춤: ${e && e.message ? e.message : e}`);
    }
  }

  // ---------- MIS 메뉴 살펴보기 (11/13, kind "scout") ----------
  //  왼쪽 메뉴의 "이름만" 읽어 시트 gwScout에 둠 (화면을 열거나 자료를 읽지 않음). 어느 화면에서 발주·입고 내역을 받을 수 있는지 알아보는 첫 단계
  //  접힌 폴더는 펼침 단추(.tree-hit)나 트리 기능(expand)으로만 폄. 메뉴 이름(.tree-title)은 누르지 않음 = 화면이 열리지 않음
  async function runScout() {
    try {
      step = "메뉴 찾기";
      const trees = () => frames().filter((w) => { try { return !!w.document.querySelector(".tree-title"); } catch (e) { return false; } });
      for (let k = 0; k < 75 && !trees().length; k++) await sleep(200);
      if (!trees().length) return finish(false, "MIS 왼쪽 메뉴를 못 찾음");
      const read = () => {
        const out = [];
        trees().forEach((w, fr) => {
          const els = [...w.document.querySelectorAll(".tree-title")], anc = (e) => { let n = 0; for (let x = e.parentElement; x && x !== w.document.body; x = x.parentElement) n++; return n; };
          const min = Math.min(...els.map(anc)), even = els.every((e) => (anc(e) - min) % 2 === 0);
          els.forEach((e) => {
            const t = (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60); if (!t) return;
            const node = e.closest(".tree-node"), o = { t };
            if (node) { const hit = !!node.querySelector(".tree-hit"); o.d = Math.max(0, node.querySelectorAll(".tree-indent").length - (hit ? 0 : 1)); if (hit || node.querySelector(".tree-folder")) o.f = 1; }
            else o.d = (anc(e) - min) / (even ? 2 : 1);
            if (fr) o.fr = fr;
            out.push(o);
          });
        });
        return out;
      };
      step = "폴더 펴기";
      // 접힌 폴더를 한 겹씩 폄 (펴면 아래 폴더가 새로 보임). 더 펼 게 없거나, 펴도 두 번 연속 늘지 않으면 그만
      let how = "dom", last = read().length, same = 0;
      for (let round = 0; round < 12 && left() > T.reserve && !replaced; round++) {
        let did = 0;
        for (const w of trees()) {
          let hits = []; try { hits = [...w.document.querySelectorAll(".tree-hit.tree-collapsed")].slice(0, 80); } catch (e) {}
          for (const h of hits) {
            let ok = false;
            try { const $w = w.jQuery, node = h.closest(".tree-node"), root = $w && $w.fn && $w.fn.tree && node ? $w(h).closest("ul.tree") : null; if (root && root.length) { root.tree("expand", node); ok = true; how = "tree"; } } catch (e) {}
            if (!ok) { try { press(w, h); ok = true; if (how === "dom") how = "hit"; } catch (e) {} }
            if (ok) did++;
          }
        }
        if (!did) break;
        await sleep(700);
        const n = read().length; same = n === last ? same + 1 : 0; last = n;
        prog(`메뉴 ${n}개`);
        if (same >= 2) break;
      }
      const menus = read().slice(0, 1500);
      if (!menus.length) return finish(false, "MIS 메뉴 이름을 못 읽음");
      step = "시트 저장";
      await set("gwScout", { at: Date.now(), n: menus.length, how, menus });
      return finish(true, `MIS 메뉴 ${menus.length}개 이름을 읽음`, { n: menus.length });
    } catch (e) {
      return finish(false, `${step}에서 멈춤: ${e && e.message ? e.message : e}`);
    }
  }

  // ---------- 시간대별 매출현황 살펴보기 (11/13, kind "hour") ----------
  //  실제 화면을 아직 못 봐서, 첫 버전은 "열 이름과 앞 몇 줄"만 읽어 시트 hourProbe에 둔다(이 매장 자료라 값도 둠).
  //  이걸 보고 날짜별·시간대별 Gross를 뽑는 읽기를 mis-sales.js에 맞춘 뒤, 매일 Forecast 확인과 같이 어제 것을 모은다.
  //  화면은 열지만 조회만 한다. 저장·확정 단추는 누르지 않는다.
  async function runHour() {
    try {
      step = "시간대별 메뉴";
      const isMenu = (w) => { try { return !!w.document.querySelector(".tree-title") || /LeftFrame/i.test(w.location.href); } catch (e) { return true; } };
      const dateInputs = (w) => { try { const $w = w.jQuery; return $w ? [...w.document.querySelectorAll("input")].filter((i) => $w(i).data("datebox")) : []; } catch (e) { return []; } };
      const waitFor = async (fn, ms) => { for (let k = 0; k < ms / 200; k++) { const r = fn(); if (r) return r; await sleep(200); } return null; };
      const clickTree = (re) => { const hit = byText(re, ".tree-title"); if (!hit) return false; hit.el.click(); hit.el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; };
      const HOUR_RE = /^시간\s*대?\s*별\s*매출\s*(현황)?$/;
      const before = new Set(frames());
      const bodyHas = (w) => { try { return /시간\s*대?\s*별\s*매출/.test(w.document.title + " " + (w.document.body ? w.document.body.innerText.slice(0, 3000) : "")); } catch (e) { return false; } };
      const isReport = () => { const fs = frames().filter((w) => w !== window.top && !isMenu(w)); return fs.find((w) => bodyHas(w) && dateInputs(w).length) || fs.find((w) => !before.has(w) && dateInputs(w).length); };
      let R = null;
      for (let t = 0; t < 3 && !R; t++) {
        if (!byText(HOUR_RE, ".tree-title")) {
          if (!byText(/^매출현황$/, ".tree-title")) { clickTree(/^매출정보관리$/); await waitFor(() => byText(/^매출현황$/, ".tree-title"), 3000); }
          clickTree(/^매출현황$/); await waitFor(() => byText(HOUR_RE, ".tree-title"), 3000);
        }
        if (!clickTree(HOUR_RE)) break;
        R = await waitFor(isReport, 8000);
      }
      if (!R) return finish(false, "시간대별매출현황 메뉴를 못 열었어요");
      for (let k = 0; k < 60 && !(R.jQuery && dateInputs(R).length); k++) { await sleep(250); R = isReport() || R; }
      const $ = R.jQuery, d = R.document;
      if (!$) return finish(false, "시간대별매출현황 화면에 jQuery가 없어요");
      // 날짜: from(어제-41) ~ to(어제) → 요일별 곡선을 다시 그릴 만큼 (한 번 조회로 기간 전체가 날짜 행으로 옴)
      step = "조회일";
      const fmt = (iso, like) => (/^\d{8}$/.test(like) ? iso.replace(/-/g, "") : /^\d{4}\.\d\d\.\d\d$/.test(like) ? iso.replace(/-/g, ".") : /^\d{4}\/\d\d\/\d\d$/.test(like) ? iso.replace(/-/g, "/") : iso);
      const dbs = [...d.querySelectorAll("input")].filter((i) => $(i).data("datebox"));
      if (dbs.length < 2) return finish(false, "시간대별매출현황 조회일 칸을 못 찾았어요");
      const to = job.to, from = (() => { const t = new Date(to + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 41); return t.toISOString().slice(0, 10); })();
      const like = $(dbs[0]).datebox("getValue") || "";
      $(dbs[0]).datebox("setValue", fmt(from, like)); $(dbs[1]).datebox("setValue", fmt(to, like));
      step = "매장";
      const all = [...d.querySelectorAll("input")];
      if (!all.some((i) => String(i.value).includes(STORE))) { const code = all.find((i) => /store|stor|shop|cd_?str|cd_?shop|매장/i.test(i.id + i.name) && !/nm|name/i.test(i.id + i.name)); if (code) { if ($(code).data("textbox")) $(code).textbox("setValue", STORE); else code.value = STORE; } }
      // 일자별 옵션이 있으면 켬 (날짜 행으로 받기)
      const daily = [...d.querySelectorAll("input[type=radio], input[type=checkbox]")].find((i) => { const l = (i.id && d.querySelector(`label[for="${i.id}"]`)) || i.closest("label"); return /일자별|일별/.test((l && l.textContent) || i.value || ""); });
      if (daily && !daily.checked) daily.click();
      step = "조회";
      const btn = [...d.querySelectorAll("a, button, input[type=button], span.l-btn-text")].find((b) => /^조\s*회$/.test((b.textContent || b.value || "").trim()));
      if (!btn) return finish(false, "시간대별매출현황 조회 버튼을 못 찾았어요");
      const L = loader($, d);
      await L.idle(T.q);
      let hit = null;
      for (let t = 0; t < 2 && !(hit && hit.rows.length); t++) { const prev = L.refs(); press(R, btn.closest("a, button, input") || btn); hit = await L.awaitLoad(prev, T.q); if (!hit) await L.idle(T.q); }
      if (!hit) { const g = L.grids().find((x) => (L.raw(x) || []).length); if (g) hit = { grid: g, rows: L.raw(g) }; }
      if (!hit || !hit.rows.length) return finish(false, "시간대별매출현황 조회 결과가 비어 있어요");
      step = "읽기";
      const title = (c) => String(c.title || "").replace(/<[^>]+>/g, "").trim();
      // 날짜(SALES_DT) + 시간칸(AM_11..AM_23)이 다 있는 표를 고름
      const HF = ["AM_11","AM_12","AM_13","AM_14","AM_15","AM_16","AM_17","AM_18","AM_19","AM_20","AM_21","AM_22","AM_23"]; // AM_11=~12시 … AM_23=~24시
      const ENDS = [12,13,14,15,16,17,18,19,20,21,22]; // 22시까지 (23·24시는 22로 접음)
      let rows = null, dcol = null, gub = null, cols = null;
      for (const g of L.grids()) {
        const o = $(g).datagrid("options"), cs = [].concat(...(o.frozenColumns || []), ...(o.columns || [])).filter((c) => c.field), rs = L.raw(g) || [];
        if (!rs.length) continue;
        const dc = cs.find((c) => /SALES_DT|일자|날짜|date/i.test(c.field + title(c)) && rs.some((r) => /^\d{4}[-./]?\d\d[-./]?\d\d/.test(String(r[c.field] || ""))));
        const hasHour = HF.filter((f) => cs.some((c) => c.field === f)).length >= 10;
        const gb = cs.find((c) => /GUBUN|구분/i.test(c.field + title(c)));
        if (dc && hasHour) { rows = rs; dcol = dc; gub = gb; cols = cs; break; }
      }
      if (!rows) return finish(false, `시간대별 날짜·시간칸을 못 찾았어요 (머리글: ${(L.grids()[0] ? ($(L.grids()[0]).datagrid("options").columns || [[]]).flat().map(title).join(",") : "").slice(0,150)})`);
      // Gross 행만, 날짜별 시간칸을 요일 묶음(wd/sat/sun)으로 모음
      const toIso = (v) => { const m = /^(\d{4})[-./]?(\d\d)[-./]?(\d\d)/.exec(String(v || "")); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
      const grp = { wd: {}, sat: {}, sun: {} }, cnt = { wd: 0, sat: 0, sun: 0 };
      let lo = "9999", hi = "0";
      rows.forEach((r) => {
        if (gub && !/gross/i.test(String(r[gub.field] || ""))) return;
        const dt = toIso(r[dcol.field]); if (!dt) return;
        const tot = HF.reduce((a, f) => a + (num(r[f]) || 0), 0); if (!(tot > 0)) return;
        const wd = new Date(dt + "T00:00:00Z").getUTCDay(), key = wd === 0 ? "sun" : wd === 6 ? "sat" : "wd";
        cnt[key]++; if (dt < lo) lo = dt; if (dt > hi) hi = dt;
        HF.forEach((f, i) => { const end = 12 + i; const e = end > 22 ? 22 : end; grp[key][e] = (grp[key][e] || 0) + (num(r[f]) || 0); });
      });
      if (cnt.wd < 10) return finish(false, `시간대별 평일 자료가 적어요 (평일 ${cnt.wd}일) · 기간을 늘려 다시`);
      const build = (g) => { const per = ENDS.map((e) => g[e] || 0), tot = per.reduce((a, b) => a + b, 0); if (!(tot > 0)) return null; let run = 0; const cum = per.map((v) => { run += v; return Math.round((run / tot) * 1e4) / 1e4; }); cum[cum.length - 1] = 1; return cum; };
      const cur = {}; ["wd","sat","sun"].forEach((k) => { const c = build(grp[k]); if (c) cur[k] = { n: cnt[k], ends: ENDS, cum: c }; });
      // 안전장치: 각 곡선이 0→1로 단조 증가인지. 아니면 hourShare를 건드리지 않고 멈춤
      const okCurve = (c) => c && c.cum.length === ENDS.length && c.cum.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v >= c.cum[i - 1] - 1e-9)) && c.cum[c.cum.length - 1] === 1;
      if (!okCurve(cur.wd)) return finish(false, "시간대별 곡선이 이상해서 안 바꿨어요 (평일)");
      step = "저장";
      const prev = (await get()).hourShare || {};
      const next = { ...prev, from: lo, to: hi, note: prev.note || "시간대별 매출(Gross) 누적 비율. ends[k]시까지의 누적 비율 cum[k]. wd=월~금, sat, sun", src: "GW Agent 시간대별 조회", at: Date.now() };
      ["wd","sat","sun"].forEach((k) => { if (okCurve(cur[k])) next[k] = cur[k]; });
      await set("hourShare", next);
      return finish(true, `시간대별 비율 새로 만듦 (${lo.slice(5)}~${hi.slice(5)} · 평일 ${cnt.wd}·토 ${cnt.sat}·일 ${cnt.sun}일)`, { from: lo, to: hi, n: cnt.wd + cnt.sat + cnt.sun });
    } catch (e) {
      return finish(false, `${step}에서 멈춤: ${e && e.message ? e.message : e}`);
    }
  }

  // ---------- 주문현황 (11/13 KM, kind "orders") ----------
  //  이 매장 주문현황을 기간으로 조회해서 날짜별 발주를 시트 misOrder.날짜 = { at, rows: [{ code, name, qty, unit, deliv }] } 에 둠 (이 매장 자료, 조회만).
  //  앱은 그날 앱에 발주 기록이 없을 때만 이걸 입고로 씀 → MIS에 직접 넣은 발주도 앎 (10/30·11/2·11/7·11/10·11/11이 빠져 예상 재고 32%가 틀어졌음)
  //  메뉴 경로: 주문정보관리 › 주문등록(폴더) › 주문현황. "주문등록"은 폴더이자 발주 입력 화면 이름이라 글자로 누르지 않고 펼침으로만 엶
  async function runOrders() {
    try {
      step = "주문현황 메뉴";
      const isMenu = (w) => { try { return !!w.document.querySelector(".tree-title") || /LeftFrame/i.test(w.location.href); } catch (e) { return true; } };
      const dateInputs = (w) => { try { const $w = w.jQuery; return $w ? [...w.document.querySelectorAll("input")].filter((i) => $w(i).data("datebox")) : []; } catch (e) { return []; } };
      const waitFor = async (fn, ms) => { for (let k = 0; k < ms / 200; k++) { const r = fn(); if (r) return r; await sleep(200); } return null; };
      const STAT_RE = /^주문\s*현황$/;
      const trees = () => frames().filter((w) => { try { return !!w.document.querySelector(".tree-title"); } catch (e) { return false; } });
      // 접힌 폴더 펴기 (펼침 단추·트리 기능만, 메뉴 이름은 안 누름)
      const expandAll = async () => { for (let round = 0; round < 6 && !byText(STAT_RE, ".tree-title"); round++) { let did = 0; for (const w of trees()) { let hits = []; try { hits = [...w.document.querySelectorAll(".tree-hit.tree-collapsed")]; } catch (e) {} for (const h of hits) { let ok = false; try { const $w = w.jQuery, node = h.closest(".tree-node"), root = $w && $w.fn && $w.fn.tree && node ? $w(h).closest("ul.tree") : null; if (root && root.length) { root.tree("expand", node); ok = true; } } catch (e) {} if (!ok) { try { press(w, h); ok = true; } catch (e) {} } if (ok) did++; } } if (!did) break; await sleep(700); } };
      const before = new Set(frames());
      const bodyHas = (w) => { try { return /주문\s*현황/.test(w.document.title + " " + (w.document.body ? w.document.body.innerText.slice(0, 2000) : "")); } catch (e) { return false; } };
      const isReport = () => { const fs = frames().filter((w) => w !== window.top && !isMenu(w)); return fs.find((w) => bodyHas(w) && dateInputs(w).length) || fs.find((w) => !before.has(w) && dateInputs(w).length); };
      let R = null;
      for (let t = 0; t < 3 && !R; t++) {
        if (!byText(STAT_RE, ".tree-title")) await expandAll();
        const hit = byText(STAT_RE, ".tree-title"); if (!hit) break;
        hit.el.click(); hit.el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        R = await waitFor(isReport, 8000);
      }
      if (!R) return finish(false, "주문현황 메뉴를 못 열었어요");
      for (let k = 0; k < 60 && !(R.jQuery && dateInputs(R).length); k++) { await sleep(250); R = isReport() || R; }
      const $ = R.jQuery, d = R.document;
      if (!$) return finish(false, "주문현황 화면에 jQuery가 없어요");
      step = "조회일";
      const to = job.to, from = job.from || (() => { const t = new Date(to + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 14); return t.toISOString().slice(0, 10); })();
      const fmt = (iso, like) => (/^\d{8}$/.test(like) ? iso.replace(/-/g, "") : /^\d{4}\.\d\d\.\d\d$/.test(like) ? iso.replace(/-/g, ".") : /^\d{4}\/\d\d\/\d\d$/.test(like) ? iso.replace(/-/g, "/") : iso);
      const dbs = [...d.querySelectorAll("input")].filter((i) => $(i).data("datebox"));
      if (dbs.length >= 2) { const like = $(dbs[0]).datebox("getValue") || ""; $(dbs[0]).datebox("setValue", fmt(from, like)); $(dbs[1]).datebox("setValue", fmt(to, like)); }
      else if (dbs.length === 1) { const like = $(dbs[0]).datebox("getValue") || ""; $(dbs[0]).datebox("setValue", fmt(to, like)); }
      step = "매장";
      const all = [...d.querySelectorAll("input")];
      if (!all.some((i) => String(i.value).includes(STORE))) { const code = all.find((i) => /store|stor|shop|cd_?str|cd_?shop|매장/i.test(i.id + i.name) && !/nm|name/i.test(i.id + i.name)); if (code) { if ($(code).data("textbox")) $(code).textbox("setValue", STORE); else code.value = STORE; } }
      step = "조회";
      const btn = [...d.querySelectorAll("a, button, input[type=button], span.l-btn-text")].find((b) => /^조\s*회$/.test((b.textContent || b.value || "").trim()));
      if (!btn) return finish(false, "주문현황 조회 버튼을 못 찾았어요");
      const L = loader($, d);
      await L.idle(T.q);
      let hit = null;
      for (let t = 0; t < 2 && !(hit && hit.rows.length); t++) { const prev = L.refs(); press(R, btn.closest("a, button, input") || btn); hit = await L.awaitLoad(prev, T.q); if (!hit) await L.idle(T.q); }
      if (!hit) { const g = L.grids().find((x) => (L.raw(x) || []).length); if (g) hit = { grid: g, rows: L.raw(g) }; }
      step = "읽기";
      const title = (c) => String(c.title || "").replace(/<[^>]+>/g, "").trim();
      const probe = L.grids().map((g) => { const o = $(g).datagrid("options"), cs = [].concat(...(o.frozenColumns || []), ...(o.columns || [])).filter((c) => c.field); return { id: g.id || "", cols: cs.map((c) => `${c.field}=${title(c)}`), n: (L.raw(g) || []).length, rows: (L.raw(g) || []).slice(0, 3) }; });
      await set("orderProbe", { at: Date.now(), from, to, grids: probe });
      if (!hit || !hit.rows.length) return finish(true, `주문현황 ${from.slice(5)}~${to.slice(5)} 조회 결과 없음`, { days: 0 });
      // 열 찾기: 품목코드 · 수량 · 주문일(없으면 입고예정일) · 품목명 · 단위 · 입고(납품)예정일
      const toIso = (v) => { const m = /^(\d{4})[-./]?(\d\d)[-./]?(\d\d)/.exec(String(v ?? "").trim()); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
      let use = null;
      for (const g of L.grids()) {
        const o = $(g).datagrid("options"), cs = [].concat(...(o.frozenColumns || []), ...(o.columns || [])).filter((c) => c.field), rs = L.raw(g) || [];
        if (!rs.length) continue;
        const f = (re, bad) => cs.find((c) => re.test(title(c) + " " + c.field) && !(bad && bad.test(title(c) + " " + c.field)));
        const code = f(/품목\s*코드|상품\s*코드|ITEM_?CD|GOODS_?CD|PROD_?CD|CD_?ITEM|CD_?GOODS/i);
        const qty = f(/주문\s*수량|발주\s*수량|ORD_?QTY|QTY_?ORD|수량|QTY/i, /단가|금액|AMT|PRICE|합계/i);
        const od = f(/주문\s*일|발주\s*일|ORD_?DT|DT_?ORD|일자/i, /입고|납품|배송|DLV|IN_?DT/i);
        const dd = f(/입고|납품|배송|DLV|IN_?DT/i);
        const name = f(/품목\s*명|상품\s*명|ITEM_?NM|GOODS_?NM|NM_?ITEM|NM_?GOODS/i), unit = f(/단위|UNIT/i, /단가/i);
        if (code && qty && (od || dd)) { use = { rs, code, qty, od: od || dd, dd, name, unit }; break; }
      }
      if (!use) return finish(false, `주문현황 열을 못 찾았어요 (머리글: ${probe.map((g) => g.cols.join(",")).join(" | ").slice(0, 300)})`);
      const by = new Map();
      use.rs.forEach((r) => { const dt = toIso(r[use.od.field]), q = num(r[use.qty.field]), c = String(r[use.code.field] ?? "").trim(); if (!dt || !c || !(q > 0) || dt < from || dt > to) return; if (!by.has(dt)) by.set(dt, []);
        by.get(dt).push({ code: c, name: use.name ? String(r[use.name.field] ?? "").trim().slice(0, 60) : "", qty: q, unit: use.unit ? String(r[use.unit.field] ?? "").trim().slice(0, 10) : "", deliv: use.dd && use.dd !== use.od ? toIso(r[use.dd.field]) : null }); });
      step = "시트 저장";
      let saved = 0; for (const [dt, rows] of [...by].sort()) { await set("misOrder." + dt, { at: Date.now(), rows }); saved++; }
      await set("misOrderScan", { at: Date.now(), from, to, days: saved });
      return finish(true, `주문현황 ${from.slice(5)}~${to.slice(5)} · ${saved}일 발주 ${[...by.values()].reduce((a, x) => a + x.length, 0)}줄 저장`, { days: saved });
    } catch (e) {
      return finish(false, `${step}에서 멈춤: ${e && e.message ? e.message : e}`);
    }
  }

  // ---------- 몰이 (11/12): 맡은 요청을 하고, 그새 폰에서 다른 버튼을 눌러 덧붙인 요청(also)도 같은 창에서 이어서 ----------
  //  salesPush = { id, at, status, kind, from, to, also: { menu|gross: { from, to } }, parts: { gross|menu|now: { status, text, doneAt, … } }, cur, prog }
  //  예전엔 두 버튼이 한 칸(salesPush)을 서로 덮어써서, 하나가 도는 중에 다른 걸 누르면 둘 다 꼬였음
  const base = job, k0 = base.kind || "gross", done = {};
  const labelOf = { gross: "Gross", menu: "메뉴 판매", now: "지금 Gross", scout: "MIS 메뉴 살펴보기", hour: "시간대별 매출", orders: "주문현황" };
  // 종류별 할 일 (11/13): 새 종류는 여기에 더하면 확장을 다시 깔지 않아도 됨. 모르는 종류는 하지 않고 그렇게 적음
  const RUN = { gross: () => runGross(), now: () => runGross(), menu: () => runMenu(), scout: () => runScout(), hour: () => runHour(), orders: () => runOrders() };
  const needRange = (k) => /^(gross|menu)$/.test(k);
  const queue = [[k0, { from: base.from, to: base.to, force: base.force }]];
  try {
    while (queue.length && !replaced) {
      const [kind, req] = queue.shift();
      job = { ...base, kind: kind === "gross" ? undefined : kind, from: req.from, to: req.to, force: req.force };
      step = "시작"; Object.keys(diag).forEach((k) => delete diag[k]);
      if (kind !== k0) await merge("salesPush", { cur: kind, prog: null }).catch(() => {});
      const r = left() < T.reserve ? { ok: false, text: "시간이 모자라 시작 못 함 · 다시 눌러 주세요", extra: {} } : RUN[kind] ? await RUN[kind]() : { ok: false, text: "모르는 종류라 하지 않음: " + String(kind).slice(0, 20), extra: {} };
      await progQ.catch(() => {});
      if (replaced) break;
      done[kind] = r;
      // 이 종류의 결과를 바로 적음 (다른 종류가 이어지더라도 폰에는 먼저 ✓가 보이게)
      const d1 = await merge("salesPush", { parts: { [kind]: { status: r.ok ? "done" : "error", doneAt: Date.now(), text: r.text, ...r.extra } }, cur: null, prog: null }).catch(() => null);
      const q = (d1 && d1.salesPush) || (await get().catch(() => ({}))).salesPush || {};
      if (q.id !== base.id) { replaced = true; break; }
      Object.keys(q.also || {}).forEach((k) => { if (RUN[k] && k !== "now" && !done[k] && !queue.some(([x]) => x === k) && q.also[k] && (!needRange(k) || (q.also[k].from && q.also[k].to))) queue.push([k, q.also[k]]); });
    }
    if (!replaced) {
      const kinds = Object.keys(done), okAll = kinds.every((k) => done[k].ok), first = done[k0] || { text: "", extra: {} };
      const text = kinds.length > 1 ? kinds.map((k) => `${labelOf[k] || k}: ${done[k].text}`).join("\n") : first.text;
      await merge("salesPush", { status: okAll ? "done" : "error", doneAt: Date.now(), text, ...first.extra, cur: null, prog: null });
    }
  } catch (e) {
    // 최종 상태를 못 적음(시트 연결 끊김 등): 확장이 시간 초과로 정리함
  } finally { window.__misSalesBusy = false; }
})();
