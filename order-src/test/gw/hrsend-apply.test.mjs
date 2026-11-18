// HR 카드 입력(4단계, cardApply) 시험 — 21명·바뀐 칸 117개를 넣을 때 **표를 몇 번 다시 그리는지**
//  1.17.6까지는 kendo의 set()을 600번 가까이 불러 그때마다 36명×7일 표를 다시 그렸다 → 11/18 실제 화면에서 4단계만 24.8초.
//  1.17.7은 값은 행 모델에 직접 넣고(알림 0번) 화면은 저장 뒤 서버 값으로 한 번만 그린다. 그게 지켜지는지 본다.
//  쓰는 것: jsdom(있을 때만). 없으면 건너뜀 — npm i jsdom 또는 NODE_PATH=/…/node_modules
//  사용: node order-src/test/gw/hrsend-apply.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const SRC = fs.readFileSync(path.join(REPO, "gw-agent/hrsend-steps.js"), "utf8");
let JSDOM = null;
try { ({ JSDOM } = await import("jsdom")); } catch (e) { /* 없으면 아래에서 건너뜀 */ }
if (!JSDOM) { console.log("jsdom 없음 — 건너뜀 (npm i jsdom 또는 NODE_PATH로 설치 폴더를 가리키게)"); process.exit(0); }
let n = 0, fails = 0, oldMs = 0, oldRenders = 0;
const ok = (c, m, x) => { n++; console.log((c ? "통과 " : "실패 ") + m + (c || x == null ? "" : "\n   " + JSON.stringify(x).slice(0, 500))); if (!c) fails++; };
const DOWS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], KN = { "10": "출근", "17": "휴무", "18": "주휴일" };
const FIELDS = ["_time_item_code_p", "_time_item_name_p", "_work_on_p_hhmm", "_work_off_p_hhmm", "_break_time_p_hhmm"];

