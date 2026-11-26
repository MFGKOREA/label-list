// 품목별 치우침: 센 날마다 "그날을 오늘로" 연 앱의 예상 재고(estStock) − 실제 센 값. 음수가 계속이면 앱이 실제보다 많이 쓴다고 보는 것(= 많이 시킴). 시트에 안 씀
// 사용: node order-src/test/bt/bias.mjs <kv.json> [시작일] [html=order.html]
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url"; import { openApp } from "./asof.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [KV, FROM = "2026-11-17", HTML = path.resolve(HERE, "../../../order.html")] = process.argv.slice(2);
const data = (() => { const r = JSON.parse(fs.readFileSync(KV, "utf8")); return r.data || r; })();
const days = Object.keys(data).filter((k) => /^input\.\d{4}-\d\d-\d\d$/.test(k) && k.slice(6) >= FROM).map((k) => k.slice(6))
  .filter((d) => Object.values(data["input." + d] || {}).filter((v) => v && !v.est && v.s !== "" && v.s != null).length >= 10).sort();
const acc = {};
for (const d of days) {
  const { page, close } = await openApp({ kvPath: KV, html: HTML, asOf: d, hour: 11 });
  const r = await page.evaluate((d) => { const C = window.__orderCalc, M = C.model(), db = C.db(), out = {};
    M.items.forEach((it) => { if (it.ledgerOnly) return; const v = (db["input." + d] || {})[it.key]; if (!C.counted(v)) return; const e = C.estStock(it, d); if (!e || e.from == null && e.v == null) return;
      out[it.key] = { e: e.v, a: C.stockOf(it, v), step: (C.wholeStep && C.wholeStep(it)) || it.box || 1, unit: it.pk.stock }; }); return out; }, d);
  await close();
  Object.entries(r).forEach(([k, x]) => { (acc[k] = acc[k] || []).push({ d, ...x }); });
}
const rows = Object.entries(acc).map(([k, l]) => { const diff = l.map((x) => x.e - x.a); const m = diff.reduce((a, b) => a + b, 0) / l.length; const neg = diff.filter((x, i) => x < -0.5 * l[i].step).length;
  return { k, n: l.length, mean: m, neg, pos: diff.filter((x, i) => x > 0.5 * l[i].step).length, unit: l[0].unit }; }).filter((x) => x.n >= 3);
console.log(`센 날 ${days.length}일 ${days[0]}~${days[days.length - 1]} · 품목 ${rows.length}`);
console.log("앱이 실제보다 많이 쓴다고 본 품목 (예상 재고 < 실제, 평균 차이 순)");
rows.filter((x) => x.mean < 0).sort((a, b) => a.mean - b.mean).slice(0, 30).forEach((x) => console.log(`  ${x.k} · ${x.n}번 중 적게 ${x.neg} 많게 ${x.pos} · 평균 ${x.mean.toFixed(2)}${x.unit}`));
console.log("앱이 실제보다 적게 쓴다고 본 품목");
rows.filter((x) => x.mean > 0).sort((a, b) => b.mean - a.mean).slice(0, 15).forEach((x) => console.log(`  ${x.k} · ${x.n}번 중 적게 ${x.neg} 많게 ${x.pos} · 평균 +${x.mean.toFixed(2)}${x.unit}`));
const all = rows.reduce((a, x) => a + x.neg, 0), allp = rows.reduce((a, x) => a + x.pos, 0); console.log(`전체: 예상이 반 단위 넘게 적음 ${all} · 많음 ${allp}`);
