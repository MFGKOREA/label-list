// KM 발주 습관 되돌려 보기(habit.py)용: 품목 정보(단위·박스·품목코드)와 날마다 발주 가능한지(orderWindowFor)를 앱 계산 그대로 뽑음
// 사용: node order-src/test/bt/habit-items.mjs <kv.json> <items.json>   (kv.json·items.json은 매장 자료라 저장소에 넣지 않음)
import fs from "fs";
import { openApp } from "./asof.mjs";
const [kvPath, out] = process.argv.slice(2);
if (!kvPath || !out) { console.log("사용: node habit-items.mjs <kv.json> <items.json>"); process.exit(2); }
const last = JSON.parse(fs.readFileSync(kvPath, "utf8")), D = last.data || last;
const asOf = Object.keys(D).filter((k) => /^input\.\d{4}-\d\d-\d\d$/.test(k)).map((k) => k.slice(6)).sort().pop();
const { page, close, errs } = await openApp({ kvPath, asOf, hour: 23, today: "all" });
const r = await page.evaluate(() => {
  const C = window.__orderCalc, M = C.model(), db = C.db();
  const days = Object.keys(db).filter((k) => k.startsWith("input.") || k.startsWith("misOrder.")).map((k) => k.replace(/^(input|misOrder)\./, "")).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d));
  const uniq = [...new Set(days)].sort();
  return M.items.filter((i) => !i.ledgerOnly).map((it) => ({ key: it.key, name: it.name, vendor: it.vendor || "", mult: C.ordToStock(it, 1), box: it.box || 0, isNew: !!it.isNew, codes: (it.codes || []).map(String), can: Object.fromEntries(uniq.map((d) => { let c = null; try { c = C.orderWindowFor(it, d).canOrder; } catch (e) {} return [d, c]; })) }));
});
fs.writeFileSync(out, JSON.stringify(r)); console.log(`품목 ${r.length}개 · 앱 오류 ${errs.length}`);
await close();
