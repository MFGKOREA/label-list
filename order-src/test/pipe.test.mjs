// 한 줄기 계산의 수지·성질 시험. 시트에 안 씀.
// 사용: node order-src/test/pipe.test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const P = require("../pipeline.js");
let pass = 0, fail = 0;
const bad = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; bad.push(n + (d ? " · " + d : "")); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const b = P.massBalance(10, 4, 6, 1);
ok("수지 항등식", near(b.start + b.inn - b.use - b.loss, b.end - b.unmet));
ok("기말 0 이상", b.end >= 0 && b.unmet >= 0 && b.ok);
const short = P.massBalance(2, 1, 8, 0);
ok("부족하면 기말 0, 미충족이 차이", short.end === 0 && near(short.unmet, 5) && near(short.start + short.inn - short.use - short.loss, short.end - short.unmet));

let prev = Infinity;
for (const u of [0, 1, 3, 9, 20]) {
  const end = P.massBalance(10, 2, u, 0).end;
  ok("수요가 늘면 기말은 안 늘어남 " + u, end <= prev + 1e-9);
  prev = end;
}
const inp = { useA: 4, useB: 8, varA: 0.01, varB: 0.04, newShare: 0, sigma: 0.1, nEff: 2, fcRel: 0, stock: 1, incoming: 0, days: 2, mult: 1 };
const once = P.run(inp), twice = P.run(inp);
ok("같은 입력이면 같은 결과", JSON.stringify(once) === JSON.stringify(twice));
ok("A 비중 0.8", near(once.wA, 0.8), String(once.wA));
const ss = 1.65 * 4.8 * 0.3 / Math.sqrt(2);
ok("안전재고", near(once.ss, ss, 1e-6), String(once.ss));
ok("발주량 음수 아님", once.order.packs >= 0);
const more = P.run({ ...inp, useA: 8, useB: 12 });
ok("수요가 늘면 사용량이 안 줄어듦", more.use >= once.use);
ok("수요가 늘면 발주 묶음이 안 줄어듦", more.order.packs >= once.order.packs);
ok("바닥이 아니면 미충족 0", near(P.massBalance(10, 2, 3, 1).end, 8) && P.massBalance(10, 2, 3, 1).unmet === 0);
ok("발주가 리드타임+안전재고를 덮음", once.order.covered === true);

const seq = P.projectSeq({
  x: "2026-11-20", s0: 5,
  days: [{ d: "2026-11-20", w: 10 }, { d: "2026-11-21", w: 10 }],
  arrs: [{ d: "2026-11-22", q: 8 }],
}, [15, 15], (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); });
ok("날짜순 수지가 성립", seq.ok && near(seq.end, 8), String(seq.end));
ok("바닥에서 입고를 깎지 않음", seq.unmet > 0 && seq.steps.every((s) => s.end >= 0));

const ab = P.reconcile([{ v: 4, variance: 0.01 }, { v: 8, variance: 0.04 }], { lo: 0.15, hi: 0.85 });
ok("두 추정의 비중 합 1", near(ab.weights[0] + ab.weights[1], 1) && near(ab.use, 4.8));
ok("차이가 크면 불일치", P.reconcileAB(10, 1, 0.01, 0.01, {}).conflict === true);
ok("한 추정만 있으면 그 값", P.reconcileAB(null, 3, null, null, {}).use === 3);

console.log(`파이프 시험 통과 ${pass} · 실패 ${fail}`);
if (bad.length) console.log(bad.join("\n"));
process.exit(fail ? 1 : 0);
