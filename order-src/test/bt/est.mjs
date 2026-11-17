// 예상 재고 되돌려 보기: 두 앱(예전 html · 새 html)을 센 날마다 "그날을 오늘로" 열어 estStock(그날) vs 그날 센 값을 비교. 시트에 안 씀
// 사용: node order-src/test/bt/est.mjs <kv.json> <예전.html> [새.html=order.html] [시작일=2026-10-21]
//   예전.html은 git show <커밋>:order.html > /tmp/old.html 로 만듦. kv.json은 시트 사본(매장 자료라 저장소에 안 넣음)
// 지표: 평균 오차(재고 단위) · 반 단위 안(통 단위 품목은 반 통) · 덜 시킬 위험(예상이 실제보다 반 단위 넘게 많음 → 발주를 덜 함) · 더 시킬 쪽(반대)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openApp } from "./asof.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [KV, OLD, NEW = path.resolve(HERE, "../../../order.html"), FROM = "2026-10-21"] = process.argv.slice(2);
if (!KV || !OLD) { console.log("사용: node order-src/test/bt/est.mjs <kv.json> <예전.html> [새.html] [시작일]"); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(KV, "utf8")); const data = raw.data || raw;
const days = Object.keys(data).filter((k) => /^input\.\d{4}-\d\d-\d\d$/.test(k) && k.slice(6) >= FROM)
  .map((k) => k.slice(6)).filter((d) => Object.values(data["input." + d] || {}).filter((v) => v && !v.est && v.s !== "" && v.s != null).length >= 10).sort();
const STEAK = /등심|부채살|안심|채끝|우대갈비|폭립|핑거립/;
const one = async (html, d) => {
  const { page, close, errs } = await openApp({ kvPath: KV, html, asOf: d, hour: 11 });
  const r = await page.evaluate((d) => { const C = window.__orderCalc, M = C.model(), db = C.db(), out = {};
    M.items.forEach((it) => { if (it.ledgerOnly) return; const v = (db["input." + d] || {})[it.key]; if (!C.counted(v)) return; const e = C.estStock(it, d); if (!e) return;
      out[it.key] = { e: e.v, a: C.stockOf(it, v), w: e.menuW || 0, step: (C.wholeStep && C.wholeStep(it)) || it.box || 1 }; });
    return out; }, d);
  await close(); return { r, errs: errs.length };
};
const rows = []; let errN = 0;
for (const d of days) {
  const o = await one(OLD, d), n = await one(NEW, d); errN += o.errs + n.errs;
  Object.keys(n.r).forEach((k) => { if (o.r[k]) rows.push({ d, key: k, old: o.r[k].e, neu: n.r[k].e, a: n.r[k].a, w: n.r[k].w, step: n.r[k].step }); });
}
const met = (l, f) => { let ae = 0, hit = 0, risk = 0, over = 0; l.forEach((x) => { const e = x[f], t = 0.5 * x.step; ae += Math.abs(e - x.a); if (Math.abs(e - x.a) <= t + 1e-9) hit++; if (e > x.a + t + 1e-9) risk++; if (e < x.a - t - 1e-9) over++; });
  return `평균 오차 ${(ae / l.length).toFixed(3)} · 반 단위 안 ${(hit / l.length * 100).toFixed(1)}% · 덜 시킬 위험 ${risk} · 더 시킬 쪽 ${over}`; };
console.log(`센 날 ${days.length}일 (${days[0]}~${days[days.length - 1]}) · 비교 ${rows.length}건 · 화면 오류 ${errN}`);
for (const [t, l] of [["전체", rows], ["스테이크·폭립", rows.filter((x) => STEAK.test(x.key))], ["메뉴 역산이 섞인 것", rows.filter((x) => x.w > 0)]]) {
  if (!l.length) continue; console.log(`[${t}] ${l.length}건\n  예전: ${met(l, "old")}\n  새  : ${met(l, "neu")}`);
}
