// MIS 주문등록 화면에 발주앱의 오늘 발주수량을 넣고 저장까지 하는 스크립트 (북마크 버튼에서 불러옴)
//  1) 구글 시트에서 오늘(input.YYYY-MM-DD) 발주수량(o)을 읽음
//  2) 처음에 넣을 목록을 한 번 보여주고 확인 → 주문그룹(온세물류·새싹농산 …)을 차례로 열어 품목코드로 주문수량(QT_ORDER)을 넣고 [저장]
//  3) 저장 뒤 그룹을 다시 불러와 수량이 맞게 들어갔는지 대조하고 결과를 알려줌
//  MIS 쪽 함수: fn_Search(그룹코드) = 그룹 열기, fn_Save() = 저장, search_Length > 0 = 주문 가능 시간 지남
//  자동 대기(mis-agent.js)가 불러오면 바로 실행하지 않고 window.__misFill(true)만 만들어 둠 → 폰에서 [MIS로 보내기] 누르면 확인창 없이 실행하고 결과를 돌려줌
(() => {
const fill = async (auto) => {
  const stop = (msg) => ({ ok: false, text: msg });
  const API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec";
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : 0; };
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date(), TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 주문등록 표가 있는 프레임 찾기 (MIS는 프레임 안에 프레임)
  // MIS 탭(주문현황·주문등록 …)마다 프레임이 있고 주문현황에도 dataGrid1이 있음 → 주문그룹 버튼(#custBtn)이 있는 주문등록 프레임을 고름
  const find = (top) => {
    const all = [];
    const walk = (w) => { try { if (w.jQuery && w.document.getElementById("dataGrid1")) all.push(w); for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]); } catch (e) {} };
    walk(top);
    const has = (w, sel) => { try { return !!w.document.querySelector(sel); } catch (e) { return false; } };
    return all.find((w) => has(w, "#custBtn input.btn_basic")) || all.find((w) => typeof w.fn_Save === "function" && has(w, "#custBtn")) || all.find((w) => typeof w.fn_Save === "function") || all[0] || null;
  };
  const W = find(window.top);
  if (!W) return stop("MIS [주문등록] 화면이 아니에요. 주문등록 화면을 열어 두세요.");
  const $ = W.jQuery, g = $("#dataGrid1");
  if (W.__appFillRunning) return stop("이미 입력 중이에요.");
  if (num(W.search_Length) > 0) return stop("지금은 MIS 주문 가능 시간이 아니에요.");

  // MIS 함수가 window.event(키보드인지)를 보므로, 우리 작업도 이벤트 안에서 실행
  const inEvent = (fn) => {
    let res, err; const run = () => { try { res = fn(); } catch (e) { err = e; } };
    const h = new W.Function("run", "return function () { run(); };")(run); // MIS 프레임 쪽 함수여야 그 프레임의 event가 잡힘
    W.document.addEventListener("x-appfill", h); W.document.dispatchEvent(new W.Event("x-appfill")); W.document.removeEventListener("x-appfill", h);
    if (err) throw err; return res;
  };
  // MIS 알림창·확인창: 작업하는 동안은 확인은 자동으로 "예", 알림은 모아 두었다가 끝에 보여줌
  const notes = [];
  const origAlert = W.alert, origConfirm = W.confirm;
  const quiet = () => { W.alert = (m) => { notes.push(String(m)); }; W.confirm = (m) => { notes.push("확인: " + m); return true; }; };
  const loud = () => { W.alert = origAlert; W.confirm = origConfirm; };
  // EasyUI 메시지 창(comnMsg)이 뜨면 [확인]을 눌러 닫음
  const clickMessager = () => {
    let n = 0;
    $(".messager-window:visible, .panel.window:visible").each(function () {
      const body = $(this).find(".messager-body"); if (body.length) notes.push(body.text().trim());
      const btn = $(this).find(".messager-button .l-btn, .dialog-button .l-btn").first();
      if (btn.length) { btn[0].click(); n++; }
    });
    return n;
  };

  // 앱 데이터
  let db;
  try { const r = await fetch(API + "?api=1&t=" + Date.now()); db = (await r.json()).data; }
  catch (e) { return stop("발주앱 데이터를 못 불러왔어요. 인터넷 연결을 확인해 주세요."); }
  const inp = db["input." + TODAY] || {};
  const master = ((db["master.order"] || {}).rows) || [];
  const byName = new Map(master.map((r) => [r.name, r]));
  const want = new Map(); // 품목코드 → {name, q, vendor}
  Object.keys(inp).forEach((k) => { const q = num((inp[k] || {}).o), m = byName.get(k); if (q > 0 && m && m.code) want.set(String(m.code), { name: k, q, vendor: m.vendor || "" }); });
  if (!want.size) return stop(`발주앱에 오늘(${TODAY.slice(5)}) 발주수량이 없어요.`);

  // 주문그룹 버튼: <input value="온세물류" onclick="fn_Search('46492')">
  const groups = $("#custBtn input.btn_basic").toArray().map((el) => { const m = /fn_Search\('([^']+)'\)/.exec(el.getAttribute("onclick") || ""); return m ? { code: m[1], name: el.value.trim() } : null; }).filter(Boolean);
  if (!groups.length) return stop("주문그룹 버튼을 못 찾았어요. 매장을 먼저 선택해 주세요.");
  const vendors = new Set([...want.values()].map((w) => w.vendor));
  // 앱 업체와 이름이 같은 그룹 먼저, 나머지 그룹은 남은 품목이 있을 때만 열어 봄
  const order = [...groups.filter((x) => vendors.has(x.name)), ...groups.filter((x) => !vendors.has(x.name))];

  const list = [...want.values()];
  if (!auto && !origConfirm.call(W, `발주앱 오늘(${TODAY.slice(5)}) 발주 ${list.length}개를 MIS에 넣고 저장할까요?\n\n${list.map((w) => `${w.vendor ? "[" + w.vendor + "] " : ""}${w.name}  ${w.q}`).join("\n")}`)) return null;

  const loadGroup = async (code) => {
    inEvent(() => W.fn_Search(code));
    for (let t = 0; t < 60; t++) { await sleep(200); clickMessager(); const rows = g.datagrid("getRows") || []; if (rows.length && (rows[0].CD_GROUP == null || String(rows[0].CD_GROUP) === code)) { await sleep(200); return g.datagrid("getRows"); } }
    return g.datagrid("getRows") || [];
  };

  // KM 요청: 폰에서 확정하면 구글이 대신 넣는 기능을 만들려고, 주문 관련 요청(주소·보낸 값)만 기록해 끝에 파일로 저장
  //  응답 내용은 기록하지 않음. MIS는 매장 인터넷·VPN에서만 열려 구글 서버 방식은 못 써서 지금은 끔 (RECORD = false)
  const RECORD = false, rec = [], origAjax = $.ajax;
  if (RECORD) $.ajax = function (o) {
    if (o && /\/Odmn\//.test(String(o.url))) rec.push({ url: o.url, type: o.type, data: String(typeof o.data === "string" ? o.data : JSON.stringify(o.data)).slice(0, 4000) });
    return origAjax.apply(this, arguments);
  };
  W.__appFillRunning = true;
  const left = new Map(want), report = [], bad = [];
  quiet();
  try {
    for (const grp of order) {
      if (!left.size) break;
      let rows = await loadGroup(grp.code);
      const here = [];
      left.forEach((w, code) => { const idx = rows.findIndex((r) => String(r.CD_ITEM) === code); if (idx >= 0) here.push({ idx, code, ...w }); });
      if (!here.length) continue;
      here.forEach((h) => left.delete(h.code));
      const todo = here.filter((h) => num(rows[h.idx].QT_ORDER) !== h.q);
      if (todo.length) {
        // 사람이 칸에 입력한 것처럼: 편집 시작 → 값 넣기 → 편집 끝 (MIS가 금액·입고일 다시 계산)
        todo.forEach((h) => inEvent(() => {
          g.datagrid("beginEdit", h.idx);
          const ed = g.datagrid("getEditor", { index: h.idx, field: "QT_ORDER" });
          if (ed) { ed.actions.setValue(ed.target, h.q); g.datagrid("endEdit", h.idx); }
          else { g.datagrid("cancelEdit", h.idx); g.datagrid("updateRow", { index: h.idx, row: { QT_ORDER: h.q } }); }
        }));
        inEvent(() => W.fn_Save());
        for (let t = 0; t < 10; t++) { await sleep(300); if (!clickMessager() && t > 2) break; }
      }
      // 저장됐는지: 그룹을 다시 불러와 대조
      rows = await loadGroup(grp.code);
      const miss = here.filter((h) => { const r = rows.find((x) => String(x.CD_ITEM) === h.code); return !r || num(r.QT_ORDER) !== h.q; });
      miss.forEach((h) => bad.push(`[${grp.name}] ${h.name} 앱 ${h.q} / MIS ${(rows.find((x) => String(x.CD_ITEM) === h.code) || {}).QT_ORDER ?? "없음"}`));
      report.push(`${grp.name}: ${here.length - miss.length}/${here.length}개 저장${todo.length ? "" : " (이미 같음)"}`);
    }
  } catch (e) {
    bad.push("중간에 멈춤: " + (e && e.message ? e.message : e));
  } finally {
    loud(); W.__appFillRunning = false; $.ajax = origAjax;
  }

  if (RECORD && rec.length) {
    const a = W.document.createElement("a");
    a.href = W.URL.createObjectURL(new W.Blob([JSON.stringify({ groups, report, bad, rec }, null, 1)], { type: "text/plain" }));
    a.download = `mis_기록_${TODAY}.txt`; W.document.body.appendChild(a); a.click(); a.remove();
  }
  // "최근 15일동안 주문한 수량보다 많습니다"는 무시 (KM 요청). 저장 실패·시간·품목 확인 같은 안내만 보여줌
  const warn = [...new Set(notes.filter((m) => !/최근 15일/.test(m) && /확인하세요|없습니다|아닙니다|실패|오류/.test(m)))];
  const text = (
    (bad.length ? "⚠ 확인 필요\n" + bad.join("\n") + "\n\n" : "✓ 모두 저장됐어요\n\n") +
    report.join("\n") +
    (left.size ? `\n\nMIS 주문그룹에서 못 찾은 품목 ${left.size}개:\n${[...left.values()].map((w) => `${w.name} ${w.q}`).join("\n")}` : "") +
    (warn.length ? `\n\nMIS 안내:\n${warn.slice(0, 6).join("\n")}` : "") +
    (RECORD && rec.length ? `\n\n다운로드 폴더의 mis_기록_${TODAY}.txt 파일을 채팅에 보내 주세요 (폰 자동 입력 만들 때 씀).` : "")
  );
  return { ok: !bad.length && !left.size, text, saved: list.length - left.size - bad.length, total: list.length };
};
window.__misFill = fill;
if (window.__misAgentMode) return;
fill(false).then((r) => { if (r) alert(r.text); }, (e) => alert("오류: " + (e && e.message ? e.message : e)));
})();
