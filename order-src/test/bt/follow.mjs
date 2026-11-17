// "앱 추천대로만 시켰다면?" 되돌려 보기 (11/17 KM "내가 너를 믿고 발주하면 안정성이 몇 퍼센트야"). 시트에 안 씀
//  발주일 d마다 앱을 그날 아침(재고만 넣은 상태)으로 열어 추천 발주량을 받고, 그날 실제로 시킨 양과 바꿔 끼움.
//  다음 입고 직전(기간 끝 E = 다음 발주분이 오는 날) 재고 = 실제 E 재고 + (추천 − 실제 발주). 0 아래면 "바닥남".
//  E 재고는 E에 센 값. 세는 시각이 입고 전인지 뒤인지 몰라 두 경우를 다 셈: 뒤(E 입고분을 빼 봄 = 엄하게) · 전(그대로 = 느슨하게)
// 사용: node order-src/test/bt/follow.mjs <kv.json> [시작=2026-10-21] [끝=2026-11-14]
import fs from "fs";
import { openApp } from "./asof.mjs";
const [KV, FROM = "2026-10-21", TO = "2026-11-14"] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(KV, "utf8")), D = raw.data || raw;
const add = (s, n) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// 1) 전체 자료로 연 앱: 품목 정보 · 날짜별 실제 입고(arrivalsOf) · 실제 발주(재고 단위)
const full = await openApp({ kvPath: KV });
const info = await full.page.evaluate(([FROM, TO]) => {
  const C = window.__orderCalc, M = C.model(), db = C.db(), add = (s, n) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const out = {};
  M.items.filter((i) => !i.ledgerOnly).forEach((it) => {
    const arr = {}, ord = {};
    for (let x = add(FROM, -8); x <= add(TO, 12); x = add(x, 1)) {
      C.arrivalsOf(it, x).forEach((a) => { arr[a.d] = (arr[a.d] || 0) + a.q; });
      const r = (db["input." + x] || {})[it.key], o = r && C.num(r.o) > 0 ? C.ordToStock(it, C.num(r.o)) : 0;
      // 실제 발주: 앱 칸 → 없으면 MIS 주문현황(arrivalsOrd의 mis 줄)
      ord[x] = o > 0 ? o : C.arrivalsOrd(it, x).filter((a) => a.mis).reduce((t, a) => t + a.q, 0);
    }
    out[it.key] = { name: it.name, vendor: it.vendor || "", box: it.box || 1, unit: it.box ? "BOX" : (it.pk && it.pk.stock) || it.unit || "", arr, ord, meat: !!C.isMeat(it) };
  });
  return out;
}, [FROM, TO]);
await full.close();
const cnt = (key, d) => { const v = (D["input." + d] || {})[key]; return v && v.s !== "" && v.s != null && isFinite(+v.s) ? +v.s * (info[key] ? info[key].box : 1) : null; };
// 2) 발주일마다
const rows = [];
for (let d = FROM; d <= TO; d = add(d, 1)) {
  if (new Date(d + "T00:00:00Z").getUTCDay() === 0) continue; // 일요일은 발주 없음
  const app = await openApp({ kvPath: KV, asOf: d, hour: 11 });
  const recs = await app.page.evaluate(() => {
    const C = window.__orderCalc, M = C.model(), T = C.TODAY, inp = C.db()["input." + T] || {};
    return M.items.filter((i) => !i.ledgerOnly).map((it) => { const v = inp[it.key]; if (!C.counted(v)) return null; const w = C.orderWindowFor(it, T); if (!w || !w.canOrder) return null;
      const c = C.calc(it, w, C.availOf(it, v), C.incomingOf(it, T)); if (c.none) return null;
      return { key: it.key, q: C.ordToStock(it, c.orderQty || 0), use: c.use, ss: c.ss, deliv: w.deliv, end: w.end, days: w.days }; }).filter(Boolean);
  });
  await app.close();
  for (const r of recs) {
    const I = info[r.key]; if (!I) continue;
    let E = r.end, sE = cnt(r.key, E);
    if (sE == null) continue; // 끝날에 센 값이 없으면 판단 못 함
    const actQ = I.ord[d] || 0, diff = r.q - actQ;
    const arrE = I.arr[E] || 0;
    const loose = sE + diff, strict = sE - arrE + diff; // 전: 센 값이 입고 전 / 뒤: 센 값에 그날 입고가 들어 있음
    const daily = r.use / Math.max(1, r.days);
    rows.push({ d, key: r.key, name: I.name, vendor: I.vendor, unit: I.unit, rec: r.q, act: actQ, E, sE, arrE, loose, strict, daily, actStrict: sE - arrE });
  }
  process.stderr.write(`${d} ${recs.length}개\n`);
}
fs.writeFileSync(process.env.OUT || "/tmp/follow.json", JSON.stringify(rows));
const pc = (n, t) => (t ? ((100 * n) / t).toFixed(1) + "%" : "-");
const N = rows.length, bad = (k) => rows.filter((r) => r[k] < -1e-9);
const ordered = rows.filter((r) => r.rec > 0 || r.act > 0);
console.log(`판단한 경우: ${N}건 (발주일 × 그날 센 품목, 끝날에도 센 값 있는 것) · 발주일 ${new Set(rows.map((r) => r.d)).size}일 · 품목 ${new Set(rows.map((r) => r.key)).size}개`);
console.log(`앱대로: 바닥 안 남 ${pc(N - bad("loose").length, N)}(느슨) ~ ${pc(N - bad("strict").length, N)}(엄하게)`);
const actBad = rows.filter((r) => r.actStrict < -1e-9 || r.sE <= 0).length;
console.log(`실제(KM 발주): 끝날 재고 0 이하 ${pc(rows.filter((r) => r.sE <= 0).length, N)}`);
const lack = rows.filter((r) => r.rec < r.act), more = rows.filter((r) => r.rec > r.act), same = rows.filter((r) => r.rec === r.act);
console.log(`앱 추천 vs 실제 발주: 같음 ${pc(same.length, N)} · 앱이 적게 ${pc(lack.length, N)} · 앱이 많게 ${pc(more.length, N)}`);
const over = rows.filter((r) => r.daily > 0 && r.loose / r.daily > 7);
console.log(`앱대로 남는 양이 7일치 넘음: ${pc(over.length, N)}`);
const worst = bad("strict").sort((a, b) => a.strict / Math.max(a.daily, 1e-9) - b.strict / Math.max(b.daily, 1e-9)).slice(0, 25);
console.log("바닥(엄하게) 경우:"); worst.forEach((r) => console.log(`  ${r.d} ${r.name} · 앱 ${+r.rec.toFixed(1)} / 실제 ${+r.act.toFixed(1)} · ${r.E} 센 값 ${r.sE}(그날 입고 ${+r.arrE.toFixed(1)}) → 앱대로 ${+r.strict.toFixed(1)} ~ ${+r.loose.toFixed(1)} ${r.unit}`));
