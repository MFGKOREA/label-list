// MIS 화면 진단 (읽기만): 지금 열린 MIS 화면의 표·검색칸·버튼·메뉴 구조를 txt로 저장 → 채팅에 보내면 자동화(매출 가져오기 등)를 만들 때 씀
//  저장·조회 버튼은 누르지 않음. 표는 앞 15줄만.
(() => {
  const out = { at: new Date().toString(), top: location.href, frames: [] };
  const walk = (w, path) => {
    let d; try { d = w.document; void d.body; } catch (e) { out.frames.push({ path, blocked: true }); return; }
    const f = { path, url: w.location.href, title: d.title, grids: [], inputs: [], buttons: [], menus: [] };
    const $ = w.jQuery;
    d.querySelectorAll("table[id], div[id]").forEach((el) => {
      if (!$ || !$(el).data("datagrid")) return;
      const g = $(el), opt = g.datagrid("options"), rows = g.datagrid("getRows") || [];
      const cols = [].concat(...(opt.frozenColumns || []), ...(opt.columns || [])).map((c) => ({ field: c.field, title: String(c.title || "").replace(/<[^>]+>/g, "") }));
      f.grids.push({ id: el.id, url: opt.url || "", cols, rowCount: rows.length, rows: rows.slice(0, 15), footer: (g.datagrid("getFooterRows") || []).slice(0, 3) });
    });
    d.querySelectorAll("input, select").forEach((el) => {
      if (el.type === "password" || el.type === "hidden" && !el.id) return;
      f.inputs.push({ tag: el.tagName.toLowerCase(), type: el.type, id: el.id, name: el.name, value: el.type === "password" ? "" : String(el.value).slice(0, 40), cls: el.className.slice(0, 60), options: el.tagName === "SELECT" ? [...el.options].map((o) => o.value + "=" + o.text).slice(0, 20) : undefined });
    });
    d.querySelectorAll("a, button, input[type=button], span.l-btn-text").forEach((el) => {
      const t = (el.textContent || el.value || "").trim(); const oc = el.getAttribute && (el.getAttribute("onclick") || "");
      if (t && t.length < 30 || oc) f.buttons.push({ text: t.slice(0, 30), id: el.id, onclick: String(oc).slice(0, 120), href: (el.getAttribute && el.getAttribute("href") || "").slice(0, 120) });
    });
    d.querySelectorAll(".tree-title, .tree-node").forEach((el) => { const t = el.textContent.trim(); if (/매출|Report|주문/i.test(t)) f.menus.push({ text: t.slice(0, 40), cls: el.className, nodeId: el.closest("[node-id]") ? el.closest("[node-id]").getAttribute("node-id") : "" }); });
    if (f.grids.length || f.inputs.length || f.menus.length) out.frames.push(f);
    for (let i = 0; i < w.frames.length; i++) walk(w.frames[i], path + "/" + i);
  };
  walk(window.top, "top");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "text/plain" }));
  a.download = "mis_진단_" + new Date().toISOString().slice(0, 10) + ".txt";
  document.body.appendChild(a); a.click(); a.remove();
  const g = out.frames.reduce((n, f) => n + (f.grids ? f.grids.length : 0), 0);
  alert(`진단 파일을 저장했어요 (표 ${g}개). 다운로드 폴더의 ${a.download}를 채팅에 보내 주세요.`);
})();
