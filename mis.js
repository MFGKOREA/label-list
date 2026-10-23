// MIS 주문등록 화면에 발주앱의 오늘 발주수량을 채워 넣는 스크립트 (북마크 버튼에서 불러옴)
//  - 구글 시트에서 오늘(input.YYYY-MM-DD) 발주수량(o)을 읽어 품목코드로 MIS 표(dataGrid1)의 주문수량(QT_ORDER)에 넣음
//  - 저장은 하지 않음: 채운 뒤 KM이 확인하고 MIS의 [저장]을 직접 누름
//  - 지금 화면(주문그룹)에 없는 품목은 따로 알려줌 → 다른 주문그룹을 열고 버튼을 다시 누르면 됨
(async () => {
  const API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec";
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : 0; };
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date(), TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // 주문등록 표가 있는 프레임 찾기 (MIS는 프레임 안에 프레임)
  const find = (w) => {
    try { if (w.jQuery && w.document.getElementById("dataGrid1")) return w; } catch (e) { return null; }
    for (let i = 0; i < w.frames.length; i++) { const r = find(w.frames[i]); if (r) return r; }
    return null;
  };
  const W = find(window.top);
  if (!W) { alert("MIS [주문등록] 화면에서 눌러 주세요."); return; }
  const $ = W.jQuery, g = $("#dataGrid1");

  let db;
  try { const r = await fetch(API + "?api=1&t=" + Date.now()); db = (await r.json()).data; }
  catch (e) { alert("발주앱 데이터를 못 불러왔어요. 인터넷 연결을 확인해 주세요."); return; }

  const inp = db["input." + TODAY] || {};
  const master = ((db["master.order"] || {}).rows) || [];
  const codeOf = new Map(master.map((r) => [r.name, String(r.code || "")]));
  const want = new Map(); // 품목코드 → {name, q}
  Object.keys(inp).forEach((k) => { const q = num((inp[k] || {}).o); const c = codeOf.get(k); if (q > 0 && c) want.set(c, { name: k, q }); });
  if (!want.size) { alert(`발주앱에 오늘(${TODAY.slice(5)}) 발주수량이 없어요.`); return; }

  const rows = g.datagrid("getRows") || [];
  const plan = [], miss = [];
  want.forEach((w, code) => {
    const idx = rows.findIndex((r) => String(r.CD_ITEM) === code);
    if (idx < 0) { miss.push(w); return; }
    const cur = num(rows[idx].QT_ORDER);
    plan.push({ idx, code, name: rows[idx].NM_ITEM || w.name, unit: rows[idx].NM_UNIT || "", q: w.q, cur, price: num(rows[idx].UP_PRICE) });
  });
  if (!plan.length) { alert(`이 화면(주문그룹)에는 넣을 품목이 없어요.\n다른 주문그룹을 열고 다시 눌러 주세요.\n\n남은 품목 ${miss.length}개: ${miss.slice(0, 8).map((m) => m.name).join(", ")}${miss.length > 8 ? " 외" : ""}`); return; }

  const changed = plan.filter((p) => p.cur !== p.q);
  const lines = plan.map((p) => `${p.name}  ${p.cur !== p.q ? `${p.cur} → ` : ""}${p.q}${p.unit}`);
  if (!W.confirm(`발주앱 오늘 발주 ${plan.length}개를 채울까요? (바뀌는 것 ${changed.length}개)\n저장은 확인 후 [저장]을 직접 눌러 주세요.\n\n${lines.join("\n")}`)) return;

  // 사람이 칸에 입력한 것과 같게: 편집기가 있으면 편집 → 끝내기(화면의 금액 계산이 같이 돎), 없으면 줄 값 바꾸기
  const hasEditor = !!((g.datagrid("getColumnOption", "QT_ORDER") || {}).editor);
  let ok = 0;
  changed.forEach((p) => {
    try {
      if (hasEditor) {
        g.datagrid("beginEdit", p.idx);
        const ed = g.datagrid("getEditor", { index: p.idx, field: "QT_ORDER" });
        if (ed) { ed.actions.setValue(ed.target, p.q); g.datagrid("endEdit", p.idx); ok++; return; }
        g.datagrid("cancelEdit", p.idx);
      }
      g.datagrid("updateRow", { index: p.idx, row: { QT_ORDER: p.q, AM_ORDER: p.q * p.price } });
      ok++;
    } catch (e) { /* 이 줄은 건너뜀 */ }
  });
  // 바뀐 줄을 눈에 띄게
  changed.forEach((p) => { const tr = W.document.getElementById(`dataGrid1_datagrid-row-r1-2-${p.idx}`); if (tr) tr.style.background = "#fff3b0"; });

  alert(`${ok}개 채웠어요 (노란 줄).\n금액·수량 확인하고 [저장]을 눌러 주세요.` +
    (miss.length ? `\n\n이 화면에 없는 품목 ${miss.length}개 → 다른 주문그룹을 열고 버튼을 다시 누르세요:\n${miss.map((m) => `${m.name} ${m.q}`).join("\n")}` : ""));
})();
