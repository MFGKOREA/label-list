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
        const es = pd.p_error_str != null ? pd.p_error_str : j && j.p_error_str;
        const ent = { t: Date.now(), ep: m[1], http: xhr.status, rc: rc == null ? null : String(rc), id: (st && st.__gw) || 0, ec: ec == null ? null : String(ec), rows: rn == null ? null : +rn, err: es ? clean(es) : "" };
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
      // 저장·상태 변경 응답의 returnCode가 0이 아니면 오류 (문구에 '오류'가 없어도: 예 "OOO님의 주휴일을 설정해주세요")
      const rcBad = H.ajax.slice(from.a).find((x) => /^(saveData_prc|statusChangeData_prc|uploadDayExcelFile_prc)$/.test(x.ep) && x.rc != null && x.rc !== "0");
      if (rcBad) { await sleep(400); const m2 = H.msgs.slice(from.m).filter((x) => !good.test(x.msg)).pop(); dismiss(); return { ok: false, msg: rcBad.err || (m2 && m2.msg) || `${rcBad.ep} returnCode ${rcBad.rc}` }; }
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
  // (1.17.2) 보낸 뒤 아직 답이 안 온 요청 · 저장 안 된 변경이 있는 행(사번)
  const pendingAjax = () => { const done = new Set(H.ajax.map((x) => x.id).filter(Boolean)), t = Date.now() - 60e3; return H.sent.filter((x) => x.t > t && !done.has(x.id)).map((x) => x.ep); };
  // (1.17.3) '저장 안 된 변경' = HR 저장(saveData)이 실제로 보내는 행 = workType U·I·D. kendo의 dirty·hasChanges는 HR 화면이 불러올 때 합계 칸을 스스로 채우며 켤 수 있어 안 봄
  //  (11/18 KM: 1.17.2에서도 저장 직후 같은 멈춤 → 검색만 해도 hasChanges가 켜지는 것으로 봄)
  const dirtyNos = (g) => { try { return [].slice.call(g.dataSource.data()).filter((r) => /^[UID]$/.test(String(r.workType || ""))).map((r) => String(r.emp_code)).slice(0, 40); } catch (e) { return []; } };
  const dsChanged = (g) => dirtyNos(g).length > 0;
  const kendoDirty = (g) => { try { return !!g.dataSource.hasChanges(); } catch (e) { return false; } };
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
    for (let k = 0; k < 75 && pendingAjax().length; k++) await sleep(200); // (1.17.2) 검색 뒤 이어지는 표 불러오기(MAINROWS 등)까지 끝난 뒤 검사
    await idle(5e3);
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

  // ---- 카드 입력 (11/17 KM: 업로드 방식은 쓰지 않음) — 메인 표(#hrt2325_info_list_html) 행 모델에 값을 넣고 workType='U' → [저장] 한 번 ----
  const mainGrid = () => { const el = $id("hrt2325_info_list_html"); return el && $ ? $(el).data("kendoGrid") : null; };
  const DAYS7 = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  if (op === "settle") { // (1.17.2) 저장 뒤 HR 화면이 서버 응답·표 다시 불러오기(getMasterList_prc)를 끝낼 때까지 기다림 — 그 전에 검색·검사하면 저장 중인 표를 '남의 변경'으로 봄
    const t0 = Date.now(), ms = a.ms || 20e3;
    const lastSave = (() => { for (let i = H.ajax.length - 1; i >= 0; i--) if (H.ajax[i].ep === "saveData_prc") return i; return -1; })();
    while (Date.now() - t0 < ms) {
      const reloaded = lastSave < 0 || H.ajax.slice(lastSave + 1).some((x) => x.ep === "getMasterList_prc");
      if (!pendingAjax().length && reloaded && (await idle(2e3))) break;
      await sleep(300);
    }
    const g = mainGrid();
    return { ok: true, waited: Date.now() - t0, pending: pendingAjax(), dirty: g ? dsChanged(g) : false, dirtyNos: g ? dirtyNos(g) : [] };
  }
  // (1.17.2) 저장 안 된 변경이 '방금 이 확장이 저장한 행'뿐이고 표 값이 저장한 값과 모두 같으면 변경 표시만 지움(cancelChanges). 남의 행·고친 값이 하나라도 있으면 안 지움
  async function dropOwnRows(g, own) {
    own = own || {}; const nos = dirtyNos(g), byNo = new Map([].slice.call(g.dataSource.data()).map((r) => [String(r.emp_code), r]));
    const same = (no) => { const w = own[no], r = byNo.get(no); if (!w || !r) return false; return Object.keys(w).every((D) => String(r[D + "_time_item_code_p"] == null ? "" : r[D + "_time_item_code_p"]) === String(w[D].code) && T(r[D + "_work_on_p_hhmm"]) === T(w[D].in) && T(r[D + "_work_off_p_hhmm"]) === T(w[D].out) && T(r[D + "_break_time_p_hhmm"]) === T(w[D].brk)); };
    if (!dsChanged(g)) return { dropped: 0, dirty: false, dirtyNos: [] };
    const others = nos.filter((n) => !same(n));
    if (!nos.length || others.length) return { dropped: 0, dirty: true, dirtyNos: others.length ? others : nos };
    try { g.dataSource.cancelChanges(); } catch (e) {}
    await sleep(200);
    return { dropped: nos.length, dirty: dsChanged(g), dirtyNos: dirtyNos(g) };
  }
  if (op === "dropOwn") { const g = mainGrid(); if (!g) return fail("week", "메인 표를 못 읽었어요"); return Object.assign({ ok: true }, await dropOwnRows(g, a.own)); }
  if (op === "cardMap") { // 지금 탭(소속구분)의 메인 표: 사번 + 요일별 수정 가능(edit_yn). 이름·직책은 안 읽음
    const g = mainGrid(); if (!g) return fail("week", "메인 표(#hrt2325_info_list_html)를 못 읽었어요");
    const v = (x) => (x == null ? "" : String(x));
    const dirty = dsChanged(g);
    return { ok: true, dirty, kendoDirty: kendoDirty(g), dirtyNos: dirty ? dirtyNos(g) : [], dept: v(($id("hrt2325_dept_category") || {}).value), rows: [].slice.call(g.dataSource.data()).map((r) => ({ empNo: v(r.emp_code), dept: v(r.dept_code || r.dept_name).slice(0, 20), edit: Object.fromEntries(DAYS7.map((D) => [D, v(r[D + "_edit_yn"])])) })) };
  }
  if (op === "learnCodes") { // 근태유형 코드표: 표의 근태 칸 편집기(드롭다운)를 잠깐 열어 목록만 읽고 닫음 (값은 안 바꿈)
    const g = mainGrid(); if (!g) return fail("week", "메인 표를 못 읽었어요");
    const leaf = (cs) => [].concat(...(cs || []).map((c) => (c.columns ? leaf(c.columns) : [c])));
    const unl = leaf(g.columns || []).filter((c) => !c.hidden && !c.locked), ci = unl.findIndex((c) => c.field === "MON_time_item_code_p");
    const tbl = g.table && g.table[0] ? g.table[0] : null;
    if (ci < 0 || !tbl) return { ok: true, list: [], why: "표가 비어 있거나 근태 칸을 못 찾음" };
    // 수정 가능한 칸(edit_yn이 N이 아닌 행·요일)을 골라 편집기를 엶 — 잠긴 날은 드롭다운이 안 열림
    let tr = null, cj = ci;
    for (const row of tbl.querySelectorAll("tr[data-uid]")) { let di = null; try { di = g.dataItem(row); } catch (e) {} if (!di) continue; const D = DAYS7.find((x) => String(di[x + "_edit_yn"]) !== "N"); if (D) { tr = row; cj = unl.findIndex((c) => c.field === D + "_time_item_code_p"); break; } }
    if (!tr || cj < 0) return { ok: true, list: [], why: "수정 가능한 칸이 없음" };
    if (dsChanged(g)) return { ok: true, list: [], why: "표에 저장 안 된 변경이 있어 편집기를 열지 않음" };
    let list = [];
    try {
      g.editCell($(tr.cells[cj])); await sleep(500);
      const box = $(tr.cells[cj]);
      const dd = (box.find("[data-role='dropdownlist']").data("kendoDropDownList")) || (box.find("[data-role='combobox']").data("kendoComboBox"));
      if (dd) { const vf = dd.options.dataValueField || "value", tf = dd.options.dataTextField || "text"; const raw = dd.dataSource.data(); list = [].slice.call(raw.toJSON ? raw.toJSON() : raw).map((x) => ({ v: String(x[vf] == null ? "" : x[vf]), t: String(x[tf] == null ? "" : x[tf]).slice(0, 20) })).filter((x) => x.v); }
    } catch (e) {}
    try { g.closeCell(); } catch (e) {}
    try { if (g.dataSource.hasChanges()) g.dataSource.cancelChanges(); } catch (e) {}
    await sleep(200);
    return { ok: true, list };
  }
  // ---- 바뀐 칸 계산 (11/17 KM 실제 운영 방식) ----
  //  a.emps: [{ empNo?, name, days: [{ dow, code, kname, in, out, brk }] }] · a.keep: 기존 주휴일을 덮어쓰지 않을 직원(사번 또는 이름) · a.weekly: 주휴일 코드(기본 18)
  //  직원 찾기: 사번이 있으면 emp_code, 없으면 이름(emp_name의 <br> 앞, 같은 이름이 둘이면 건너뜀). 표에 없으면 건너뛰고 보고
  const nameOf = (r) => String(r.emp_name == null ? "" : r.emp_name).split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, "").trim();
  const T = (x) => { const v = String(x == null ? "" : x).trim(); const m = /^(\d{1,2}):?(\d{2})$/.exec(v); return m ? m[1].padStart(2, "0") + ":" + m[2] : v; }; // 'HH:MM'로
  function diffOf(g, a) {
    const rows = [].slice.call(g.dataSource.data()), byNo = new Map(), byName = new Map();
    rows.forEach((r) => { byNo.set(String(r.emp_code), r); const n = nameOf(r); byName.set(n, byName.has(n) ? null : r); });
    const keep = new Set(a.keep || []), weekly = String(a.weekly || "18");
    const changes = [], skipped = [], kept = [], locked = [];
    for (const e of a.emps) {
      // (1.17.4, 11/18 KM "알맞는 이름·사번을 찾아 맞춰서 시간 넣기"): 소속구분 빈칸(전체)이라 홀·주방·매니저가 섞여 보여도 줄 순서는 안 봄.
      //  사번으로 찾고, 이름도 HR 그 줄 이름과 같을 때만 넣음(다르면 그 사람은 건너뛰고 알림). 사번이 없으면 이름이 표에 딱 한 명일 때만
      const nm = (x) => String(x || "").replace(/\s+/g, "").replace(/\(.*?\)/g, "");
      const r = e.empNo ? byNo.get(String(e.empNo)) : byName.get(e.name);
      if (!r) {
        const alt = e.empNo && e.name ? byName.get(e.name) : null;
        skipped.push({ empNo: e.empNo || "", name: e.name, msg: r === null ? "같은 이름이 표에 둘 이상 — 건너뜀" : alt ? `사번 ${e.empNo}이 HR 표에 없음 (같은 이름은 HR 사번 ${alt.emp_code}) — 건너뜀, HR Board 사번 확인` : "표에 없음 — 건너뜀 (HR '누락건 추가'로 따로)" });
        continue;
      }
      if (e.empNo && e.name && nm(nameOf(r)) && nm(nameOf(r)) !== nm(e.name)) { skipped.push({ empNo: e.empNo, name: e.name, msg: `사번 ${e.empNo}은 HR에서 '${nameOf(r)}' — 이름이 달라 건너뜀 (사번·이름 확인)` }); continue; }
      const who = { empNo: String(r.emp_code), name: e.name || nameOf(r) };
      for (const d of e.days) {
        const D = d.dow, cur = { code: String(r[D + "_time_item_code_p"] == null ? "" : r[D + "_time_item_code_p"]), in: T(r[D + "_work_on_p_hhmm"]), out: T(r[D + "_work_off_p_hhmm"]), brk: T(r[D + "_break_time_p_hhmm"]) };
        const to = { code: String(d.code), kname: d.kname || "", in: T(d.in), out: T(d.out), brk: T(d.brk) };
        if (cur.code === to.code && cur.in === to.in && cur.out === to.out && cur.brk === to.brk) continue;
        if ((keep.has(who.empNo) || keep.has(e.name)) && cur.code === weekly && to.code !== weekly) { kept.push({ ...who, dow: D, msg: "입력에 주휴일이 없어 기존 주휴일을 그대로 둠 (확인 필요)" }); continue; }
        if (String(r[D + "_edit_yn"]) === "N") { locked.push({ ...who, dow: D, msg: "수정 불가 칸(edit_yn N) — 건너뜀" }); continue; }
        changes.push({ ...who, dow: D, from: cur, to });
      }
    }
    return { changes, skipped, kept, locked };
  }
  const dialogs = () => [...document.querySelectorAll(".k-dialog, .k-window, [role=dialog]")].filter(vis).map((x) => clean(tx(x))).filter(Boolean);

  if (op === "panelInfo") { // 사이드패널: 지금 HR 탭이 주간스케쥴(시간)인지, 몇 주인지 (읽기만)
    const re = /(\d{1,2})\s*주\s*\(\s*(\d{2})\/(\d{2})\s*~\s*(\d{2})\/(\d{2})\s*\)/;
    let lab = null; for (const el of document.querySelectorAll("span, div, label, input, button, a, strong, p, td")) { if (!vis(el)) continue; const t = el.tagName === "INPUT" ? el.value : tx(el); const m = re.exec(t || ""); if (m && (t || "").length < 60) { lab = m; break; } }
    const g = mainGrid(), y = +(($id("hrt2325_yyyy") || {}).value || new Date().getFullYear());
    let weekStart = "";
    if (lab) { const cands = [y - 1, y, y + 1].map((yy) => `${yy}-${lab[2]}-${lab[3]}`).filter((d) => !isNaN(Date.parse(d + "T00:00:00Z"))); const want = Date.parse(`${y}-07-01T00:00:00Z`); weekStart = cands.sort((p1, p2) => Math.abs(Date.parse(p1 + "T00:00:00Z") - Date.parse(`${y}-${lab[2]}-${lab[3]}T00:00:00Z`)) - Math.abs(Date.parse(p2 + "T00:00:00Z") - Date.parse(`${y}-${lab[2]}-${lab[3]}T00:00:00Z`)))[0]; if (+lab[1] === 1 && lab[2] === "12") weekStart = `${y - 1}-${lab[2]}-${lab[3]}`; void want; }
    return { ok: true, screen: !!g, week: lab ? lab[0] : "", weekStart, rows: g ? g.dataSource.data().length : 0, dept: (($id("hrt2325_dept_category") || {}).value || "") };
  }

  if (op === "cardDiff") { // 미리보기: 바뀔 칸만 (아무것도 안 바꿈)
    const g = mainGrid(); if (!g) return fail("week", "메인 표(#hrt2325_info_list_html)를 못 읽었어요");
    const dirty = dsChanged(g);
    return Object.assign({ ok: true, dirty, rows: g.dataSource.data().length }, diffOf(g, a));
  }

  if (op === "cardApply") { // 바뀐 칸만 d.set → 그 행 workType 'U' → hrt2325.saveData() 직접 → 다시 읽어 확인
    const g = mainGrid(); if (!g) return fail("save", "메인 표를 못 읽었어요");
    for (let k = 0; k < 75 && pendingAjax().length; k++) await sleep(200);
    if (dsChanged(g)) { const dr = await dropOwnRows(g, a.own); if (dr.dirty) return fail("save", `HR 표에 저장 안 된 변경이 ${dr.dirtyNos.length || "몇"}행 있어요${dr.dirtyNos.length ? " (사번 " + dr.dirtyNos.slice(0, 5).join(", ") + (dr.dirtyNos.length > 5 ? " 외" : "") + ")" : ""} — 이 확장이 방금 저장한 값이 아니라 누가 화면에서 고치는 중일 수 있어 멈춤. 주차 상태 EDIT(작성 중)와는 다른 것. [검색]으로 새로 고친 뒤 다시`, { code: "dirty", dirtyNos: dr.dirtyNos }); if (dr.dropped) { note("msg", `저장 전 변경 표시 ${dr.dropped}행은 방금 저장한 행이라 지움`); H.droppedOwn = dr.dropped; } }
    const df = diffOf(g, a);
    const dropped = H.droppedOwn || 0; H.droppedOwn = 0;
    if (!df.changes.length) return Object.assign({ ok: true, applied: 0, droppedOwn: dropped, msg: "바뀔 칸이 없어요 (이미 같음)" }, df);
    const rows = [].slice.call(g.dataSource.data()), byNo = new Map(rows.map((r) => [String(r.emp_code), r])), touched = new Set();
    const put = (r, f, v) => { if (typeof r.set === "function") r.set(f, v); else { r[f] = v; r.dirty = true; } };
    for (const c of df.changes) {
      const r = byNo.get(c.empNo), D = c.dow;
      put(r, D + "_time_item_code_p", c.to.code);
      if (c.to.kname) put(r, D + "_time_item_name_p", c.to.kname);
      put(r, D + "_work_on_p_hhmm", c.to.in); put(r, D + "_work_off_p_hhmm", c.to.out); put(r, D + "_break_time_p_hhmm", c.to.brk);
      touched.add(c.empNo);
    }
    touched.forEach((no) => put(byNo.get(no), "workType", "U")); // 이게 없으면 저장 요청에 안 들어감
    await sleep(300);
    const m0 = mark(), dlg0 = new Set(dialogs());
    const seen = await withConfirm(/저장/, async () => { try { window.hrt2325.saveData(); } catch (e) { note("msg", "saveData 오류: " + (e && e.message)); } });
    // 확인: 서버에서 다시 받은 표(바꾼 행의 workType이 비고, 값이 입력값과 같음). 오류: 새 대화창·오류 문구·returnCode
    const t0 = Date.now(); let bad = null, okNow = false, why = "";
    while (Date.now() - t0 < 40e3) {
      await sleep(400);
      const nd = dialogs().filter((x) => !dlg0.has(x)); if (nd.length) { why = nd[0]; break; }
      const em = H.msgs.slice(m0.m).find((x) => errText(x.msg) && !/저장되었습니다/.test(x.msg)); if (em) { why = em.msg; break; }
      const rc = H.ajax.slice(m0.a).find((x) => x.ep === "saveData_prc" && ((x.rc != null && x.rc !== "0") || x.http >= 400)); if (rc) { await sleep(400); why = rc.err || (H.msgs.slice(m0.m).pop() || {}).msg || `saveData_prc ${rc.http}/${rc.rc}`; break; }
      const g2 = mainGrid(); if (!g2) continue;
      const by2 = new Map([].slice.call(g2.dataSource.data()).map((r) => [String(r.emp_code), r]));
      const fresh = [...touched].every((no) => { const r = by2.get(no); return r && (r.workType == null || r.workType === ""); });
      if (!fresh) continue;
      bad = df.changes.filter((c) => { const r = by2.get(c.empNo), D = c.dow; return !r || String(r[D + "_time_item_code_p"] == null ? "" : r[D + "_time_item_code_p"]) !== c.to.code || T(r[D + "_work_on_p_hhmm"]) !== c.to.in || T(r[D + "_work_off_p_hhmm"]) !== c.to.out || T(r[D + "_break_time_p_hhmm"]) !== c.to.brk; });
      okNow = true; break;
    }
    await idle(10e3);
    // (1.17.2) 저장이 끝나고 서버 값과 맞는 걸 확인한 뒤에도 표에 '저장 안 된 변경' 표시가 남으면(다시 불러오기 중) 잠깐 기다리고, 그래도 남은 게 방금 저장한 행뿐이면 표시만 지움
    if (okNow && !(bad && bad.length)) {
      for (let k = 0; k < 20 && (pendingAjax().length || dsChanged(mainGrid() || g)); k++) await sleep(300);
      const g3 = mainGrid() || g, left = dsChanged(g3) ? dirtyNos(g3) : [];
      if (left.length && left.every((n) => touched.has(n))) { try { g3.dataSource.cancelChanges(); } catch (e) {} note("msg", "저장 뒤 남은 변경 표시(방금 저장한 행) 지움"); }
      H.ownSaved = { at: Date.now(), empNos: [...touched] };
    }
    if (why) { try { const b1 = $id("jl_noti_footer_btn1"); if (b1 && vis(b1)) tap(b1); } catch (e) {} try { g.dataSource.cancelChanges(); } catch (e) {} return Object.assign(fail("save", "HR이 저장을 막음: " + why, { confirms: seen }), df); }
    if (!okNow) { try { g.dataSource.cancelChanges(); } catch (e) {} return Object.assign(fail("save", "저장 뒤 40초 안에 표가 다시 안 불려 왔어요 (workType이 그대로)", { confirms: seen }), df); }
    if (bad.length) return Object.assign(fail("save", `저장 뒤 다시 읽었더니 ${bad.length}칸이 달라요`, { notSaved: bad.map((c) => ({ empNo: c.empNo, name: c.name, dow: c.dow, msg: `보냄 ${c.to.code} ${c.to.in || "-"}~${c.to.out || "-"}/${c.to.brk || "-"}` })) }), df);
    return Object.assign({ ok: true, applied: df.changes.length, droppedOwn: dropped, rowsTouched: touched.size, ajax: H.ajax.slice(m0.a).map((x) => ({ ep: x.ep, http: x.http, rc: x.rc })) }, df);
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
    return { ok: true, dept: v(($id("hrt2325_dept_category") || {}).value), labels, rows: data.map((r) => ({ empNo: v(r.emp_code), name: v(r.emp_name).split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, "").trim().slice(0, 30), dept: v(r.dept_code || r.dept_name).slice(0, 20), days: DAYS.map((D) => ({ dow: D, code: v(r[D + "_time_item_code_p"]), kname: v(r[D + "_time_item_name_p"]).slice(0, 20), in: v(r[D + "_work_on_p_hhmm"]), out: v(r[D + "_work_off_p_hhmm"]), brk: v(r[D + "_break_time_p_hhmm"]), edit: v(r[D + "_edit_yn"]) })) })) };
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
