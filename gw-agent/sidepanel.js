// HR 근무표 입력 사이드패널 (GW Agent 1.15.0, 11/17 KM): 붙여넣기 → HR 주차 확인 → 미리보기(바뀔 칸만) → [반영 후 저장]
//  사용자가 이미 로그인해 연 HR 주간스케쥴(시간) 탭에서만 움직임. 로그인 정보는 다루지 않음. 미리보기·확인 없이는 저장하지 않음
//  화면 조작은 hrsend-steps.js의 hrsStep(cardDiff·cardApply)을 그 탭의 MAIN world에서 실행 — 보드 [HR 전송]과 같은 코드
(() => {
  const $ = (id) => document.getElementById(id), esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  $("ver").textContent = chrome.runtime.getManifest().version;
  const CODE = { 출근: "10", 휴무: "17", 주휴일: "18" }; // 11/17 KM 확인. 공휴일은 근태 칸 드롭다운에서 읽음
  let info = null, plan = null, previewed = null;
  async function hrTab() {
    const [a] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (a && /^https:\/\/hr\.pljec\.cloud\//.test(a.url || "")) return a;
    const all = await chrome.tabs.query({ url: "https://hr.pljec.cloud/*" });
    return all[0] || null;
  }
  async function run(op, arg) {
    const t = await hrTab(); if (!t) return { ok: false, message: "HR(hr.pljec.cloud) 탭이 없어요 — 로그인한 HR 탭에서 주간스케쥴(시간)을 열어 주세요" };
    try { const r = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: "MAIN", func: hrsStep, args: [op, arg || {}] }); return (r && r[0] && r[0].result) || { ok: false, message: "결과가 안 돌아왔어요" }; }
    catch (e) { return { ok: false, message: "HR 탭에 들어가지 못했어요: " + (e && e.message) }; }
  }
  async function refresh() {
    info = await run("panelInfo", {});
    if (!info.ok || !info.screen) { $("week").textContent = info.message || "주간스케쥴(시간) 화면이 아니에요 — 근태관리 › 근태계획 › 주간스케쥴(시간)에서 [검색]한 뒤 다시"; $("week").className = "err"; return false; }
    $("week").textContent = `${info.week} · ${info.weekStart} 시작 · 표 ${info.rows}명${info.dept ? " · 소속 " + info.dept : " · 소속 전체"}`; $("week").className = "";
    return true;
  }
  const show = (html) => { $("out").innerHTML = html; };
  const list = (title, items, cls) => (items && items.length ? `<p class="${cls}"><b>${title} ${items.length}</b></p><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  $("refresh").onclick = refresh;
  $("weekOk").onchange = () => { $("apply").disabled = !(previewed && previewed.changes.length && $("weekOk").checked); };
  $("preview").onclick = async () => {
    $("apply").disabled = true; previewed = null; show('<p class="muted">읽는 중…</p>');
    if (!(await refresh())) return show("");
    const p = hrsParsePaste($("paste").value, info.weekStart);
    if (!p.emps.length) return show(list("붙여넣기 오류", p.errors.map((e) => e.msg), "err") || '<p class="err">붙여넣은 글이 없어요</p>');
    const chk = hrsCheck({ dept: "ALL", byName: true, weekStart: info.weekStart, mode: "saveOnly", employees: p.emps });
    if (!chk.ok) return show(list("붙여넣기 오류", p.errors.map((e) => e.msg), "err") + list("입력 오류 (저장 안 함)", chk.errors.map((e) => `${e.name || ""} ${e.msg}`), "err"));
    const need = new Set(); chk.plan.emps.forEach((e) => e.days.forEach((d) => { if (!CODE[d.kind]) need.add(d.kind); }));
    const codes = { ...CODE };
    if (need.size) { const lc = await run("learnCodes", {}); (lc.list || []).forEach((x) => { if (/공휴/.test(x.t)) codes["공휴일"] = x.v; }); const unk = [...need].filter((k) => !codes[k]); if (unk.length) return show(`<p class="err">근태 코드를 몰라요: ${esc(unk.join(", "))}</p>`); }
    plan = { emps: chk.plan.emps.map((e) => ({ empNo: "", name: e.name, days: e.days.map((d) => ({ dow: d.dow, code: codes[d.kind], kname: d.kind, in: d.in, out: d.out, brk: d.brk })) })), keep: chk.warns.filter((w) => w.keepWeekly).map((w) => w.name), weekly: codes["주휴일"], week: info.week };
    const df = await run("cardDiff", plan);
    if (!df.ok) return show(`<p class="err">${esc(df.message)}</p>`);
    previewed = df;
    const fmt = (v) => (v.code === "10" ? `출근 ${v.in}~${v.out}/${v.brk || "-"}` : ({ 17: "휴무", 18: "주휴일" }[v.code] || (v.code ? "코드 " + v.code : "(빈칸)")));
    show(`${df.dirty ? '<p class="err"><b>HR 표에 저장 안 된 변경이 있어요 — HR에서 [검색]으로 새로 고친 뒤 다시</b></p>' : ""}
      <p><b>바뀔 칸 ${df.changes.length}개</b> <span class="muted">(${p.emps.length}명 입력 · 같은 칸은 건드리지 않음)</span></p>
      ${df.changes.length ? `<table><tr><th>이름</th><th>요일</th><th>기존</th><th>새 값</th></tr>${df.changes.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.dow}</td><td class="muted">${esc(fmt(c.from))}</td><td>${esc(fmt(c.to))}</td></tr>`).join("")}</table>` : ""}
      ${list("확인 필요 (주휴일 유지)", df.kept.map((k) => `${k.name} ${k.dow}: ${k.msg}`), "warn")}
      ${list("건너뜀", [...df.skipped.map((k) => `${k.name}: ${k.msg}`), ...df.locked.map((k) => `${k.name} ${k.dow}: ${k.msg}`)], "warn")}
      ${list("경고", [...p.warns.map((w) => `${w.name} ${w.msg}`), ...chk.warns.filter((w) => !w.keepWeekly).map((w) => `${w.name} ${w.msg}`)], "warn")}
      ${list("붙여넣기 오류(빠진 사람)", p.errors.map((e) => e.msg), "err")}`);
    if (df.dirty) previewed = null;
    $("weekOk").onchange();
  };
  $("apply").onclick = async () => {
    if (!previewed || !plan || !$("weekOk").checked) return;
    const now = await run("panelInfo", {});
    if (!now.ok || now.week !== plan.week) return show(`<p class="err">HR 화면 주차가 바뀌었어요 (${esc(now.week || "?")}) — 다시 미리보기</p>`);
    $("apply").disabled = true; $("preview").disabled = true; show('<p class="muted">반영·저장 중… HR 탭을 건드리지 마세요</p>');
    const r = await run("cardApply", plan);
    $("preview").disabled = false; previewed = null;
    if (!r.ok) return show(`<p class="err"><b>저장 안 됨</b> · ${esc(r.message)}</p>${list("다시 읽었더니 다른 칸", (r.notSaved || []).map((x) => `${x.name} ${x.dow}: ${x.msg}`), "err")}`);
    show(`<p class="ok"><b>저장 됨</b> · 바뀐 칸 ${r.applied}개 (${r.rowsTouched || 0}명), 다시 읽어 확인 맞음</p>
      ${list("확인 필요 (주휴일 유지)", (r.kept || []).map((k) => `${k.name} ${k.dow}`), "warn")}
      ${list("건너뜀", [...(r.skipped || []).map((k) => `${k.name}: ${k.msg}`), ...(r.locked || []).map((k) => `${k.name} ${k.dow}: ${k.msg}`)], "warn")}`);
    await run("done", {});
  };
  refresh();
})();
