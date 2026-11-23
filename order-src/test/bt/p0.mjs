// P0 되돌려 보기: 예전 order.html과 새 order.html의 매출 예상·예상 재고를 같은 시트 사본으로 비교. 시트에 안 씀.
// 사용: node order-src/test/bt/p0.mjs <kv.json> <예전.html> [새.html=order.html]
//  매출 예상 = dayGross(날짜, false) vs 실제 Gross. 예상 재고 = estStock(품목, 날짜, null, false, 날짜) vs 그날 센 값 (10/20~26).
//  적중 = |예상−실제| ≤ max(1단위, 실제의 10%). 덜 시킬 위험 = 예상이 실제보다 반 단위 넘게 큼.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openApp } from "./asof.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [KV, OLD, NEW = path.resolve(HERE, "../../../order.html")] = process.argv.slice(2);
if (!KV || !OLD) { console.log("사용: node order-src/test/bt/p0.mjs <kv.json> <예전.html> [새.html]"); process.exit(1); }

const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : NaN; };
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const pct = (x) => x == null ? "–" : (x * 100).toFixed(1) + "%";
const mape = (rows, pred) => { const xs = rows.map((r) => Math.abs(r.act / pred(r) - 1)); return xs.length ? mean(xs) : null; };
const bias = (rows, pred) => rows.length ? mean(rows.map((r) => r.act / pred(r) - 1)) : null;

async function snap(html) {
  const { page, close, errs } = await openApp({ kvPath: KV, html });
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.click("#dock [data-dock=forecast]").catch(() => {});
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const C = window.__orderCalc, db = C.db(), fc = db.forecast || {}, ev = ((db.events || {}).days) || {};
    const days = [];
    Object.keys(fc).sort().forEach((d) => {
      if (d >= C.TODAY) return;
      const act = parseFloat(String((fc[d] || {}).act ?? "").replace(/,/g, ""));
      if (!(act > 0)) return;
      const g = C.dayGross(d, false);
      days.push({ d, act, pred: g.v, src: g.src, ev: !!((ev[d] || {}).n > 0) });
    });
    const M = C.model();
    const stock = [];
    for (let d = "2026-10-20"; d <= "2026-10-26"; d = C.addDays(d, 1)) {
      M.items.forEach((it) => {
        if (it.ledgerOnly || it.plain) return;
        const v = (db["input." + d] || {})[it.key];
        if (!C.counted(v)) return;
        const e = C.estStock(it, d, null, false, d);
        if (!e) return;
        const step = it.box || C.countStepOf(it) || 1;
        stock.push({ d, e: e.v, unk: !!e.unk, a: C.stockOf(it, v), step, ev: !!((ev[d] || {}).n > 0) });
      });
    }
    return {
      today: C.TODAY,
      days,
      stock,
      chips: document.querySelectorAll("#orderList .chip.err").length,
      gaps: document.querySelectorAll("#orderList .estchip.gap, #orderList .boxnote").length,
      fcNotes: [...document.querySelectorAll("#fcRows .dfc small")].map((el) => el.textContent).filter((t) => t.includes("행사") || t.includes("발주") || t.includes("비") || t.includes("한파")).length,
    };
  });
  await page.click("#dock [data-dock=order]").catch(() => {});
  await page.waitForTimeout(300);
  const ui = await page.evaluate(() => ({
    chips: document.querySelectorAll("#orderList .chip.err").length,
    gapChips: document.querySelectorAll("#orderList .estchip.gap").length,
    gapNotes: [...document.querySelectorAll("#orderList .boxnote")].filter((el) => el.textContent.includes("입고 확인")).length,
  }));
  const prove = await page.evaluate(() => {
    const C = window.__orderCalc; if (!C.fcAdj || !C.evUplift || !C.recvUnknown) return null;
    const db = C.db(), ev = ((db.events || {}).days) || {}, M = C.model();
    const d = Object.keys(ev).find((x) => (ev[x] || {}).n > 0 && x < C.TODAY && parseFloat(String(((db.forecast || {})[x] || {}).fc || "").replace(/,/g, "")) > 0);
    const before = d ? C.fcAdj(d) : null, def = d ? C.evUplift(d) : null;
    if (d) ev[d] = { ...ev[d], exp: ev[d].cap || 7000 };
    const after = d ? C.fcAdj(d) : null;
    const it = M.items.find((x) => !x.ledgerOnly && !x.plain && (x.codes || []).length);
    let gapOn = false;
    if (it) {
      const from = "2026-11-09", to = "2026-11-12";
      for (let x = from; x <= to; x = C.addDays(x, 1)) delete db["misRecv." + x];
      delete db["misOrder.2026-11-10"];
      const row = db["input.2026-11-10"];
      if (row) Object.keys(row).forEach((k) => { if (row[k]) row[k] = { ...row[k], o: "" }; });
      gapOn = C.recvUnknown(it, from, to);
    }
    return { day: d, uplift: before > 0 ? after / before : null, def, gapOn };
  });
  await close();
  return { ...r, ui, prove, errs };
}

