// HR 주간스케쥴(시간) 화면 조작 (GW Agent 1.12.0) — hr.pljec.cloud 탭의 페이지 쪽(MAIN world)에서 한 단계씩 실행
//  bg.js가 chrome.scripting.executeScript({ world: "MAIN", func: hrsStep, args: [op, arg] })로 부름 → 함수 하나에 다 들어 있어야 함(밖의 이름을 못 씀)
//  화면 ID 접두어 hrt2325 (11/16 KM이 실제 화면에서 확인해 준 것): 검색 조건·버튼·팝업·엑셀 업로드 칸은 아래 ID 그대로
//  원칙
//   · 주간스케쥴(시간) 화면만 씀. 인사정보·개인정보 영역은 열지도 읽지도 않음. 표에서는 사번만 읽어 보낸 것과 맞춰 봄
//   · 서버를 직접 부르지 않고 사람이 누르는 단추 그대로 (업로드는 숨은 파일 칸에 파일을 넣고 change)
//   · confirm()은 그 단추를 누를 때만, 예상한 문구일 때만 "예" (그 밖의 문구는 "아니요"로 두고 멈춤)
//   · 초기화·전주복사·확정취소·공지취소·누락건 추가 단추는 누르지 않음
//   · 결과는 토스트(doClientMsg)·알림창 문구로 판단. 예상 밖 문구가 뜨면 그 단계에서 멈추고 문구 그대로 돌려줌
async function hrsStep(op, a) {
  a = a || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $id = (id) => document.getElementById(id);
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (!r.width && !r.height) return false; try { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none"; } catch (e) { return true; } };
  const tx = (el) => (el ? String(el.textContent || "").replace(/[\s​]+/g, " ").trim() : "");
  const off = (el) => !el || el.disabled || el.getAttribute("disabled") != null || /\b(k-state-disabled|k-disabled|disabled)\b/.test(el.className || "") || el.getAttribute("aria-disabled") === "true";
  const tap = (el) => { if (!el) return false; try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })); el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })); el.click(); return true; } catch (e) { return false; } };
  const fail = (stage, message, extra) => Object.assign({ ok: false, stage, message }, extra || {});

  // ---- 토스트·알림창 받아 두기 (한 번만 설치) ----
  const H = window.__gwHrs || (window.__gwHrs = { msgs: [], dlg: [], hooked: false });
  const note = (kind, m) => { const s = String(m == null ? "" : m).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); if (s) H.msgs.push({ t: Date.now(), kind, msg: s.slice(0, 300) }); };
  if (!H.hooked) {
    H.hooked = true;
    try { // 사이트의 메시지 함수 (doClientMsg) — 있으면 감싸서 문구를 받아 둠
      if (typeof window.doClientMsg === "function" && !window.doClientMsg.__gw) { const f = window.doClientMsg; window.doClientMsg = function () { try { note("toast", [].slice.call(arguments).filter((x) => typeof x === "string").join(" ")); } catch (e) {} return f.apply(this, arguments); }; window.doClientMsg.__gw = 1; }
    } catch (e) {}
    try { // 화면에 새로 뜨는 토스트·알림 모양 (함수 이름이 달라도 놓치지 않게)
      new MutationObserver((ms) => { for (const m of ms) for (const nd of m.addedNodes) { if (nd.nodeType !== 1) continue; const c = String(nd.className || "") + " " + (nd.getAttribute("role") || ""); if (/toast|noty|notif|growl|alert|message|msg/i.test(c) && !/k-grid|tooltip/i.test(c)) { const t = tx(nd); if (t && t.length < 300) note("dom", t); } } }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    try { const al = window.alert; window.alert = function (m) { note("alert", m); if (!H.quiet) return al.apply(this, arguments); }; } catch (e) {}
  }
  const mark = () => H.msgs.length;
  // 그 뒤로 뜬 문구 중: 기다리던 것 → ok, 다른 것(오류) → 그 문구
  async function waitMsg(from, good, ms, okIf) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const got = H.msgs.slice(from);
      const hit = got.find((x) => good.test(x.msg));
      if (hit) return { ok: true, msg: hit.msg };
      const bad = got.find((x) => !good.test(x.msg) && !/엑셀 데이터가 화면에 반영|조회되었습니다|검색되었습니다/.test(x.msg));
      if (bad) return { ok: false, msg: bad.msg };
      if (okIf && okIf()) return { ok: true, msg: "" };
      await sleep(200);
    }
    return { ok: false, msg: "", timeout: true };
  }
  // 로딩 덮개가 사라질 때까지 (JLAMP.common.loading · kendo 로딩)
  async function idle(ms) {
    const t0 = Date.now(); await sleep(150);
    while (Date.now() - t0 < (ms || 30e3)) {
      const busy = [...document.querySelectorAll(".k-loading-mask, .k-loading-image, .jlamp-loading, .loading-wrap, .loading_wrap, #loading, .blockUI.blockOverlay, [class*='loading-layer']")].some(vis);
      if (!busy) return true;
      await sleep(200);
    }
    return false;
  }
  // confirm(): 이 단추에서 뜨는 예상 문구에만 "예"
  async function withConfirm(expect, fn) {
    const orig = window.confirm, seen = [];
    window.confirm = function (m) { const s = String(m || ""); seen.push(s); return !!expect && expect.test(s); };
    try { await fn(); } finally { setTimeout(() => { if (window.confirm !== orig) window.confirm = orig; }, 6000); }
    return seen;
  }

  // ---- 표 읽기: kendo 자료가 있으면 그것, 없으면 표 머리글로 (사번·상태만) ----
  const $ = window.jq || window.jQuery;
  function gridsIn(root) { return root ? [...root.querySelectorAll("[data-role='grid'], .k-grid")].filter((g, i, all) => all.indexOf(g) === i) : []; }
  function gridItems(g) { try { const w = $ && $(g).data("kendoGrid"); if (w && w.dataSource) return w.dataSource.data().toJSON ? w.dataSource.data().toJSON() : [].slice.call(w.dataSource.data()); } catch (e) {} return null; }
  const EMP_KEY = /^(emp_?no|emp_?cd|emp_?code|sabun|sawon_?(cd|code|no)|user_?(no|id))$/i;
  function empNosOf(root) {
    for (const g of gridsIn(root)) {
      const it = gridItems(g);
      if (it && it.length) { const k = Object.keys(it[0]).find((x) => EMP_KEY.test(x)) || Object.keys(it[0]).find((x) => it.every((r) => /^\d{6,12}$/.test(String(r[x] == null ? "" : r[x]))) && /emp|sabun|no|cd/i.test(x)); if (k) return { from: "grid", keys: it.map((r) => String(r[k])) }; }
      const head = [...g.querySelectorAll("thead th")]; const ci = head.findIndex((th) => /사원\s*코드|사번|사원\s*번호/.test(tx(th)));
      if (ci >= 0) { const rows = [...g.querySelectorAll("tbody tr")].filter((tr) => tr.cells.length > ci && !/norecords/.test(tr.className || "")); return { from: "table", keys: rows.map((tr) => tx(tr.cells[ci])).filter((s) => /^\d{4,12}$/.test(s)) }; }
    }
    // 머리글이 따로 붙은 kendo 표 (머리글 표·내용 표가 나뉨)
    const hs = root ? [...root.querySelectorAll(".k-grid-header th, th")] : [], h = hs.find((th) => /사원\s*코드|사번|사원\s*번호/.test(tx(th)));
    if (h) { const g = h.closest(".k-grid") || root, ci = [...h.parentElement.children].indexOf(h); const rows = [...g.querySelectorAll(".k-grid-content tbody tr, tbody tr")].filter((tr) => tr.cells.length > ci); return { from: "table2", keys: rows.map((tr) => tx(tr.cells[ci])).filter((s) => /^\d{4,12}$/.test(s)) }; }
    return null;
  }
  function statusOf(root) {
    for (const g of gridsIn(root)) { const it = gridItems(g); if (it && it.length) { const k = Object.keys(it[0]).find((x) => /schedule_?status/i.test(x)); if (k) return { from: "grid", list: [...new Set(it.map((r) => String(r[k] || "")))] }; } }
    const hid = root && root.querySelector("#hrt2325_schedule_status, [id$='schedule_status'], input[name='schedule_status']"); if (hid && hid.value) return { from: "input", list: [String(hid.value)] };
    const cc = $id("hrt2325_btn_confirm_cancel") || [...document.querySelectorAll("button, a")].find((b) => vis(b) && /^확정\s*취소$/.test(tx(b)));
    if (cc && vis(cc) && !off(cc)) return { from: "button", list: ["CONFIRM"] };
    return { from: "none", list: [] };
  }

  // ---------------- 단계 ----------------
  if (op === "done") { H.quiet = false; return { ok: true }; } // 끝나면 알림창을 다시 사람에게 보이게
  H.quiet = true; // 자동으로 도는 동안 알림창(alert)은 띄우지 않고 문구만 받아 둠 (창이 뜨면 자동이 멈춤)
  if (op === "probe") {
    const pw = [...document.querySelectorAll('input[type="password"]')].some(vis);
    return { ok: true, url: location.origin + location.pathname, login: pw || /^\/main\/login/.test(location.pathname), menu: !!document.querySelector("a[menu-app-id]"), screen: !!$id("hrt2325_btn_search"), api: typeof window.hrt2325 === "object" && !!window.hrt2325 };
  }

  if (op === "open") { // 근태관리 → 주간스케쥴(시간)
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < 45e3) {
      if ($id("hrt2325_btn_search") && $id("hrt2325_dept_category")) { await idle(15e3); return { ok: true }; }
      if ([...document.querySelectorAll('input[type="password"]')].some(vis)) return fail("open", "HR 로그인이 풀려 있어요 (매장 PC에서 HR에 로그인한 뒤 다시 전송)", { code: "login" });
      const a = document.querySelector('a[menu-app-id="HRT/W_HRT2325"]') || [...document.querySelectorAll("a[menu-app-id]")].find((x) => /주간\s*스케[쥴줄]\s*\(\s*시간\s*\)/.test(tx(x)));
      if (!a) { const top = document.querySelector('li[menu-desc="근태관리"]'); tap(top && (top.querySelector(".menu-step1") || top)); }
      else if (i % 2 === 0) { const ul = a.closest("ul"), grp = ul && ul.previousElementSibling; if (grp && i === 0) tap(grp.querySelector(".jlamp-gnb-menu-label") || grp); await sleep(250); tap(a); }
      else tap(a.querySelector("span") || a);
      i++; await sleep(1000);
    }
    return fail("open", "주간스케쥴(시간) 화면을 못 열었어요 (메뉴 근태관리 › 주간스케쥴(시간))");
  }

  if (op === "cond") { // 소속구분·주차 맞추고 검색 → 상태·사번
    if (!window.hrt2325) return fail("open", "주간스케쥴(시간) 화면 기능(hrt2325)이 없어요");
    const site = $id("hrt2325_search_site_code"); if (site && a.site && String(site.value) !== String(a.site)) return fail("open", `사업장이 달라요 (화면 ${site.value}, 기대 ${a.site})`);
    const leave = $id("hrt2325_search_leave_yn"); if (leave && leave.type === "checkbox" && !leave.checked) tap(leave); // 휴직자 미포함 유지
    // 1) 소속구분
    const hid = $id("hrt2325_dept_category");
    if (!hid) return fail("open", "소속구분 칸(#hrt2325_dept_category)이 없어요");
    for (let k = 0; k < 4 && String(hid.value) !== a.dept; k++) {
      let done = false;
      try { const w = $ && ($(hid).data("kendoDropDownList") || $(hid).data("kendoComboBox")); if (w) { w.value(a.dept); w.trigger("change"); done = true; } } catch (e) {}
      if (!done || String(hid.value) !== a.dept) {
        const box = hid.closest("td, li, .search-item, .form-group, div") || document.body;
        const trig = [...box.querySelectorAll("button, a, span, .k-dropdown, .k-picker, [role=listbox], [role=combobox]")].find((b) => vis(b) && /^(BOH|FOH)\b/.test(tx(b)));
        if (trig) { tap(trig); await sleep(300); }
        const opt = [...document.querySelectorAll("li, a, button, [role=option], label, span")].find((x) => vis(x) && tx(x) === a.dept && x !== trig && !(trig && trig.contains(x)));
        if (opt) tap(opt);
        await sleep(400);
      }
    }
    if (String(hid.value) !== a.dept) return fail("open", `소속구분을 ${a.dept}로 못 맞췄어요 (지금 ${hid.value || "빈칸"})`);
    // 2) 주차: 라벨 "48주(11/23~11/29)"의 날짜가 보드 주와 같아질 때까지 ‹ ›
    const md = (d) => d.slice(5, 7) + "/" + d.slice(8, 10);
    const label = () => { const re = /(\d{1,2})\s*주\s*\(\s*(\d{2})\/(\d{2})\s*~\s*(\d{2})\/(\d{2})\s*\)/; const els = [...document.querySelectorAll("span, div, label, input, button, a, strong, p, td")].filter(vis); for (const el of els) { const s = el.tagName === "INPUT" ? el.value : tx(el); const m = re.exec(s || ""); if (m && (s || "").length < 60) return { text: m[0], from: m[2] + "/" + m[3], to: m[4] + "/" + m[5] }; } return null; };
    const want = { from: md(a.weekStart), to: md(a.weekEnd) };
    const yyyy = () => +(($id("hrt2325_yyyy") || {}).value || a.weekStart.slice(0, 4));
    const toDate = (mmdd) => { const y = yyyy(), c = [y - 1, y, y + 1].map((yy) => Date.parse(`${yy}-${mmdd.replace("/", "-")}T00:00:00Z`)), t = Date.parse(a.weekStart + "T00:00:00Z"); return c.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), c[1]); };
    let L = label(), moves = 0;
    while (L && !(L.from === want.from && L.to === want.to) && moves < 60) {
      const dir = toDate(L.from) < Date.parse(a.weekStart + "T00:00:00Z") ? "next" : "prev";
      const before = L.text;
      try { window.hrt2325.moveWeek(dir); } catch (e) { return fail("open", "주차 이동(moveWeek)이 안 돼요: " + (e && e.message)); }
      moves++;
      for (let k = 0; k < 30; k++) { await sleep(200); L = label(); if (L && L.text !== before) break; }
      await idle(15e3);
    }
    if (!L) return fail("open", "주차 표시(예: 48주(11/23~11/29))를 화면에서 못 찾았어요");
    if (!(L.from === want.from && L.to === want.to)) return fail("open", `주차를 ${want.from}~${want.to}로 못 맞췄어요 (지금 ${L.text})`);
    // 3) 검색
    const m0 = mark();
    tap($id("hrt2325_btn_search")); await idle(30e3); await sleep(500); await idle(30e3);
    const after = H.msgs.slice(m0).find((x) => /오류|실패|error|없습니다|세션|로그인/i.test(x.msg));
    if (after) return fail("open", "검색 중: " + after.msg);
    const st = statusOf(document.querySelector("[id^='hrt2325_']") ? document.body : document.body), emp = empNosOf(document.body);
    return { ok: true, week: L.text, dept: hid.value, status: st.list, statusFrom: st.from, hrEmp: emp ? emp.keys : null, empFrom: emp ? emp.from : "none", moves };
  }

  if (op === "day") { // 한 요일: 일자별 수정 → 요일 탭 → 엑셀 업로드 → 사번 맞춤 → 팝업 저장
    const popOpen = () => vis($id("hrt2325_pop_sub")) || vis($id("hrt2325_pop_btn_save"));
    if (!popOpen()) {
      const btn = $id("hrt2325_btn_pop"); if (!btn || off(btn)) return fail("upload", "[일자별 수정] 단추가 없거나 꺼져 있어요", { day: a.dow });
      const seen = await withConfirm(null, async () => { tap(btn); await sleep(600); });
      if (seen.length) return fail("upload", "저장 안 된 내역이 있다고 해서 멈춤: " + seen[0], { day: a.dow });
      for (let k = 0; k < 75 && !popOpen(); k++) await sleep(200);
      if (!popOpen()) return fail("upload", "[일자별 수정] 창이 안 열렸어요", { day: a.dow });
      await idle(20e3);
    }
    // 요일 탭
    const radio = document.querySelector(`input[name="hrt2325_pop_title"][value="${a.dow}"]`);
    if (!radio) return fail("upload", `요일 탭(${a.dow})을 못 찾았어요`, { day: a.dow });
    for (let k = 0; k < 4 && !radio.checked; k++) { const lb = (radio.id && document.querySelector(`label[for="${radio.id}"]`)) || radio.closest("label") || radio.parentElement; tap(vis(lb) ? lb : radio); if (!radio.checked) tap(radio); await sleep(400); await idle(20e3); }
    if (!radio.checked) return fail("upload", `요일 탭(${a.dow})이 선택되지 않아요`, { day: a.dow });
    await idle(20e3);
    // 엑셀 넣기 (파일 선택 창 없이)
    const inp = $id("hrt2325_day_excel_file");
    if (!inp) return fail("upload", "엑셀 업로드 칸(#hrt2325_day_excel_file)이 없어요", { day: a.dow });
    const bin = atob(a.b64), u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    const file = new File([u8], a.name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const dt = new DataTransfer(); dt.items.add(file);
    let m0 = mark();
    try { inp.value = ""; } catch (e) {}
    inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
    let r = await waitMsg(m0, /엑셀 데이터가 화면에 반영/, 45e3);
    await idle(20e3);
    if (!r.ok) return fail("upload", r.timeout ? "엑셀을 올렸는데 '화면에 반영' 문구가 안 떴어요 (45초)" : r.msg, { day: a.dow, toast: r.msg });
    // 팝업 표의 사번 = 보낸 사번?
    const pop = $id("hrt2325_pop_sub") || document.body, got = empNosOf(pop);
    let notInHr = [], notInFile = [];
    if (got && got.keys.length) { const g = new Set(got.keys), s = new Set(a.empNos); notInHr = a.empNos.filter((x) => !g.has(x)); notInFile = got.keys.filter((x) => !s.has(x)); }
    if (notInHr.length) return fail("upload", `HR 화면에 없는 사번이 있어요(소속구분·재직 확인): ${notInHr.join(", ")}`, { day: a.dow, notInHr });
    if (a.uploadOnly) return { ok: true, day: a.dow, toast: r.msg, rows: got ? got.keys.length : null, notInFile };
    // 팝업 저장 (선택한 요일만 저장, 창은 스스로 닫힘)
    const sv = $id("hrt2325_pop_btn_save"); if (!sv || off(sv)) return fail("save", "팝업 [저장] 단추가 없거나 꺼져 있어요", { day: a.dow });
    m0 = mark();
    const seen = await withConfirm(/저장\s*하시겠습니까/, async () => { tap(sv); });
    r = await waitMsg(m0, /저장되었습니다/, 45e3);
    await idle(20e3);
    if (!r.ok) return fail("save", r.timeout ? "팝업 저장 뒤 '저장되었습니다'가 안 떴어요" : r.msg, { day: a.dow, toast: r.msg, confirms: seen });
    for (let k = 0; k < 50 && popOpen(); k++) await sleep(200);
    return { ok: true, day: a.dow, toast: r.msg, rows: got ? got.keys.length : null, notInFile, closed: !popOpen() };
  }

  if (op === "final") { // 메인 저장(켜져 있을 때만) → 공지 → 확정
    const steps = [];
    const main = $id("hrt2325_btn_save");
    if (main && vis(main) && !off(main)) {
      const m0 = mark(); const seen = await withConfirm(/저장\s*하시겠습니까/, async () => { tap(main); });
      const r = await waitMsg(m0, /저장되었습니다|저장할 내역이 없|변경된 내역이 없/, 45e3); await idle(20e3);
      if (!r.ok) return fail("save", r.timeout ? "메인 저장 뒤 문구가 안 떴어요" : r.msg, { steps, confirms: seen });
      steps.push({ stage: "save", toast: r.msg });
    } else steps.push({ stage: "save", toast: "(메인 저장 꺼져 있음 → 건너뜀)" });
    if (a.stopBefore === "notice") return { ok: true, steps };
    const nb = $id("hrt2325_btn_notice");
    if (!nb || off(nb)) return fail("notice", "[공지] 단추가 없거나 꺼져 있어요", { steps });
    let m0 = mark(); let seen = await withConfirm(/공지\s*하시겠습니까/, async () => { tap(nb); });
    let r = await waitMsg(m0, /공지\s*되었습니다/, 60e3); await idle(20e3);
    if (!r.ok) return fail("notice", r.timeout ? (seen.length ? "공지 확인창 뒤 '공지 되었습니다'가 안 떴어요" : "공지 확인창이 안 떴어요") : r.msg, { steps, confirms: seen });
    steps.push({ stage: "notice", toast: r.msg });
    if (a.stopBefore === "confirm") return { ok: true, steps };
    const cb = $id("hrt2325_btn_confirm");
    for (let k = 0; k < 25 && (!cb || off(cb)); k++) await sleep(200);
    if (!cb || off(cb)) return fail("confirm", "공지 뒤에도 [확정] 단추가 꺼져 있어요", { steps });
    m0 = mark(); seen = await withConfirm(/확정\s*하시겠습니까/, async () => { tap(cb); });
    r = await waitMsg(m0, /확정\s*되었습니다/, 60e3); await idle(20e3);
    if (!r.ok) return fail("confirm", r.timeout ? "확정 뒤 '확정 되었습니다'가 안 떴어요" : r.msg, { steps, confirms: seen });
    steps.push({ stage: "confirm", toast: r.msg });
    return { ok: true, steps };
  }
  return fail("open", "알 수 없는 단계: " + op);
}
if (typeof module !== "undefined") module.exports = { hrsStep };
