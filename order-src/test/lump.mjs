// 한 번에 쓰는 양(useStep) 시험 (11/16 KM "대두유가 0.1씩 사용하는 품목이 아니야, 프라이어에 1.5통씩 들어가서"):
//  설정한 품목은 86 부족량·발주 필요량이 한 번 양(1.5) 단위, 시각 대신 "기름 교체 때". 설정 없는 품목은 예전 그대로
// 사용: node order-src/test/lump.mjs <kv.json> [날짜 2026-11-16] [품목 대두유]   (kv.json은 매장 자료라 저장소에 넣지 않음)
import { openApp } from "./bt/asof.mjs";
const [kvPath, day = "2026-11-16", name = "대두유"] = process.argv.slice(2);
if (!kvPath) { console.log("사용: node order-src/test/lump.mjs <kv.json> [날짜] [품목]"); process.exit(2); }
let fail = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fail++; };
const look = async (cfg) => {
  const { page, close, errs } = await openApp({ kvPath, asOf: day, hour: 10, today: "all", mutate: (d) => { d.itemCfg = d.itemCfg || {}; const c = { ...(d.itemCfg[name] || {}) }; delete c.useStep; delete c.useName; d.itemCfg[name] = cfg ? { ...c, ...cfg } : c; return d; } });
  const r = await page.evaluate((name) => { const C = window.__orderCalc, M = C.model(), db = C.db(), T = C.TODAY, it = M.items.find((i) => i.name === name), v = (db["input." + T] || {})[it.key];
    const e = C.estStock(it, T), w = C.orderWindowFor(it, T), c = C.calc(it, w, C.counted && C.counted(v) ? C.stockOf(it, v) : e ? e.raw : 0, C.incomingOf(it, T) || 0), k = C.risk1(it, v);
    return { useStep: it.useStep, use: c.use, need: c.need, risk: k && { when: k.when, have: k.have, use: k.use, shortS: k.shortS } }; }, name);
  await close(); return { ...r, errs: errs.length };
};
const a = await look(null), b = await look({ useStep: 1.5, useName: "기름 교체" });
ok(a.useStep === 0 && b.useStep === 1.5, `설정: 없음 ${a.useStep} · 있음 ${b.useStep}`);
ok(b.use <= 1e-9 || b.need + 1e-9 >= Math.ceil(b.use / 1.5 - 1e-9) * 1.5, `발주 필요량 ${b.need.toFixed(2)} ≥ 쓸 횟수(올림) × 1.5 (쓸 양 ${b.use.toFixed(2)})`);
if (b.risk) ok(b.risk.when === "기름 교체 때" && Math.abs((b.risk.use - b.risk.have) - (Math.ceil(b.risk.use / 1.5 - 1e-9) * 1.5 - b.risk.have)) < 1e-9 && b.risk.use % 1.5 < 1e-9, `86: "${b.risk.when}" · 가진 ${b.risk.have.toFixed(2)} · 있어야 할 ${b.risk.use} (1.5 단위)`);
else ok(true, "86: 없음(가진 양이 쓸 횟수 × 1.5 이상)");
if (b.risk) ok(Number.isInteger(b.risk.shortS) && b.risk.shortS >= b.risk.use - b.risk.have - 1e-9 && b.risk.shortS < b.risk.use - b.risk.have + 1, `86 부족은 1통 단위: ${b.risk.shortS} (모자란 양 ${(b.risk.use - b.risk.have).toFixed(2)}, KM "발주는 1통 단위야")`);
if (a.risk) ok(!/교체/.test(a.risk.when), `설정 없으면 예전처럼 시각("${a.risk.when}")`);
ok(a.errs + b.errs === 0, "앱 오류 없음");
console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0);
