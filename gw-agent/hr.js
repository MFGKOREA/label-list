// 플젝 HR 출퇴근·스케줄 변경 신청 덤프 (GW Agent 1.10.0) — hr.pljec.cloud
//  왜: 지금은 원격 브라우저가 하루 여러 번 플젝 HR에 들어가 출퇴근을 확인한다(느리고 사용량을 씀).
//      매장 PC 크롬이 켜져 있는 동안 이 확장이 대신 읽어 시트(kv: hrStatus)에 남기면, 그 뒤 조회는 시트로 끝난다.
//  읽는 화면 (2026-11-14 실제 화면에서 확인한 것만 씀)
//   · [근태관리 > 일근태 > 출퇴근상세조회] menu-app-id HRT/W_HRT6300 · 표 #hrt6300_info_list_html
//       머리글: 사업장·부서·사번·이름·직위·전일·출근시각·출근유형·출근정보·익일·퇴근시각·퇴근유형·퇴근정보·휴게시간·…
//       근태일 칸 #hrt6300_yyyymmdd_input (기본 = 오늘)
//   · [근태관리 > 근태계획 > 스케줄 변경 승인] menu-app-id HRT/W_HRT2330 · 표 #hrt2330_master_list_html
//       승인상태 기본 필터 '신청' · 근태일 기본 오늘~+14일 · 줄 모양(확인한 칸 순서):
//       승인상태·사업장·부서·사번·이름·직책·근태일·[변경전 근태유형·출근·퇴근·휴게시간]·[변경후 근태유형·출근·출근타입·퇴근·퇴근타입·휴게시간]·변경처리내역·변경사유·상세사유·요청자·요청시각·처리자·처리시각
//  원칙
//   · 읽기만 한다 (승인·반려·저장·EXCEL 단추는 누르지 않음)
//   · 배경(bg.js)이 연 탭에서만 움직인다 → 사람이 직접 연 HR 탭은 그대로 둔다
//   · 표가 없거나 모양이 달라 읽지 못하면 짐작해 채우지 않고, 본 것(주소·머리글·줄 수)만 알린다
//   · 아이디·비밀번호는 이 PC 크롬 안(chrome.storage.local)에만 있고 코드·로그·시트에 남기지 않는다
(async () => {
  if (window.__gwHr) return; window.__gwHr = 1;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => { // 뒤 탭에서도 배치가 계산되므로 크기로 봄 (position:fixed 조상이면 offsetParent가 null)
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    try { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none"; } catch (e) { return true; }
  };
  const tx = (el) => (el ? String(el.textContent == null ? "" : el.textContent).replace(/[\s\u200b]+/g, " ").trim() : "");
  const say = (msg) => { chrome.runtime.sendMessage({ q: "hrSay", msg: msg }).catch(() => {}); };
  const stop = (error, detail) => { chrome.runtime.sendMessage({ q: "hrFail", error: error, detail: detail || "" }).catch(() => {}); };
  const me = await chrome.runtime.sendMessage({ q: "hrManaged" }).catch(() => null);
  if (!me || !me.managed) return; // 사람이 연 탭 → 아무것도 안 함

  const STORE = "수원컨벤션센터";
  const ATT = { app: "HRT/W_HRT6300", box: "hrt6300_info_list_html", name: "출퇴근상세조회" };
  const REQ = { app: "HRT/W_HRT2330", box: "hrt2330_master_list_html", name: "스케줄 변경 승인" };
  const kstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

  // ---- 0) 로그인 화면 / 로그인 필요 ----
  const pwInput = () => [...document.querySelectorAll('input[type="password"]')].find(vis) || null;
  function setV(el, v) {
    try {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      d.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { el.value = v; }
  }
  async function login() {
    const cfg = await chrome.storage.local.get(["hrId", "hrPw", "hrTries"]);
    if (!cfg.hrId || !cfg.hrPw) return stop("login_required", "저장된 HR 아이디·비밀번호가 없어요 (확장 설정에 넣으면 스스로 로그인)");
    const now = Date.now(), tries = (cfg.hrTries || []).filter((t) => now - t < 3600e3);
    if (tries.length >= 2) return stop("login_required", "플젝 HR 로그인 2번 실패 · 1시간 쉬고 다시 (비밀번호 확인)");
    tries.push(now); await chrome.storage.local.set({ hrTries: tries });
    const pw = pwInput();
    if (!pw) return stop("login_required", "로그인 화면인데 아이디·비밀번호 칸을 못 찾음");
    const idIn = document.querySelector("#login_id") || [...document.querySelectorAll('input[type="text"], input[type="email"]')].filter((i) => vis(i) && (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING)).pop();
    if (idIn) setV(idIn, cfg.hrId);
    setV(pw, cfg.hrPw);
    await sleep(150);
    const btn = document.querySelector("button.login_btn") || [...document.querySelectorAll("button, input[type=submit]")].find((b) => vis(b) && /로그인/.test(tx(b)));
    say("플젝 HR 로그인 시도");
    if (btn) btn.click();
    else if (pw.form) { if (pw.form.requestSubmit) pw.form.requestSubmit(); else pw.form.submit(); }
  }
  const onLoginPath = () => /^\/main\/login/.test(location.pathname);
  let pw = pwInput(), menu = !!document.querySelector("a[menu-app-id]");
  for (let i = 0; i < 40 && !pw && !menu && !onLoginPath(); i++) { await sleep(500); pw = pwInput(); menu = !!document.querySelector("a[menu-app-id]"); } // 첫 화면이 그려지길 (최대 20초)
  if (pw || onLoginPath()) {
    for (let i = 0; i < 20 && !pw; i++) { await sleep(300); pw = pwInput(); }
    if (!pw) return stop("login_required", "로그인 화면인데 아이디·비밀번호 칸을 못 찾음");
    return login();
  }
  if (!menu) { // 로그인 전 첫 화면(회사 소개) → 로그인 페이지로 한 번만
    const { hrGoAt } = await chrome.storage.local.get("hrGoAt");
    if (hrGoAt && Date.now() - hrGoAt < 40e3) return stop("no_menu", "HR 첫 화면에 메뉴가 안 보임 (" + location.pathname + ")");
    await chrome.storage.local.set({ hrGoAt: Date.now() });
    say("플젝 HR 로그인 화면으로 이동");
    location.href = "/main/login";
    return;
  }

  // ---- 1) 메뉴 이동 (사이트가 쓰는 방식 그대로: menu-app-id 붙은 메뉴를 눌러 화면을 엶) ----
  function tap(el) {
    if (!el) return false;
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); return true; } catch (e) { return false; }
  }
  async function openApp(app, box) {
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < 60e3) {
      if (document.getElementById(box)) return true;
      const a = document.querySelector('a[menu-app-id="' + app + '"]');
      if (!a) { // 왼쪽 첫 메뉴(근태관리)가 닫혀 있으면 연다
        const top = document.querySelector('li[menu-desc="근태관리"]');
        tap(top && (top.querySelector(".menu-step1") || top));
      } else if (i % 3 === 0) {
        const ul = a.closest("ul"), grp = ul && ul.previousElementSibling; // 그룹(일근태·근태계획) 펼치기
        if (grp && i === 0) tap(grp.querySelector(".jlamp-gnb-menu-label") || grp);
        await sleep(250);
        tap(a);
      } else if (i % 3 === 1) {
        tap(a.querySelector("span") || a);
      } else {
        tap(a.closest("li") || a);
      }
      i++;
      await sleep(900);
    }
    return !!document.getElementById(box);
  }

  // ---- 2) 표 읽기 ----
  function gridBox(box) { return document.getElementById(box); }
  function gridRows(box) {
    const b = gridBox(box);
    const t = b ? b.querySelector("table.k-selectable") : null;
    if (!t) return null;
    const out = [];
    [...t.querySelectorAll("tbody tr")].forEach((tr) => {
      if (/norecords/.test(tr.className || "")) return;
      if (tr.cells.length < 3) return;
      out.push(tr);
    });
    return out;
  }
  async function waitRows(box, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const rows = gridRows(box);
      if (rows && rows.length) { await sleep(600); return gridRows(box) || []; } // 마지막 줄까지 그려지길 잠깐
      const b = gridBox(box), t = b ? b.querySelector("table.k-selectable") : null;
      if (t && /데이터가 없습니다|내역이 없습니다/.test(tx(t))) return [];
      await sleep(300);
    }
    return gridRows(box) || [];
  }
  function headOf(box) { // 표 머리글 (한 줄짜리 머리글일 때만 칸 이름 → 번호)
    const b = gridBox(box);
    if (!b) return null;
    const head = [...b.querySelectorAll("table")].find((t) => !t.classList.contains("k-selectable") && /출근시각|승인상태/.test(tx(t)));
    if (!head) return null;
    const rows = [...head.querySelectorAll("tr")].filter((tr) => tr.cells.length);
    const names = rows.length === 1 ? [...rows[0].cells].map(tx) : [];
    const at = {};
    names.forEach((n, i) => { if (n && at[n] == null) at[n] = i; });
    return { names: names, at: at, raw: rows.map((tr) => [...tr.cells].map(tx)).slice(0, 2) };
  }

  async function readAttendance() {
    const rows = await waitRows(ATT.box, 45e3);
    if (!rows || !rows.length) return { error: "no_rows", detail: ATT.name + " 표에 줄이 없음 (" + location.pathname + ")" };
    const h = headOf(ATT.box) || { names: [], at: {} }, N = h.at || {};
    const col = (name, fallback) => (N[name] != null ? N[name] : fallback);
    const I = { dept: col("부서", 4), no: col("사번", 5), name: col("이름", 6), pos: col("직위", 7), inT: col("출근시각", 9), inTy: col("출근유형", 10), inIn: col("출근정보", 11), outT: col("퇴근시각", 13), outTy: col("퇴근유형", 14), outIn: col("퇴근정보", 15) };
    const dateEl = document.querySelector("#hrt6300_yyyymmdd_input");
    const cell = (tr, i) => (tr.cells[i] ? tx(tr.cells[i]) : "");
    const chk = (no) => { const a = document.getElementById("hrt6300_before_day_yn_1000_" + no), b = document.getElementById("hrt6300_next_day_yn_1000_" + no); return [!!(a && a.checked), !!(b && b.checked)]; };
    const out = [];
    rows.forEach((tr) => {
      const dept = cell(tr, I.dept), no = cell(tr, I.no);
      const grp = /_BOH$/.test(dept) ? "BOH" : /_FOH$/.test(dept) ? "FOH" : dept ? "관리자" : "";
      if (grp !== "BOH" && grp !== "관리자") return; // FOH·빈 줄은 넣지 않음
      const r = { grp: grp, no: no, name: cell(tr, I.name), dept: dept, pos: cell(tr, I.pos), in: cell(tr, I.inT), inTy: cell(tr, I.inTy), inIn: cell(tr, I.inIn), out: cell(tr, I.outT), outTy: cell(tr, I.outTy), outIn: cell(tr, I.outIn) };
      const d = chk(no);
      if (d[0]) r.prev = 1; // 전일(어제 퇴근)
      if (d[1]) r.next = 1; // 익일(내일 퇴근)
      out.push(r);
    });
    const ok = out.filter((r) => /^\d{7,9}$/.test(r.no)).length;
    if (!ok) return { error: "bad_grid", detail: ATT.name + " 표 모양이 달라 읽지 못함 · 머리글: " + (h.names || []).join("|").slice(0, 220) };
    return { date: (dateEl && dateEl.value) || "", rows: out, n: out.filter((r) => r.in || r.out).length };
  }

  async function readRequests() {
    const box = REQ.box;
    const rows = await waitRows(box, 40e3);
    if (!gridBox(box)) return { error: "no_grid", detail: REQ.name + " 표를 못 찾음 (" + location.pathname + ")" };
    const fmt = (ty, a, b) => [ty, (a || b) ? (a || "--") + "~" + (b || "--") : ""].filter(Boolean).join(" ");
    const out = [];
    let shaped = 0;
    (rows || []).forEach((tr) => {
      const c = [...tr.cells].map(tx);
      if (c.length < 23 || !/^(신청|승인|반려)$/.test(c[1]) || !/^\d{4}-\d{2}-\d{2}$/.test(c[7])) return; // 확인한 칸 모양인지
      shaped++;
      const dept = c[3];
      const grp = /_BOH$/.test(dept) ? "BOH" : /_FOH$/.test(dept) ? "FOH" : "관리자";
      if (grp === "FOH" || c[1] !== "신청") return; // FOH·이미 처리된 건은 넣지 않음
      out.push({ grp: grp, no: c[4], name: c[5], dept: dept, pos: c[6], date: c[7], before: fmt(c[8], c[9], c[10]), after: fmt(c[12], c[13], c[15]), reason: c[19], note: c[20], reqAt: c[22] });
    });
    if ((rows || []).length && !shaped) {
      const h = headOf(box);
      return { error: "bad_grid", detail: REQ.name + " 표 모양이 달라 읽지 못함 · 머리글: " + (h ? h.raw[0].join("|") : "").slice(0, 220) };
    }
    return { pendingRequests: out, reqN: out.length };
  }

  // ---- 3) 두 화면을 차례로 읽고 배경에 넘김 (시트 쓰기는 배경이 함) ----
  say("출퇴근상세조회 읽는 중");
  if (!(await openApp(ATT.app, ATT.box))) return stop("no_page", ATT.name + " 화면을 못 열었어요 (" + location.pathname + ")");
  const att = await readAttendance();
  if (att.error) return stop(att.error, att.detail);
  say("스케줄 변경 승인 읽는 중");
  if (!(await openApp(REQ.app, REQ.box))) return stop("no_page", REQ.name + " 화면을 못 열었어요 (" + location.pathname + ")");
  const rq = await readRequests();
  if (rq.error) return stop(rq.error, rq.detail);
  const at = Date.now(), data = {
    date: att.date || kstDay(at), at: at, store: STORE, src: "hr.pljec.cloud", ver: me.ver || "", by: "pc",
    dept: "MG수원컨벤션센터점_BOH (부서 접미사 없는 관리자 포함 · FOH 제외)",
    n: att.n, rows: att.rows,
    reqN: rq.reqN, reqFilter: "신청", pendingRequests: rq.pendingRequests
  };
  if (att.date && att.date !== kstDay(at)) data.warn = "date_not_today"; // 화면 근태일이 오늘이 아님 (조회 기본일 확인 필요)
  say("시트에 적는 중");
  await chrome.runtime.sendMessage({ q: "hrData", data: data }).catch(() => {});
})();