const met = (rows) => {
  if (!rows.length) return "0건";
  let ae = 0, w = 0, hit = 0, risk = 0, over = 0, unk = 0;
  rows.forEach((x) => {
    ae += Math.abs(x.e - x.a); w += Math.abs(x.a);
    const tol = Math.max(x.step, Math.abs(x.a) * 0.1);
    if (Math.abs(x.e - x.a) <= tol + 1e-9) hit++;
    if (x.e > x.a + 0.5 * x.step + 1e-9) risk++;
    if (x.e < x.a - 0.5 * x.step - 1e-9) over++;
    if (x.unk) unk++;
  });
  return `${rows.length}건 · 적중 ${pct(hit / rows.length)} · WAPE ${pct(w ? ae / w : null)} · 덜시킬 ${risk} · 더시킬 ${over} · 입고모름 ${unk}`;
};
const fcLine = (rows, label) => {
  const ev = rows.filter((r) => r.ev), ne = rows.filter((r) => !r.ev);
  const by = (src) => rows.filter((r) => r.src === src);
  console.log(`${label} 전체 ${rows.length}일 MAPE ${pct(mape(rows, (r) => r.pred))} 편향 ${pct(bias(rows, (r) => r.pred))} | 행사 ${ev.length}일 MAPE ${pct(mape(ev, (r) => r.pred))} 편향 ${pct(bias(ev, (r) => r.pred))} | 행사 없음 ${ne.length}일 MAPE ${pct(mape(ne, (r) => r.pred))}`);
  ["fc", "est"].forEach((src) => { const a = by(src), e = a.filter((r) => r.ev); if (a.length) console.log(`    ${src} ${a.length}일 MAPE ${pct(mape(a, (r) => r.pred))} 편향 ${pct(bias(a, (r) => r.pred))} | 행사 ${e.length}일 MAPE ${pct(mape(e, (r) => r.pred))} 편향 ${pct(bias(e, (r) => r.pred))}`); });
};

const old = await snap(OLD), neu = await snap(NEW);
console.log(`오늘 ${neu.today} · 화면 오류 예전 ${old.errs.length} 새 ${neu.errs.length}`);
if (neu.errs.length) console.log(neu.errs.slice(0, 5).join("\n"));
const span = (rows) => rows.length ? `${rows[0].d}~${rows[rows.length - 1].d}` : "없음";
console.log(`매출 예상 구간 ${span(neu.days)} (실제 Gross가 있는 지난날, dayGross)`);
fcLine(old.days, "예전");
fcLine(neu.days, "새  ");
const both = new Map();
neu.days.forEach((r) => { const o = old.days.find((x) => x.d === r.d); if (o && o.pred > 0) both.set(r.d, { ...r, old: o.pred }); });
const paired = [...both.values()];
console.log(`같은 날 비교 ${paired.length}일 · 예전 MAPE ${pct(mape(paired, (r) => r.old))} → 새 MAPE ${pct(mape(paired, (r) => r.pred))} · 행사 ${paired.filter((r) => r.ev).length}일 ${pct(mape(paired.filter((r) => r.ev), (r) => r.old))} → ${pct(mape(paired.filter((r) => r.ev), (r) => r.pred))}`);
const delta = paired.map((r) => ({ ...r, dlt: Math.abs(r.act / r.pred - 1) - Math.abs(r.act / r.old - 1) }));
const show = (xs, title) => console.log(title + "\n" + xs.slice(0, 8).map((r) => `${r.d} ${r.ev ? "행사" : "평일"} ${r.src} ${(Math.abs(r.act / r.old - 1) * 100).toFixed(0)}→${(Math.abs(r.act / r.pred - 1) * 100).toFixed(0)} ×${(r.pred / r.old).toFixed(3)}`).join("\n"));
show(delta.filter((r) => r.dlt > 0.015).sort((a, b) => b.dlt - a.dlt), "오차 커진 날");
show(delta.filter((r) => r.dlt < -0.015).sort((a, b) => a.dlt - b.dlt), "오차 줄어든 날");
console.log("예상 재고 10/20~26 (anchor, 센 값이 있는 날)");
console.log("  예전 " + met(old.stock));
console.log("  새   " + met(neu.stock));
console.log("  행사일 예전 " + met(old.stock.filter((x) => x.ev)));
console.log("  행사일 새   " + met(neu.stock.filter((x) => x.ev)));
console.log(`화면 오차칩 ${neu.ui.chips} · 입고확인 칩 ${neu.ui.gapChips} · 입고확인 글 ${neu.ui.gapNotes} · Forecast 사유 줄 ${neu.fcNotes}`);
if (neu.prove) console.log(`관람인원 넣으면 배수 ${neu.prove.uplift == null ? "–" : neu.prove.uplift.toFixed(3)} (${neu.prove.day}) · 기본 배수 ${neu.prove.def} · 입고기록 지우면 모름 ${neu.prove.gapOn}`);
if (neu.errs.length) process.exit(1);
