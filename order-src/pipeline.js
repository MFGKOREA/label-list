// 발주 계산의 한 줄기. 화면은 이 결과만 읽고, 같은 식을 다시 적지 않습니다.
// 브라우저에서는 order.html이 이 파일을 app.js보다 먼저 넣고, 시험에서는 node가 그대로 읽습니다.
const OrderPipe = (() => {
  "use strict";
  const Z = 1.65;

  // 시작 + 입고 − 사용 − 로스 = 기말 − 미충족. 기말은 0 이상, 못 판 양은 미충족으로 남깁니다.
  function massBalance(start, inn, use, loss) {
    const s0 = +start || 0, rec = +inn || 0, u = +use || 0, l = +loss || 0;
    const raw = s0 + rec - u - l;
    const end = raw > 0 ? raw : 0;
    const unmet = raw < 0 ? -raw : 0;
    return { start: s0, inn: rec, use: u, loss: l, end, unmet, raw, ok: unmet <= 1e-9 };
  }

  // 분산의 역수로 한 값. 추정은 { v, variance }. 결측은 빠집니다.
  function reconcile(parts, opt) {
    opt = opt || {};
    const rows = (parts || []).filter((p) => p && p.v != null && isFinite(+p.v));
    if (!rows.length) return { use: null, weights: [], conflict: false, spread: null };
    if (rows.length === 1) return { use: +rows[0].v, weights: [1], conflict: false, spread: null, wA: rows[0].name === "B" ? 0 : 1 };
    const inv = rows.map((p) => 1 / Math.max(+p.variance || 0, 1e-4));
    const sum = inv.reduce((a, b) => a + b, 0);
    let weights = inv.map((x) => x / sum);
    const lo = opt.lo != null ? opt.lo : 0, hi = opt.hi != null ? opt.hi : 1;
    if (rows.length === 2 && (lo > 0 || hi < 1)) {
      weights = [Math.min(hi, Math.max(lo, weights[0])), 0];
      weights[1] = 1 - weights[0];
    }
    if (opt.maxW0 != null) {
      weights[0] = Math.min(weights[0], opt.maxW0);
      const rest = 1 - weights[0];
      const tail = weights.slice(1).reduce((a, b) => a + b, 0) || 1;
      for (let i = 1; i < weights.length; i++) weights[i] = rest * weights[i] / tail;
    }
    const use = rows.reduce((a, p, i) => a + weights[i] * +p.v, 0);
    const hiV = Math.max(...rows.map((p) => +p.v)), loV = Math.min(...rows.map((p) => +p.v));
    const spread = hiV > 0 ? (hiV - loV) / hiV : 0;
    const tol = opt.tol != null ? opt.tol : 0.5;
    return { use, weights, spread, conflict: spread > tol, wA: weights[0] };
  }

  // A(수불)와 B(레시피). 분산은 오차제곱. 신메뉴 몫이 크면 A 비중 상한을 낮춥니다.
  function reconcileAB(useA, useB, varA, varB, opt) {
    opt = opt || {};
    if (opt.recipeOnly && useB != null) return { use: useB, wA: 0, spread: null, conflict: false };
    if (useA == null && useB == null) return { use: null, wA: 0, spread: null, conflict: false };
    if (useA == null || useB == null) {
      const use = useA != null ? useA : useB;
      return { use, wA: useA != null ? 1 : 0, spread: null, conflict: false };
    }
    const both = varA != null && varB != null && varA + varB > 0;
    const rec = reconcile(
      [{ name: "A", v: useA, variance: both ? varA : 1 }, { name: "B", v: useB, variance: both ? varB : 1 }],
      { lo: both ? 0.15 : 0.5, hi: both ? 0.85 : 0.5, maxW0: opt.newShare > 0.3 ? 1 - opt.newShare : null, tol: 0.5 }
    );
    return { use: rec.use, wA: rec.wA, spread: Math.abs(useA - useB) / Math.max(useA, useB), conflict: Math.abs(useA - useB) / Math.max(useA, useB) > 0.5 };
  }

  function safetyStock(useAvg, sigma, nEff, fcRel, batchVar, wkPlus) {
    const nd = Math.max(1, +nEff || 1);
    const sig = +sigma || 0, fc = +fcRel || 0, bv = +batchVar || 0;
    const rel = Math.sqrt(sig * sig / nd + fc * fc);
    const relSS = Math.sqrt(Math.max(sig, 0.3) ** 2 / nd + fc * fc);
    const core = Math.sqrt((relSS * useAvg) ** 2 + bv);
    const ss = Z * core + (+wkPlus || 0);
    return { ss, rel, relSS, z: Z };
  }

  function roundOrder(short, floorUse, mult, minQty) {
    const m = mult > 1 ? mult : 1;
    let packs = short <= 0 ? 0 : m > 1 ? Math.max(Math.round(short / m), Math.ceil(floorUse / m - 1e-9), 0) : Math.ceil(short - 1e-9);
    if (packs > 0 && minQty && packs < minQty) packs = minQty;
    return { packs, covered: packs * m + 1e-6 >= Math.max(0, short) - (m > 1 ? m / 2 : 0) };
  }

  // 날짜순 재고. 각 날은 수지식. addDays는 다음 날 아침 입고를 찾기 위한 함수.
  function projectSeq(e, per, addDays) {
    const by = {};
    (e.arrs || []).forEach((a) => { by[a.d] = (by[a.d] || 0) + a.q; });
    let st = e.s0 + (by[e.x] || 0);
    let unmet = 0;
    const steps = [];
    (per || []).forEach((u, i) => {
      const day = e.days[i];
      const innNext = by[addDays(day.d, 1)] || 0;
      const bal = massBalance(st, 0, u, 0);
      const ident = Math.abs(bal.start + bal.inn - bal.use - bal.loss - (bal.end - bal.unmet)) <= 1e-6;
      st = bal.end + innNext;
      unmet += bal.unmet;
      steps.push({ ...bal, innNext, ident, d: day.d });
    });
    return { end: st, unmet, steps, ok: steps.every((s) => s.ident) };
  }

  // 한 품목의 결과. 화면이 나눠 계산하지 않고 이 객체를 읽습니다.
  function run(inp) {
    const ab = reconcileAB(inp.useA, inp.useB, inp.varA, inp.varB, inp);
    let use = ab.use;
    if (use == null) return { none: true, flags: [] };
    use *= inp.factor || 1;
    const useAvg = use;
    if (inp.batchDelta) use = Math.max(0, use + inp.batchDelta);
    const ss = safetyStock(useAvg, inp.sigma, inp.nEff, inp.fcRel, inp.batchVar, inp.wkPlus);
    let need = use + ss.ss;
    if (inp.shelf) need = Math.min(need, (useAvg / Math.max(1, inp.days)) * inp.shelf);
    if (inp.lump) need = Math.max(need, inp.lump);
    const stock = +inp.stock || 0, incoming = +inp.incoming || 0;
    const bal = massBalance(stock, incoming, use, inp.lossQty || 0);
    const rnd = roundOrder(need - stock - incoming, use - stock - incoming, inp.mult || 1, inp.minQty || 0);
    const flags = [];
    if (ab.conflict) flags.push({ k: "불일치", t: "A·B 차이가 큼" });
    if (bal.unmet > Math.max(0.5, 0.1 * Math.abs(use))) flags.push({ k: "수지", t: "시작+입고가 사용보다 작음" });
    const atDelivery = inp.stockAtDelivery;
    if (atDelivery != null && Math.abs(atDelivery - (stock + incoming - use)) > Math.max(1, 0.1 * Math.abs(stock + incoming))) flags.push({ k: "기간", t: "입고일 예상 재고가 발주 가정과 다름" });
    return { none: false, use, useAvg, wA: ab.wA, spread: ab.spread, ss: ss.ss, sd: useAvg * ss.rel, need, balance: bal, order: rnd, flags, ab };
  }

  return { Z, massBalance, reconcile, reconcileAB, safetyStock, roundOrder, projectSeq, run };
})();
if (typeof module !== "undefined" && module.exports) module.exports = OrderPipe;
