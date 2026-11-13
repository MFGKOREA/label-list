// 두 앱(지금 배포본 vs 고친 것)을 같은 시트 사본으로 열어 "같은 채점 구간"끼리 오차를 비교 (계산 규칙을 바꿀 때 AGENT.md 6번 확인용)
// 사용: node order-src/test/bt/compare.mjs <kv.json> <기준.html> <고친.html> [--split 2026-11-01]
//   기준.html 만들기: git show HEAD:order.html > /tmp/base.html
//   --split D: 시간 분리 시험. D가 든 달의 월 자료와 D 이후 날짜별 메뉴를 지우고(그 전 자료로만 배움) D 이후 구간만 채점 → 미래 누수 없이 비교
// 지표: 적중(|예상−실제| ≤ max(1단위, 끝 재고 10%)) · WAPE(Σ|오차|÷Σ끝 재고) · 사용 오차(Σ|오차|÷Σ실제) · 치우침(Σ(예상−실제)÷Σ실제, −면 적게 예상) · 크게 모자람(실제가 예상보다 허용치 넘게 많음 = 품절 쪽)
// kv.json은 매장 자료라 저장소에 넣지 않음
import { openApp } from "./asof.mjs";
const [KV, BASE, NEW] = process.argv.slice(2), si = process.argv.indexOf("--split"), SPLIT = si > 0 ? process.argv[si + 1] : null;
if (!KV || !BASE || !NEW) { console.log("사용: node order-src/test/bt/compare.mjs <kv.json> <기준.html> <고친.html> [--split YYYY-MM-DD]"); process.exit(1); }
const cut = (d) => { if (!SPLIT) return d; d = JSON.parse(JSON.stringify(d)); delete d["month." + SPLIT.slice(0, 7)]; Object.keys(d).forEach((k) => { if (/^menuDay(Part)?\.\d{4}-\d\d-\d\d$/.test(k) && k.slice(-10) >= SPLIT) delete d[k]; }); return d; };
const scores = async (html) => { const { page, close, errs } = await openApp({ kvPath: KV, html, mutate: cut });
  const sc = await page.evaluate(() => (window.__orderCalc.model().scores || []).filter((s) => !s.src && s.pF != null).map((x) => ({ id: x.key + "|" + x.start + "|" + x.end, n: x.name, s: x.start, p: x.pF, a: x.actual, e: Math.abs(x.e || 0), u: x.u || 1 })));
  await close(); if (errs.length) console.log("화면 오류", errs.length, errs[0]); return new Map(sc.map((x) => [x.id, x])); };
const A = await scores(BASE), B = await scores(NEW);
const ids = [...A.keys()].filter((k) => B.has(k) && (!SPLIT || A.get(k).s >= SPLIT));
const met = (M) => { const z = ids.map((k) => M.get(k)); const tol = (x) => Math.max(x.u, 0.1 * x.e), sa = z.reduce((t, x) => t + x.a, 0) || 1, se = z.reduce((t, x) => t + x.e, 0) || 1, ae = z.reduce((t, x) => t + Math.abs(x.p - x.a), 0);
  const pc = (v) => (v * 100).toFixed(1) + "%";
  return `적중 ${pc(z.filter((x) => Math.abs(x.p - x.a) <= tol(x)).length / z.length)} · WAPE ${pc(ae / se)} · 사용 오차 ${pc(ae / sa)} · 치우침 ${(z.reduce((t, x) => t + x.p - x.a, 0) / sa * 100).toFixed(1)}% · 크게 모자람 ${pc(z.filter((x) => x.a - x.p > tol(x)).length / z.length)}`; };
console.log(`같은 채점 구간 ${ids.length}개${SPLIT ? ` (${SPLIT} 이후, 그 전 자료로만 배움)` : ""}`);
console.log("  기준 :", met(A)); console.log("  고친 :", met(B));
const per = new Map(); ids.forEach((k) => { const a = A.get(k), b = B.get(k), o = per.get(a.n) || { e0: 0, e1: 0, s: 0 }; o.e0 += Math.abs(a.p - a.a); o.e1 += Math.abs(b.p - b.a); o.s += a.a; per.set(a.n, o); });
const rows = [...per].map(([n, o]) => ({ n, d: (o.e1 - o.e0) / (o.s || 1) })).sort((x, y) => x.d - y.d);
console.log("  가장 좋아진 품목:", rows.slice(0, 5).map((r) => `${r.n.slice(0, 12)} ${(r.d * 100).toFixed(0)}%p`).join(" · "));
console.log("  가장 나빠진 품목:", rows.slice(-5).reverse().filter((r) => r.d > 0).map((r) => `${r.n.slice(0, 12)} +${(r.d * 100).toFixed(0)}%p`).join(" · ") || "없음");