// ---- 가짜 HR 화면 (이름·사번은 지어낸 것) ----
//  opt.setter: 행 모델의 칸에 set 접근자까지 정의된 경우(값을 잃지 않고 kendo set을 쓰는지)
function world(opt = {}) {
  const dom = new JSDOM(`<!doctype html><meta charset="utf-8"><body>
    <div id="hrt2325_info_list_html"></div>
    <div id="jl_noti" style="display:none"><span id="jl_noti_msg"></span><button id="jl_noti_footer_btn1">확인</button></div>
  </body>`, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  const H = { renders: 0, setCalls: 0, saveCalls: 0, saves: [], week: {}, sent: null, phase: "ready" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 서버가 가진 주 자료: 평일 출근 09:00~18:00/01:00 · 토 휴무 · 일 주휴일
  const EMP = [], OTHER = [];
  for (let i = 1; i <= 36; i++) {
    const no = i <= 21 ? "900001" + String(i).padStart(2, "0") : "900003" + String(i - 21).padStart(2, "0");
    (i <= 21 ? EMP : OTHER).push(no);
    const wk = {};
    DOWS.forEach((D, j) => { wk[D] = j < 5 ? { code: "10", kname: "출근", in: "09:00", out: "18:00", brk: "01:00" } : { code: j === 5 ? "17" : "18", kname: j === 5 ? "휴무" : "주휴일", in: "", out: "", brk: "" }; });
    H.week[no] = wk;
  }
  // 행 만들기 — kendo Model처럼 값은 그냥 속성, set()은 값이 다를 때만 '바뀜' 알림(= 표 다시 그리기)
  const proto = {};
  if (opt.setter) {
    for (const f of ["workType"].concat(DOWS.flatMap((d) => FIELDS.map((s) => d + s)))) {
      Object.defineProperty(proto, f, { configurable: true, enumerable: false, get() { return this["_v_" + f]; }, set(v) { this.set(f, v); } });
    }
  }
  const model = (no) => {
    const r = Object.create(proto);
    const put0 = (f, v) => { if (opt.setter) r["_v_" + f] = v; else r[f] = v; };
    r.emp_code = no; r.emp_name = "시험" + no.slice(-2); put0("workType", ""); r.dirty = false; r.dirtyFields = {};
    const wk = H.week[no] || {};
    DOWS.forEach((D) => { r[D + "_edit_yn"] = "Y"; FIELDS.forEach((f) => { const x = wk[D] || {}; const v = f === "_time_item_code_p" ? (x.code || "") : f === "_time_item_name_p" ? (x.kname || "") : f === "_work_on_p_hhmm" ? (x.in || "") : f === "_work_off_p_hhmm" ? (x.out || "") : (x.brk || ""); put0(D + f, v); }); });
    const store = (f, v) => { if (opt.setter) r["_v_" + f] = v; else r[f] = v; };
    r.set = function (f, v) { // kendo ObservableObject.set: 값이 같으면 아무것도 안 하고, 다르면 표를 다시 그린다
      const cur = opt.setter ? this["_v_" + f] : this[f];
      if (String(cur == null ? "" : cur) === String(v == null ? "" : v)) { this.trigger && this.trigger("equalSet", { field: f }); return; }
      store(f, v); this.dirty = true; this.dirtyFields[f] = true; H.setCalls++; H.renders++; draw();
    };
    return r;
  };

  let data = EMP.concat(OTHER).map(model);
  // 표 그리기: 36행 × 7요일 (진짜 kendo Grid가 행 하나 바뀔 때 표 전체를 다시 그리는 값이 비싼 쪽을 흉내)
  function draw() {
    const el = doc.getElementById("hrt2325_info_list_html");
    const tbl = doc.createElement("table"), tb = doc.createElement("tbody");
    for (const r of data) {
      const tr = doc.createElement("tr"); tr.setAttribute("data-uid", "u" + r.emp_code);
      for (const D of DOWS) { const td = doc.createElement("td"); td.textContent = (KN[r[D + "_time_item_code_p"]] || "") + (r[D + "_work_on_p_hhmm"] ? " " + r[D + "_work_on_p_hhmm"] + "~" + r[D + "_work_off_p_hhmm"] : ""); tr.appendChild(td); }
      tb.appendChild(tr);
    }
    tbl.appendChild(tb); el.innerHTML = ""; el.appendChild(tbl);
    el.__k = { kendoGrid: grid };
  }
  const ds = {
    data: () => data,
    view: () => data,
    hasChanges: () => data.some((r) => /^[UID]$/.test(String(r.workType || ""))),
    cancelChanges: () => { data.forEach((r) => { r.dirty = false; r.dirtyFields = {}; }); },
  };
  const grid = { columns: [], dataSource: ds, refresh() { draw(); } }; // kendo Grid.refresh는 서버를 다시 부르지 않음

  // 가짜 jq: ajaxSend·ajaxComplete 갈고리 + data("kendoGrid")
  const hooks = { send: [], complete: [] };
  const Wr = (el) => ({ el, data: (k) => (el && el.__k ? el.__k[k] : null), find: (s) => Wr(el ? el.querySelector(s) : null) });
  w.jq = (sel) => {
    if (sel === doc) return { ajaxSend: (f) => hooks.send.push(f), ajaxComplete: (f) => hooks.complete.push(f), ajaxError: () => {} };
    if (sel && sel.el !== undefined) return sel;
    return Wr(typeof sel === "string" ? doc.querySelector(sel) : sel);
  };
  w.decParam = (s) => Buffer.from(s, "base64").toString("utf8");
  let seq = 0;
  async function ajax(ep, body) { // 실제 화면처럼: 보낼 때 → 서버 → 받을 때
    const st = { url: "/HRT/W_HRT2325/W_HRT2325/" + ep, __gw: ++seq };
    hooks.send.forEach((f) => f({}, {}, st));
    await sleep(3);
    const j = await server(ep, body || {});
    hooks.complete.forEach((f) => f({}, { status: 200, responseText: JSON.stringify(j), responseJSON: j }, st));
    return j;
  }
  async function server(ep, b) {
    if (ep === "saveData_prc") {
      H.saves.push((b.rows || []).map((x) => x.emp_code));
      for (const x of b.rows || []) { const wk = H.week[x.emp_code] = H.week[x.emp_code] || {}; DOWS.forEach((D) => { wk[D] = { code: x[D + "_time_item_code_p"] || "", kname: x[D + "_time_item_name_p"] || "", in: x[D + "_work_on_p_hhmm"] || "", out: x[D + "_work_off_p_hhmm"] || "", brk: x[D + "_break_time_p_hhmm"] || "" }; }); }
      return { returnCode: 0 };
    }
    if (ep === "getMasterList_prc") return { returnCode: 0, data: { infoEnc: "[]" } };
    return { returnCode: 0 };
  }
  // HR의 saveData: workType 'U' 행만 골라 보내고(모델 값 그대로) 저장 뒤 표를 서버 값으로 다시 읽는다
  w.hrt2325 = {
    async saveData() {
      H.saveCalls++;
      const rows = data.filter((r) => String(r.workType || "") === "U").map((r) => { const o = { emp_code: r.emp_code }; DOWS.forEach((D) => FIELDS.forEach((f) => { o[D + f] = r[D + f]; })); return o; });
      H.sent = rows;
      const j = await ajax("saveData_prc", { rows });
      if (j.returnCode !== 0) return;
      await ajax("getMasterList_prc", { workType: "MAINROWS" }); // 서버에서 다시 받기
      data = EMP.concat(OTHER).map(model); // 새 행(workType 빈칸)
      draw();
    },
  };
  draw();
  w.eval(SRC); // hrsStep을 이 화면 안에 올림
  return { w, H, EMP, OTHER, world: { get data() { return data; }, week: H.week } };
}

// 21명 · 바뀐 칸 117개: 평일 5일은 시간(08:00~17:00)이 바뀌고(105), 토요일은 앞 12명만 출근으로 바뀐다(12)
function empsFor(EMP) {
  return EMP.map((no, i) => ({
    empNo: no, name: "시험" + no.slice(-2),
    days: DOWS.map((dow, j) => (j < 5 ? { dow, code: "10", kname: "출근", in: "08:00", out: "17:00", brk: "01:00" }
      : j === 5 ? { dow, code: i < 12 ? "10" : "17", kname: i < 12 ? "출근" : "휴무", in: i < 12 ? "08:00" : "", out: i < 12 ? "17:00" : "", brk: i < 12 ? "01:00" : "" }
        : { dow, code: "18", kname: "주휴일", in: "", out: "", brk: "" })),
  }));
}

// ---- 1) 예전 방식(칸마다 모델 set)이 표를 몇 번 다시 그리는지: 값이 비싼 쪽을 재 둔다 ----
{
  const W = world();
  const g = W.w.document.getElementById("hrt2325_info_list_html").__k.kendoGrid;
  const byNo = new Map(g.dataSource.data().map((r) => [r.emp_code, r]));
  const t0 = Date.now();
  let calls = 0;
  for (const e of empsFor(W.EMP)) for (const d of e.days) {
    const r = byNo.get(e.empNo), D = d.dow;
    const cur = { code: String(r[D + "_time_item_code_p"] || ""), in: String(r[D + "_work_on_p_hhmm"] || ""), out: String(r[D + "_work_off_p_hhmm"] || ""), brk: String(r[D + "_break_time_p_hhmm"] || "") };
    if (cur.code === d.code && cur.in === d.in && cur.out === d.out && cur.brk === d.brk) continue;
    r.set(D + "_time_item_code_p", d.code); if (d.kname) r.set(D + "_time_item_name_p", d.kname);
    r.set(D + "_work_on_p_hhmm", d.in); r.set(D + "_work_off_p_hhmm", d.out); r.set(D + "_break_time_p_hhmm", d.brk);
    calls += 5;
  }
  for (const no of W.EMP) { byNo.get(no).set("workType", "U"); calls++; }
  const oldMs2 = oldMs = Date.now() - t0; void oldMs2;
  console.log(`# 예전 방식(칸마다 set): set ${calls}번 · 표 다시 그리기 ${W.H.renders}번 · ${oldMs}ms (이 화면 기준)`);
  ok(calls > 500 && W.H.renders > 250, "예전 방식은 부를 때마다 표를 다시 그린다 (값이 비싼 이유 확인)", { calls, renders: W.H.renders });
}

// ---- 2) 1.17.7 cardApply: 같은 117칸을 넣고 저장·확인까지 ----
{
  const W = world(), { w, H } = W;
  const before = H.renders;
  const t0 = Date.now();
  const r = await w.hrsStep("cardApply", { emps: empsFor(W.EMP), keep: [], weekly: "18", own: null });
  const ms = Date.now() - t0;
  oldRenders = 0;
  ok(r.ok === true && r.applied === 117, "117칸 넣고 저장 → 다시 읽어 확인 맞음", { ok: r.ok, applied: r.applied, message: r.message });
  ok(H.renders - before === 0, "입력하는 동안 표 다시 그리기 0번 (예전 500번대)", { renders: H.renders - before, setCalls: H.setCalls });
  ok(r.ms && r.ms.setCalls === 0 && r.ms.apply <= r.ms.total, "결과에 구간 ms가 찍힌다 (입력·저장 확인·정리)", r.ms);
  const sent = H.sent || [];
  ok(sent.length === 21, "저장 요청에 바뀐 21명만 실린다 (workType 'U')", sent.length);
  const first = sent.find((x) => x.emp_code === W.EMP[0]) || {};
  ok(first.MON_work_on_p_hhmm === "08:00" && first.MON_work_off_p_hhmm === "17:00" && first.SUN_time_item_code_p === "18", "저장 요청 값이 넣은 값 그대로 (월 08:00~17:00 · 일 주휴일)", { mon: first.MON_work_on_p_hhmm, sun: first.SUN_time_item_code_p });
  ok(String(H.week[W.EMP[0]].MON.out) === "17:00" && String(H.week[W.EMP[0]].MON.in) === "08:00", "서버에도 넣은 값이 들어갔다", H.week[W.EMP[0]].MON);
  ok(H.saveCalls === 1, "저장은 한 번", H.saveCalls);
  console.log(`# 1.17.7 cardApply: 117칸 · 전체 ${ms}ms (입력 ${r.ms.apply}ms · 표 다시 그리기 ${H.renders - before}번) · 예전 방식은 입력에서만 ${oldMs}ms`);
  ok(r.ms.apply * 5 < oldMs, "입력 시간이 예전보다 확실히 줄었다 (같은 화면 · 같은 117칸)", { now: r.ms.apply, old: oldMs });
}

// ---- 3) set 접근자가 정의된 행 모델이면 kendo set으로 (값을 잃지 않게) ----
{
  const W = world({ setter: true }), { w, H } = W;
  const r = await w.hrsStep("cardApply", { emps: empsFor(W.EMP), keep: [], weekly: "18", own: null });
  const sent = H.sent || [];
  const first = sent.find((x) => x.emp_code === W.EMP[0]) || {};
  ok(r.ok === true && r.applied === 117 && r.ms.setCalls > 0, "접근자 모델: kendo set으로 넣고(값 유지) 저장·확인 통과", { ok: r.ok, applied: r.applied, setCalls: r.ms && r.ms.setCalls });
  ok(first.MON_work_on_p_hhmm === "08:00" && String(r.rowsTouched) === "21", "접근자 모델도 저장 요청 값이 맞다", { mon: first.MON_work_on_p_hhmm, rowsTouched: r.rowsTouched });
}

// ---- 4) 이미 같은 값이면 아무것도 안 함 ----
{
  const W = world(), { w, H } = W;
  const before = H.renders;
  const r = await w.hrsStep("cardApply", { emps: W.EMP.map((no) => ({ empNo: no, name: "시험" + no.slice(-2), days: DOWS.map((dow, j) => ({ dow, code: j < 5 ? "10" : j === 5 ? "17" : "18", kname: j < 5 ? "출근" : j === 5 ? "휴무" : "주휴일", in: j < 5 ? "09:00" : "", out: j < 5 ? "18:00" : "", brk: j < 5 ? "01:00" : "" })) })), keep: [], weekly: "18", own: null });
  ok(r.ok === true && r.applied === 0 && H.saveCalls === 0 && H.renders === before, "바뀔 칸 0개면 저장도 다시 그리기도 안 함", { applied: r.applied, saves: H.saveCalls });
}

console.log(fails ? `실패 ${fails}개 / ${n}` : `모두 통과 (${n}개)`);
process.exit(fails ? 1 : 0);
