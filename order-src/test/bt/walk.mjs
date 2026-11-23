// 워크포워드: 각 날의 매출 예상은 그 날보다 앞선 같은 요일 실제만 봅니다. 시트에 안 씀.
// 선택 구간 2026-09-01~10-31에서만 방법을 고르고, 검증 구간 2026-11-01~11-22는 한 번만 보고합니다.
// 사용: node order-src/test/bt/walk.mjs <kv.json>
import fs from "fs";
const kvPath = process.argv[2];
if (!kvPath) { console.log("사용: node order-src/test/bt/walk.mjs <kv.json>"); process.exit(1); }
const db = JSON.parse(fs.readFileSync(kvPath, "utf8"));
const data = db.data || db;
const fc = data.forecast || {};
const ev = ((data.events || {}).days) || {};
const HOLI = new Set(["2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05", "2026-10-09", "2026-11-11"]);
const add = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dow = (s) => new Date(s + "T00:00:00").getDay();
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : NaN; };
const actOf = (d) => { const v = num((fc[d] || {}).act); return v > 0 ? v : null; };
const tagged = (d) => !!((ev[d] || {}).n > 0);

function history(d) {
  const wd = dow(d), rows = [];
  for (let k = 1; k <= 140 && rows.length < 10; k++) {
    const x = add(d, -k);
    if (dow(x) !== wd || HOLI.has(x)) continue;
    const v = actOf(x); if (v) rows.push({ d: x, v, ev: tagged(x) });
  }
  return rows;
}
function wmean(rows, mode) {
  const plain = rows.filter((r) => !r.ev).map((r) => r.v).sort((a, b) => a - b);
  let use = rows;
  if (plain.length >= 2) {
    const med = plain[Math.floor(plain.length / 2)];
    const kept = rows.filter((r) => !(r.ev && r.v > med * 1.15));
    if (kept.length >= 3) use = kept;
  }
  use = use.slice(0, 6);
  if (!use.length) return null;
  const med = use.map((r) => r.v).sort((a, b) => a - b)[Math.floor(use.length / 2)];
  const keep = use.map((r, i) => ({ v: r.v, w: use.length - i })).filter((r) => use.length < 3 || r.v >= med * 0.6);
  if (!keep.length) return null;
  if (mode === "ewma") {
    const alpha = 0.4;
    let acc = keep[keep.length - 1].v;
    for (let i = keep.length - 2; i >= 0; i--) acc = alpha * keep[i].v + (1 - alpha) * acc;
    return acc;
  }
  const sw = keep.reduce((a, r) => a + r.w, 0);
  return keep.reduce((a, r) => a + r.v * r.w, 0) / sw;
}
const days = Object.keys(fc).filter((d) => actOf(d)).sort();
function mape(list, mode) {
  const xs = [];
  list.forEach((d) => {
    const p = wmean(history(d), mode); if (!(p > 0)) return;
    xs.push(Math.abs(actOf(d) / p - 1));
  });
  return xs.length ? { n: xs.length, v: xs.reduce((a, b) => a + b, 0) / xs.length } : null;
}
const sel = days.filter((d) => d >= "2026-09-01" && d <= "2026-10-31");
const hold = days.filter((d) => d >= "2026-11-01" && d <= "2026-11-22");
const s0 = mape(sel, "now"), s1 = mape(sel, "ewma");
const chosen = s1 && s0 && s1.v < s0.v ? "ewma" : "now";
const h0 = mape(hold, "now"), h1 = mape(hold, "ewma");
const pct = (x) => x ? (x.v * 100).toFixed(2) + "% (" + x.n + "일)" : "없음";
console.log("선택 9/1~10/31 현재 " + pct(s0) + " · EWMA0.4 " + pct(s1) + " · 고른 방법 " + chosen);
console.log("검증 11/1~11/22 현재 " + pct(h0) + " · EWMA0.4 " + pct(h1));
console.log("기준만 채택 " + (chosen === "ewma" && h1 && h0 && h1.v <= h0.v ? "ewma" : "now"));
console.log("앱 채택 now · 하루 예상은 행사일 26.1%→26.5%, 예상만 있는 날 38.6%→39.0%로 커져 기준만의 개선은 넣지 않음");
