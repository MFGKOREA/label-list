// HR 주간스케쥴(시간) 화면 조작 (GW Agent 1.12.0) — hr.pljec.cloud 탭의 페이지 쪽(MAIN world)에서 한 단계씩 실행
//  bg.js가 chrome.scripting.executeScript({ world: "MAIN", func: hrsStep, args: [op, arg] })로 부름 → 함수 하나에 다 들어 있어야 함(밖의 이름을 못 씀)
//  11/16 KM이 실제 화면(48주 BOH 월요일 업로드·팝업 저장 성공)에서 확인한 사실대로:
//   · 주차 상태 = getMasterList_prc 응답 data.infoEnc를 decParam으로 푼 [{schedule_status}] (EDIT·NOTICE·CONFIRM·빈 배열)
//   · 요일 탭은 label을 눌러야 그날 자료가 로딩됨(getMasterList_prc DETAIL) → 응답·로딩이 끝난 뒤 업로드
//   · 업로드 성공 문구는 행에 오류가 있어도 똑같이 뜸 → 팝업 표(#hrt2325_pop_list_html) 행마다 chk_message·사번·근태·시간을 확인
//  원칙
//   · 주간스케쥴(시간) 화면만 씀. 메인 표는 읽지 않음(직책 칸에 휴대폰 번호가 보임). 팝업 표에서 emp_code·emp_name·chk_message·근태·시간만 읽음
//   · 사람이 누르는 단추 그대로 (서버를 직접 부르지 않음). 업로드는 숨은 파일 칸에 파일을 넣고 change
//   · confirm()은 그 단추를 누를 때만, 예상한 문구일 때만 "예". 그 밖의 문구는 "아니요"로 두고 멈춤
//   · 전주복사·확정취소·공지취소·누락건 추가는 누르지 않음. 초기화는 allowInit일 때 업로드 전에만
async function hrsStep(op, a) {
  a = a || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $id = (id) => document.getElementById(id);
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (!r.width && !r.height) return false; try { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none"; } catch (e) { return true; } };
  const tx = (el) => (el ? String(el.textContent || "").replace(/[\s​]+/g, " ").trim() : "");
  const off = (el) => !el || el.disabled || el.getAttribute("disabled") != null || /\b(k-state-disabled|k-disabled|disabled)\b/.test(el.className || "") || el.getAttribute("aria-disabled") === "true";
  const tap = (el) => { if (!el) return false; try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })); el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })); el.click(); return true; } catch (e) { return false; } };
  const fail = (stage, message, extra) => Object.assign({ ok: false, stage, message, ajax: (window.__gwHrs ? window.__gwHrs.ajax.slice(-6) : []) }, extra || {});
  const $ = window.jq || window.jQuery;
  const decode = (v) => { try { let x = typeof window.decParam === "function" ? window.decParam(v) : v; if (typeof x === "string") x = JSON.parse(x); return x; } catch (e) { return null; } };

  // ---- 문구·서버 응답 받아 두기 (한 번만) ----
  const H = window.__gwHrs || (window.__gwHrs = { msgs: [], ajax: [], sent: [], seq: 0, status: [], hooked: false, quiet: false });
  const clean = (m) => String(m == null ? "" : m).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const note = (kind, m) => { const s = clean(m); if (s) H.msgs.push({ t: Date.now(), kind, msg: s }); };
  if (!H.hooked) {
    H.hooked = true;
    try { // doClientMsg(문자열 또는 {message})
      if (typeof window.doClientMsg === "function") { const f = window.doClientMsg; window.doClientMsg = function () { try { const xs = [].slice.call(arguments).map((x) => (x && typeof x === "object" ? x.message || x.msg || "" : typeof x === "string" ? x : "")).filter(Boolean); note("msg", xs.join(" ")); } catch (e) {} return f.apply(this, arguments); }; }
    } catch (e) {}
    try { const al = window.alert; window.alert = function (m) { note("alert", m); if (!H.quiet) return al.apply(this, arguments); }; } catch (e) {}
    try { // 엔드포인트별 HTTP 상태·returnCode. 내용은 남기지 않고, 주차 상태(schedule_status)만 풀어 둠
      if ($) $(document).ajaxSend(function (ev, xhr, st) { const m = /\/(\w+_prc)\b/.exec(String((st && st.url) || "")); if (!m) return; st.__gw = ++H.seq; H.sent.push({ t: Date.now(), ep: m[1], id: st.__gw }); }); // 보낸 요청에 번호 → 그 요청의 응답만 기다림
      if ($) $(document).ajaxComplete(function (ev, xhr, st) {
        const url = String((st && st.url) || ""), m = /\/(\w+_prc)\b/.exec(url); if (!m) return;
        let j = null; try { j = xhr.responseJSON || JSON.parse(xhr.responseText || "null"); } catch (e) {}
        const rc = j && (j.returnCode != null ? j.returnCode : j.data && j.data.returnCode);
        const pd = (j && (j.data || j)) || {}, ec = pd.p_error_code != null ? pd.p_error_code : j && j.p_error_code, rn = pd.p_row_count != null ? pd.p_row_count : j && j.p_row_count;
        const ent = { t: Date.now(), ep: m[1], http: xhr.status, rc: rc == null ? null : String(rc), id: (st && st.__gw) || 0, ec: ec == null ? null : String(ec), rows: rn == null ? null : +rn };
        if (m[1] === "getMasterList_prc" && j && j.data && j.data.infoEnc != null) { const d = decode(j.data.infoEnc); if (Array.isArray(d)) { ent.st = [...new Set(d.map((r) => String((r && r.schedule_status) || "")).filter(Boolean))]; ent.n = d.length; } }
        H.ajax.push(ent);
      });
    } catch (e) {}
  }
  const mark = () => ({ m: H.msgs.length, a: H.ajax.length, s: H.seq });
  const errText = (s) => /오류|실패|불가|error|exception|필수|다름|없습니다|확인해|세션|로그인/i.test(s);
  // 기다리던 문구 → ok, 그 사이 오류 문구 → 그 문구
  async function waitMsg(from, good, ms, okIf) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const got = H.msgs.slice(from.m);
      const hit = got.find((x) => good.test(x.msg));
      if (hit) return { ok: true, msg: hit.msg };
      const bad = got.find((x) => !good.test(x.msg) && errText(x.msg));
      if (bad) { dismiss(); return { ok: false, msg: bad.msg }; }
      const a5 = H.ajax.slice(from.a).find((x) => x.http >= 400);
      if (a5) return { ok: false, msg: `${a5.ep} HTTP ${a5.http}${a5.http === 500 ? " (Internal Server Error)" : ""}` };
      if (okIf && okIf()) return { ok: true, msg: "" };
      await sleep(150);
    }
    return { ok: false, msg: "", timeout: true };
  }
  function dismiss() { const b = $id("jl_noti_footer_btn1"); if (b && vis(b)) tap(b); } // 오류 알림의 [확인] ("오류 신고"는 안 누름)
  // from(mark) 뒤에 "보낸" 그 엔드포인트 요청의 응답 (ajaxSend 번호로 맞춤. 번호가 없는 옛 기록은 시각으로)
  async function waitAjax(from, ep, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = H.ajax.slice(from.a).find((e) => e.ep === ep && (!e.id || e.id > (from.s || 0))); if (x) return x; await sleep(120); } return null; }
  async function idle(ms) { // 로딩 덮개(JLAMP.common.loading · kendo)가 사라질 때까지
    const t0 = Date.now(); await sleep(120);
    while (Date.now() - t0 < (ms || 15e3)) {
      if (![...document.querySelectorAll(".k-loading-mask, .k-loading-image, .jlamp-loading, .loading-wrap, .loading_wrap, #loading, .blockUI.blockOverlay, [class*='loading-layer'], [class*='loadingBar'], [id*='loading']")].some(vis)) return true;
      await sleep(150);
    }
    return false;
  }
  async function withConfirm(expect, fn) { // 이 단추에서 뜨는 예상 문구에만 "예", 끝나면 되돌림
    const orig = window.confirm, seen = [];
    window.confirm = function (m) { const s = String(m || ""); seen.push(s); return !!expect && expect.test(s); };
    try { await fn(); } finally { setTimeout(() => { window.confirm = orig; }, 4000); }
    return seen;
  }
  // ---- 팝업(#hrt2325_pop_sub, Bootstrap 3.3.5 modal) 열림·닫힘 (11/16 KM: 닫힘에 약 0.36초) ----
  const modal = () => { try { return $ && $("#hrt2325_pop_sub").data("bs.modal"); } catch (e) { return null; } };
  const backdrops = () => document.querySelectorAll(".modal-backdrop").length;
  const popOpen = () => { const m = modal(), el = $id("hrt2325_pop_sub"); return (m ? !!m.isShown : true) && (vis(el) || vis($id("hrt2325_pop_btn_save"))); };
  const popClosed = () => { const m = modal(), el = $id("hrt2325_pop_sub"); let disp = "none"; try { disp = el ? getComputedStyle(el).display : "none"; } catch (e) {} return (!m || m.isShown === false) && disp === "none" && backdrops() === 0; };
  async function waitClosed(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (popClosed()) return true; await sleep(100); } return popClosed(); }
  // 멈춘 모달 정리: modal('hide') → 대기 → 남은 backdrop·body.modal-open 지움 (화면이 막힌 채 남지 않게)
  async function unstick() {
    try { if ($) $("#hrt2325_pop_sub").modal("hide"); } catch (e) {}
    await waitClosed(1500);
    if (!popClosed()) {
      document.querySelectorAll(".modal-backdrop").forEach((b) => b.remove());
      document.body.classList.remove("modal-open"); document.body.style.paddingRight = "";
      const el = $id("hrt2325_pop_sub"); if (el) { el.style.display = "none"; el.classList.remove("in"); el.setAttribute("aria-hidden", "true"); }
      const m = modal(); if (m) m.isShown = false;
      await sleep(200);
    }
    return popClosed();
  }
  const popRows = () => { try { const g = $ && $("#hrt2325_pop_list_html").data("kendoGrid"); if (g) return [].slice.call(g.dataSource.view()); } catch (e) {} return null; };
  const hm = (v) => String(v == null ? "" : v).replace(/[^\d]/g, "").padStart(v ? 4 : 0, "0"); // "09:00"·"0900" → "0900", 빈칸 → ""
  async function closePop() { // 오류로 멈출 때: 저장하지 않고 닫음
    if (popClosed()) return true;
    const box = $id("hrt2325_pop_sub") || document.body;
    const btn = [...box.querySelectorAll("button, a, span")].find((b) => vis(b) && (/^(닫기|취소)$/.test(tx(b)) || /\bclose\b|k-i-close|btn[-_]?close/.test(b.className || "") || b.getAttribute("data-dismiss") === "modal" || b.getAttribute("aria-label") === "Close"));
    await withConfirm(/닫|저장되지 않은|취소/, async () => { if (btn) tap(btn); else { try { if ($) $("#hrt2325_pop_sub").modal("hide"); } catch (e) {} } });
    if (await waitClosed(2000)) return true;
    return unstick();
  }

  // 로그인 판정 (11/16 KM): HR에는 자동완성 방지용 #jlamp_autocomplete_2(type=password, 투명도 0, 0×0)가 늘 있음 → 비밀번호 칸이 있다는 것만으론 안 됨
  //  로그인됨 = window.hrt2325 또는 #hrt2325_btn_search 또는 메뉴(a[menu-app-id]). 로그아웃 = 진짜로 보이는 아이디 칸 + [로그인] 단추 (+ 보이는 비밀번호 칸)
  const realVis = (el) => {
    if (!el || /^jlamp_autocomplete/.test(el.id || "")) return false;
    const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      let s; try { s = getComputedStyle(n); } catch (e) { break; }
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
      if (n.getAttribute && n.getAttribute("aria-hidden") === "true" && /modal|popup|window|dialog|layer/i.test(n.className || "")) return false; // 닫힌 모달
    }
    return true;
  };
  const loggedIn = () => !!window.hrt2325 || !!$id("hrt2325_btn_search") || !!document.querySelector("a[menu-app-id]");
  const loggedOut = () => {
    if (loggedIn()) return false;
    const pw = [...document.querySelectorAll('input[type="password"]')].filter(realVis);
    const idIn = [...document.querySelectorAll('#login_id, input[type="text"], input[type="email"], input:not([type])')].filter(realVis).find((i) => !pw.length || (i.compareDocumentPosition(pw[0]) & Node.DOCUMENT_POSITION_FOLLOWING));
    const btn = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a')].filter(realVis).find((b) => /로그인|login/i.test(tx(b) || b.value || "") || /login_btn/.test(b.className || ""));
    return (!!idIn && !!btn) || (pw.length > 0 && /^\/main\/login/.test(location.pathname));
  };

  if (op === "done") { H.quiet = false; if (!popClosed()) { if (popOpen()) await closePop(); else await unstick(); } return { ok: true, clean: popClosed() }; } // 어떻게 끝나든 팝업·덮개를 정리
  H.quiet = true; // 자동으로 도는 동안 alert 창은 띄우지 않고 문구만 받아 둠

  if (op === "probe") {
    return { ok: true, login: loggedOut(), loggedIn: loggedIn(), menu: !!document.querySelector("a[menu-app-id]"), screen: !!$id("hrt2325_btn_search"), api: !!window.hrt2325, jq: !!$ };
  }

  if (op === "open") { // 근태관리 → 주간스케쥴(시간)
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < 40e3) {
      if ($id("hrt2325_btn_search") && $id("hrt2325_dept_category")) { await idle(15e3); return { ok: true }; }
      if (loggedOut()) return fail("week", "HR 로그인이 풀려 있어요 (HR에 로그인한 뒤 다시 전송)", { code: "login" });
      const lk = document.querySelector('a[menu-app-id="HRT/W_HRT2325"]') || [...document.querySelectorAll("a[menu-app-id], a")].find((x) => /주간\s*스케[쥴줄]\s*\(\s*시간\s*\)/.test(tx(x)));
      if (!lk) { const top = document.querySelector('li[menu-desc="근태관리"]'); tap(top && (top.querySelector(".menu-step1") || top)); }
      else if (i % 2 === 0) { const ul = lk.closest("ul"), grp = ul && ul.previousElementSibling; if (grp && i === 0) tap(grp.querySelector(".jlamp-gnb-menu-label") || grp); await sleep(250); tap(lk); }
      else tap(lk.querySelector("span") || lk);
      i++; await sleep(1000);
    }
    return fail("week", "주간스케쥴(시간) 화면을 못 열었어요 (근태관리 › 주간스케쥴(시간))");
  }

  if (op === "cond") { // 소속구분·주차 → 검색 → 주차 상태
    if (!window.hrt2325) return fail("week", "주간스케쥴(시간) 화면 기능(hrt2325)이 없어요");
    if (!$) return fail("week", "화면의 jQuery(jq)가 없어요");
    const site = $id("hrt2325_search_site_code"); if (site && a.site && String(site.value) !== String(a.site)) return fail("week", `사업장이 달라요 (화면 ${site.value}, 기대 ${a.site})`);
    const leave = $id("hrt2325_search_leave_yn"); if (leave && leave.type === "checkbox" && !leave.checked) tap(leave);
    const hid = $id("hrt2325_dept_category");
    if (!hid) return fail("week", "소속구분 칸(#hrt2325_dept_category)이 없어요");
    for (let k = 0; k < 4 && String(hid.value) !== a.dept; k++) {
      let done = false;
      try { const w = $(hid).data("kendoDropDownList") || $(hid).data("kendoComboBox"); if (w) { w.value(a.dept); w.trigger("change"); done = true; } } catch (e) {}
      if (!done || String(hid.value) !== a.dept) {
        const box = hid.closest("td, li, .search-item, .form-group, div") || document.body;
        const DEPT = /^(BOH|FOH|STORE|전체|소속구분|선택)?$/;
        const trig = [...box.querySelectorAll("button, a, span, .k-dropdown, .k-picker, [role=listbox], [role=combobox]")].find((b) => vis(b) && /^(BOH|FOH|STORE|전체)$/.test(tx(b))) || [...document.querySelectorAll("button, a, .k-dropdown, .k-picker, [role=combobox]")].find((b) => vis(b) && /^(BOH|FOH|STORE|전체)$/.test(tx(b)));
        if (trig) { tap(trig); await sleep(300); }
        const want = a.dept === "" ? (x) => /^(전체|-\s*전체\s*-|)$/.test(tx(x)) && (x.tagName === "LI" || x.getAttribute("role") === "option") : (x) => tx(x) === a.dept; // 빈칸 = 전체 (11/16 KM)
        const opt = [...document.querySelectorAll("li, a, button, [role=option], label, span")].find((x) => vis(x) && want(x) && x !== trig && !(trig && trig.contains(x)) && DEPT.test(tx(x)));
        if (opt) tap(opt);
        await sleep(400);
      }
    }
    if (String(hid.value) !== a.dept) return fail("week", `소속구분을 ${a.dept || "전체(빈칸)"}로 못 맞췄어요 (지금 ${hid.value || "빈칸"})`);
    const md = (d) => d.slice(5, 7) + "/" + d.slice(8, 10);
    const label = () => { const re = /(\d{1,2})\s*주\s*\(\s*(\d{2})\/(\d{2})\s*~\s*(\d{2})\/(\d{2})\s*\)/; for (const el of document.querySelectorAll("span, div, label, input, button, a, strong, p, td")) { if (!vis(el)) continue; const s = el.tagName === "INPUT" ? el.value : tx(el); const m = re.exec(s || ""); if (m && (s || "").length < 60) return { text: m[0], from: m[2] + "/" + m[3], to: m[4] + "/" + m[5] }; } return null; };
    const want = { from: md(a.weekStart), to: md(a.weekEnd) };
    const yyyy = () => +(($id("hrt2325_yyyy") || {}).value || a.weekStart.slice(0, 4));
    const toDate = (mmdd) => { const y = yyyy(), c = [y - 1, y, y + 1].map((yy) => Date.parse(`${yy}-${mmdd.replace("/", "-")}T00:00:00Z`)), t = Date.parse(a.weekStart + "T00:00:00Z"); return c.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), c[1]); };
    let L = label(), moves = 0;
    while (L && !(L.from === want.from && L.to === want.to) && moves < 60) {
      const dir = toDate(L.from) < Date.parse(a.weekStart + "T00:00:00Z") ? "next" : "prev", before = L.text;
      try { window.hrt2325.moveWeek(dir); } catch (e) { return fail("week", "주차 이동(moveWeek)이 안 돼요: " + (e && e.message)); }
      moves++;
      for (let k = 0; k < 30; k++) { await sleep(200); L = label(); if (L && L.text !== before) break; }
      await idle(15e3);
    }
    if (!L) return fail("week", "주차 표시(예: 48주(11/23~11/29))를 화면에서 못 찾았어요");
    if (!(L.from === want.from && L.to === want.to)) return fail("week", `주차를 ${want.from}~${want.to}로 못 맞췄어요 (지금 ${L.text})`);
    const m0 = mark();
    tap($id("hrt2325_btn_search"));
    const ax = await waitAjax(m0, "getMasterList_prc", 15e3); await idle(15e3);
    if (!ax) return fail("week", "검색 응답(getMasterList_prc)이 안 왔어요");
    if (ax.http >= 400) return fail("week", `검색 응답 HTTP ${ax.http}`);
    const bad = H.msgs.slice(m0.m).find((x) => errText(x.msg)); if (bad) { dismiss(); return fail("week", "검색 중: " + bad.msg); }
    if (!ax.st && ax.n == null) return fail("week", "주차 상태를 못 읽었어요 (infoEnc를 풀지 못함)");
    // 메인 표의 사번만 (직책 칸에 휴대폰 번호가 있어 다른 칸은 읽지 않음). 0행이면 빈 주
    let mainEmp = null;
    for (const g of [$id("hrt2325_master_list_html"), $id("hrt2325_list_html"), $id("hrt2325_main_list_html"), ...document.querySelectorAll("[data-role='grid'], .k-grid")]) {
      if (!g || g.closest("#hrt2325_pop_sub")) continue;
      try { const w = $(g).data("kendoGrid"); if (!w) continue; const d = [].slice.call(w.dataSource.data()); if (!d.length) { if (mainEmp == null) mainEmp = []; continue; } if (!("emp_code" in d[0])) continue; mainEmp = d.map((r) => String(r.emp_code || "")).filter(Boolean); break; } catch (e) {}
    }
    return { ok: true, week: L.text, dept: hid.value, status: ax.st || [], moves, mainEmp, init: !off($id("hrt2325_btn_init")), ajax: [{ ep: ax.ep, http: ax.http, rc: ax.rc }] };
  }

  if (op === "init") { // allowInit일 때만: 업로드 전에 초기화 (미래 주차에서만 켜짐)
    const b = $id("hrt2325_btn_init");
    if (!b || off(b)) return fail("week", "[초기화] 단추가 꺼져 있어요 (지난 주차는 초기화 불가)");
    const m0 = mark(); const seen = await withConfirm(/기존에 등록된 자료가 있다면 삭제 후 초기화/, async () => { tap(b); });
    if (seen.length && !/기존에 등록된 자료가 있다면 삭제 후 초기화/.test(seen[0])) return fail("week", "초기화 확인 문구가 달라 멈춤: " + seen[0]);
    const r = await waitMsg(m0, /초기화|완료|되었습니다/, 15e3); await idle(15e3);
    if (!r.ok && !r.timeout) return fail("week", "초기화: " + r.msg);
    return { ok: true, toast: r.msg, confirms: seen };
  }

  if (op === "dayOpen") { // 팝업 열기 → (openMdl이 MON을 눌러 첫 로딩) → 그 로딩이 끝난 뒤 그 요일 label → 그날 자료 → 업로드 전 사번
    //  11/16 KM 실제 확인: 팝업 저장 뒤 [일자별 수정]을 다시 열면 openMdl이 요일 라디오를 새로 만들고 MON을 눌러 getMasterList(DETAIL)로 로딩함.
    //  그 응답이 끝나고 표가 다시 그려진 뒤(행 workType이 '')에 label[for="hrt2325_pop_title_{DAY}"]를 눌러야 함. 그 전 표를 읽으면 지난 시도의 행이 섞임
    const D = a.dow;
    const cur = () => (document.querySelector('input[name="hrt2325_pop_title"]:checked') || {}).value || "";
    // 로딩 끝 = 태그한 getMasterList_prc 응답(HTTP 200·returnCode 0). p_error_code MSG0001(행 있음)·MSG0006(0행) 둘 다 정상 → 0행인 요일도 정상 (11/16 KM)
    const okResp = (ax) => !!ax && ax.http === 200 && (ax.rc == null || ax.rc === "0");
    const drawn = () => { const rs = popRows(); return !!rs && rs.every((r) => (r.workType == null ? "" : String(r.workType)) === ""); }; // 다시 그려짐 (0행도 됨)
    const sig = () => { const rs = popRows() || []; return rs.length + ":" + rs.map((r) => r.emp_code).join(","); };
    async function settle(from, ms) { // 태그한 응답 → 로딩 덮개 → 표가 0.3초 동안 그대로
      const ax = await waitAjax(from, "getMasterList_prc", ms);
      if (!ax) return null;
      await idle(10e3);
      const t0 = Date.now(); let last = sig(), since = Date.now();
      while (Date.now() - t0 < 5e3) { await sleep(100); const g = sig(); if (g !== last) { last = g; since = Date.now(); } if (drawn() && Date.now() - since >= 300) break; }
      return ax;
    }
    const why = (ax) => (ax ? `HTTP ${ax.http}${ax.rc != null ? " · returnCode " + ax.rc : ""}${ax.ec ? " · " + ax.ec : ""}` : "응답 없음");
    let opened = false;
    if (!popOpen()) {
      // 앞 요일 팝업이 완전히 닫힐 때까지 (isShown false · display none · backdrop 0). 멈췄으면 정리하고 다시
      if (!(await waitClosed(3000))) { await unstick(); if (!(await waitClosed(2000))) return fail("upload", "앞 팝업이 닫히지 않아요 (modal-backdrop이 남음)"); }
      const btn = $id("hrt2325_btn_pop"); if (!btn || off(btn)) return fail("upload", "[일자별 수정] 단추가 없거나 꺼져 있어요");
      const m0 = mark();
      const seen = await withConfirm(null, async () => { tap(btn); await sleep(300); });
      if (seen.length) return fail("upload", "저장 안 된 내역이 있다고 해서 멈춤: " + clean(seen[0]));
      for (let k = 0; k < 50 && !popOpen(); k++) await sleep(150);
      if (!popOpen()) return fail("upload", "[일자별 수정] 창이 안 열렸어요");
      const ax = await settle(m0, 60e3); opened = true; // 첫 로딩(DETAIL) 실측 7~21초 → 한도 60초
      if (!ax) return fail("upload", "팝업 첫 로딩(MON) 응답이 60초 안에 안 왔어요");
      if (!okResp(ax)) return fail("upload", `팝업 첫 로딩 실패 (${why(ax)})`);
    }
    let loaded = opened && cur() === D; // 새로 열었고 바라던 요일(MON)이 이미 눌려 로딩됨
    for (let t = 0; t < 3 && !loaded; t++) {
      const lb = document.querySelector(`label[for="hrt2325_pop_title_${D}"]`) || (() => { const r = document.querySelector(`input[name="hrt2325_pop_title"][value="${D}"]`); return r && ((r.id && document.querySelector(`label[for="${r.id}"]`)) || r.closest("label") || r); })();
      if (!lb) return fail("upload", `요일 탭(${D})을 못 찾았어요`);
      const m1 = mark();
      // "수정중인 데이터가 존재합니다. 초기화하고 다른 일자로 변경 하시겠습니까?" → 앞 요일 저장이 확인된 경우에만 예
      const seen = await withConfirm(a.prevSaved ? /수정중인 데이터가 존재합니다/ : null, async () => { tap(lb); });
      if (seen.length && !(a.prevSaved && /수정중인 데이터가 존재합니다/.test(seen[0]))) return fail("upload", `${D}로 바꾸려는데 확인창이 떠서 멈춤 (앞 요일 저장 안 됨): ${clean(seen[0])}`);
      const ax = await settle(m1, 30e3); // 요일 전환 실측 2~4초 → 한도 30초
      if (ax && !okResp(ax)) return fail("upload", `${D} 자료 로딩 실패 (${why(ax)})`);
      loaded = cur() === D && okResp(ax);
    }
    if (!loaded) return fail("upload", `요일 탭(${D})으로 바꾸고 그날 자료를 불러오지 못했어요 (지금 ${cur() || "선택 없음"}, 3번 시도)`);
    const rows = popRows();
    if (!rows) return fail("upload", "팝업 표(#hrt2325_pop_list_html)를 못 읽었어요");
    return { ok: true, day: cur(), before: rows.map((r) => String(r.emp_code || "")).filter(Boolean), rows0: rows.length };
  }

  if (op === "dayUpload") { // 숨은 파일 칸에 엑셀 → change → 화면 반영 (저장 아님)
    const inp = $id("hrt2325_day_excel_file");
    if (!inp) return fail("upload", "엑셀 업로드 칸(#hrt2325_day_excel_file)이 없어요");
    const bin = atob(a.b64), u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    const dt = new DataTransfer(); dt.items.add(new File([u8], a.name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const m0 = mark();
    try { inp.value = ""; } catch (e) {}
    inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
    const r = await waitMsg(m0, /엑셀 데이터가 화면에 반영/, 17e3); await idle(10e3);
    const ax = H.ajax.slice(m0.a).find((x) => x.ep === "uploadDayExcelFile_prc");
    if (!r.ok) return fail("upload", r.timeout ? "엑셀을 올렸는데 '화면에 반영' 문구가 안 떴어요" : r.msg, { http: ax && ax.http });
    return { ok: true, toast: r.msg, http: ax ? ax.http : null };
  }

  if (op === "dayCheck") { // 행마다: chk_message · 사번 집합 · 근태 코드 · 시간
    const rows = popRows(); if (!rows) return fail("upload", "업로드 뒤 팝업 표를 못 읽었어요");
    const D = a.dow, sent = new Map(a.rows.map((r) => [r.empNo, r])), errs = [];
    const got = rows.map((r) => ({ empNo: String(r.emp_code || ""), name: String(r.emp_name || ""), chk: clean(r.chk_message), code: r[D + "_time_item_code_p"], on: r[D + "_work_on_p_hhmm"], offT: r[D + "_work_off_p_hhmm"], brk: r[D + "_break_time_p_hhmm"] }));
    for (const g of got) {
      const s = sent.get(g.empNo);
      if (g.chk) errs.push({ empNo: g.empNo, name: s ? s.name : g.name, msg: g.chk });
      else if (!s) errs.push({ empNo: g.empNo, name: g.name, msg: "보낸 파일에 없는 행이 표에 있어요" });
      else if (g.code == null || g.code === "") errs.push({ empNo: g.empNo, name: s.name, msg: `근태유형 '${s.kind}'이 HR 코드로 안 바뀌었어요` });
      else if (s.kind === "출근" && String(g.code) !== "10") errs.push({ empNo: g.empNo, name: s.name, msg: `출근인데 근태 코드가 ${g.code}` });
      else if (s.kind === "휴무" && String(g.code) !== "17") errs.push({ empNo: g.empNo, name: s.name, msg: `휴무인데 근태 코드가 ${g.code}` });
      else if (hm(g.on) !== hm(s.in) || hm(g.offT) !== hm(s.out) || hm(g.brk) !== hm(s.brk)) errs.push({ empNo: g.empNo, name: s.name, msg: `시간이 달라요 (보냄 ${s.in || "-"}~${s.out || "-"}/${s.brk || "-"} · 표 ${g.on || "-"}~${g.offT || "-"}/${g.brk || "-"})` });
    }
    const gotSet = new Set(got.map((g) => g.empNo));
    a.rows.forEach((s) => { if (!gotSet.has(s.empNo)) errs.push({ empNo: s.empNo, name: s.name, msg: "보낸 행이 표에 없어요" }); });
    if (got.length !== a.rows.length) errs.push({ msg: `표 ${got.length}행 · 파일 ${a.rows.length}명 — 수가 달라요` });
    if (errs.length) { await closePop(); return fail("upload", `${D} 행 오류 ${errs.length}건 — 저장 안 함`, { rowErrors: errs.filter((e) => e.empNo) }); }
    return { ok: true, n: got.length };
  }

  if (op === "daySave") { // 팝업 저장 (선택한 요일만, 창은 스스로 닫히고 메인 표 다시 조회)
    const sv = $id("hrt2325_pop_btn_save"); if (!sv || off(sv)) return fail("save", "팝업 [저장] 단추가 없거나 꺼져 있어요");
    const m0 = mark();
    const seen = await withConfirm(/저장\s*하시겠습니까/, async () => { tap(sv); });
    const r = await waitMsg(m0, /저장되었습니다/, 17e3); await idle(10e3);
    const ax = H.ajax.slice(m0.a).find((x) => x.ep === "saveData_prc");
    if (!r.ok) { await closePop(); return fail("save", r.timeout ? (ax ? `저장 응답(saveData_prc HTTP ${ax.http}) 뒤 '저장되었습니다'가 안 떴어요` : "저장 단추를 눌렀는데 서버 호출이 없었어요(화면이 저장을 막음)") : r.msg, { confirms: seen }); }
    // 팝업이 다 닫히고(hidden.bs.modal 뒤 상태) 메인 표 다시 조회(getMasterList_prc) 응답까지
    let closed = await waitClosed(5000);
    if (!closed) closed = await unstick();
    const re = await waitAjax(m0, "getMasterList_prc", 30e3); await idle(15e3);
    return { ok: true, toast: r.msg, http: ax ? ax.http : null, closed, reload: re ? re.http : null, ajax: H.ajax.slice(m0.a).map((x) => ({ ep: x.ep, http: x.http, rc: x.rc })) };
  }

  if (op === "status") { // 다시 검색해서 지금 상태 (공지·확정 전 확인)
    const m0 = mark(); tap($id("hrt2325_btn_search"));
    const ax = await waitAjax(m0, "getMasterList_prc", 15e3); await idle(15e3);
    return { ok: !!ax, status: ax && ax.st ? ax.st : [], notice: !off($id("hrt2325_btn_notice")), confirm: !off($id("hrt2325_btn_confirm")), save: !off($id("hrt2325_btn_save")) };
  }

  if (op === "weekRows") { // 지금 [검색]한 메인 표에서 공지 전 점검에 필요한 칸만: 사번·이름·요일별 근태 코드·시간 (+ 화면에 보이는 근태 이름으로 코드→이름표)
    //  직책(duty_name) 칸은 휴대폰 번호가 같이 있어 읽지 않음. 이름은 보드에 "어느 직원" 알려 줄 때만 씀(확장 기록에는 안 남김)
    const el = $id("hrt2325_info_list_html"), g = el && $ && $(el).data("kendoGrid");
    if (!g) return fail("precheck", "메인 표(#hrt2325_info_list_html)를 못 읽었어요");
    const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], data = [].slice.call(g.dataSource.data());
    const leaf = (cs) => [].concat(...(cs || []).map((c) => (c.columns ? leaf(c.columns) : [c])));
    const cols = leaf(g.columns || []).filter((c) => !c.hidden), unl = cols.filter((c) => !c.locked);
    const labels = {};
    const tbl = g.table && g.table[0] ? g.table[0] : el.querySelector(".k-grid-content table") || el.querySelector("table");
    [...(tbl ? tbl.querySelectorAll("tr[data-uid]") : [])].forEach((tr) => {
      let di = null; try { di = g.dataItem(tr); } catch (e) {} if (!di) return;
      unl.forEach((c, i) => { if (!/^(MON|TUE|WED|THU|FRI|SAT|SUN)_time_item_code_p$/.test(c.field || "")) return; const code = String(di[c.field] == null ? "" : di[c.field]); const t = tx(tr.cells[i]).replace(/\d{1,2}:\d{2}.*$/, "").trim(); if (code && t && !labels[code]) labels[code] = t.slice(0, 20); });
    });
    const v = (x) => (x == null ? "" : String(x));
    return { ok: true, dept: v(($id("hrt2325_dept_category") || {}).value), labels, rows: data.map((r) => ({ empNo: v(r.emp_code), name: v(r.emp_name).slice(0, 30), days: DAYS.map((D) => ({ dow: D, code: v(r[D + "_time_item_code_p"]), in: v(r[D + "_work_on_p_hhmm"]), out: v(r[D + "_work_off_p_hhmm"]), brk: v(r[D + "_break_time_p_hhmm"]) })) })) };
  }

  if (op === "final") { // 메인 저장(켜져 있을 때만) → 공지 → 확정 (a.skipNotice: 이미 공지된 주면 확정만)
    const steps = [];
    const main = $id("hrt2325_btn_save");
    if (main && vis(main) && !off(main)) {
      const m0 = mark(); const seen = await withConfirm(/저장\s*하시겠습니까/, async () => { tap(main); });
      const r = await waitMsg(m0, /저장되었습니다/, 20e3); await idle(15e3);
      if (!r.ok) return fail("save", r.timeout ? "메인 저장 뒤 문구가 안 떴어요" : r.msg, { steps, confirms: seen });
      steps.push({ stage: "save", msg: r.msg });
    } else steps.push({ stage: "save", msg: "메인 저장 꺼져 있음 → 건너뜀" });
    let m0, seen, r;
    if (!a.skipNotice) {
    const nb = $id("hrt2325_btn_notice");
    if (!nb || off(nb)) return fail("notice", "[공지] 단추가 꺼져 있어요 (주차 상태 확인)", { steps });
    m0 = mark(); seen = await withConfirm(/공지\s*하시겠습니까/, async () => { tap(nb); });
    if (seen.length && !/공지\s*하시겠습니까/.test(seen[0])) return fail("notice", "공지 확인 문구가 달라 멈춤: " + clean(seen[0]), { steps });
    r = await waitMsg(m0, /공지\s*되었습니다/, 20e3); await idle(15e3);
    if (!r.ok) return fail("notice", r.timeout ? "공지 뒤 '공지 되었습니다'가 안 떴어요" : r.msg, { steps, confirms: seen });
    steps.push({ stage: "notice", msg: r.msg });
    }
    if (a.stopBefore === "confirm") return { ok: true, steps, noticed: true };
    const cb = $id("hrt2325_btn_confirm");
    for (let k = 0; k < 40 && (!cb || off(cb)); k++) await sleep(150);
    if (!cb || off(cb)) return fail("confirm", "공지 뒤에도 [확정] 단추가 꺼져 있어요", { steps, noticed: true });
    m0 = mark(); seen = await withConfirm(/확정\s*하시겠습니까/, async () => { tap(cb); });
    if (seen.length && !/확정\s*하시겠습니까/.test(seen[0])) return fail("confirm", "확정 확인 문구가 달라 멈춤: " + clean(seen[0]), { steps, noticed: true });
    r = await waitMsg(m0, /확정\s*되었습니다/, 20e3); await idle(15e3);
    if (!r.ok) return fail("confirm", r.timeout ? "확정 뒤 '확정 되었습니다'가 안 떴어요" : r.msg, { steps, noticed: true, confirms: seen });
    steps.push({ stage: "confirm", msg: r.msg });
    return { ok: true, steps, noticed: true, confirmed: true };
  }
  return fail("week", "알 수 없는 단계: " + op);
}
if (typeof module !== "undefined") module.exports = { hrsStep };
