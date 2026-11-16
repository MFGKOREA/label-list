// 예상 재고 날짜순 시험 (11/16 KM "일요일 품절 위험이었다가 월요일 입고면 최소 예상재고 + 월요일 입고량은 들어가야"):
//  입고가 들어오는 날 아침의 예상 재고는 그날 입고량보다 작을 수 없음(그 전에 바닥났어도 입고는 그대로 남음). 모든 품목을 그날로 열어 확인
// 사용: node order-src/test/estfloor.mjs <kv.json> [날짜 2026-11-16]   (kv.json은 매장 자료라 저장소에 넣지 않음)
import { openApp } from "./bt/asof.mjs";
const [kvPath, day = "2026-11-16"] = process.argv.slice(2);
if (!kvPath) { console.log("사용: node order-src/test/estfloor.mjs <kv.json> [날짜]"); process.exit(2); }
const { page, close, errs } = await openApp({ kvPath, asOf: day, hour: 9, today: "none" });
const r = await page.evaluate((day) => {
  const C = window.__orderCalc, M = C.model(), add = (s, n) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let n = 0, withArr = 0, bad = [], floored = 0;
  for (const it of M.items.filter((i) => !i.ledgerOnly)) {
    const e = C.estStock(it, day); if (!e) continue; n++;
    let q = 0; for (let j = 0; j <= 21; j++) (C.arrivalsOf(it, add(day, -j)) || []).forEach((a) => { if (a.d === day) q += a.q; });
    if (q > 0) { withArr++; if (e.raw + 1e-9 < q) bad.push(`${it.name} 예상 ${e.raw.toFixed(2)} < 입고 ${q}`); }
    const w = C.estWin(it, e.from, day); if (w && w.base - w.use < e.raw - 1e-9) floored++; // 예전 식(한 번에 빼기)보다 많아진 품목 = 중간에 바닥났던 품목
  }
  return { n, withArr, bad, floored };
}, day);
await close();
let fail = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fail++; };
ok(r.n > 50, `예상 재고를 낸 품목 ${r.n}개 (${day})`);
ok(r.bad.length === 0, `그날 입고가 있는 ${r.withArr}개 모두 예상 재고 ≥ 그날 입고량${r.bad.length ? " — " + r.bad.slice(0, 3).join(" / ") : ""}`);
console.log(`   중간에 바닥나서 예전 식보다 예상이 커진 품목 ${r.floored}개`);
ok(errs.length === 0, "앱 오류 " + (errs.length ? errs[0] : "없음"));
console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0);
