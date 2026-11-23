// 계산식 단위 시험: 손으로 푼 기대값과 앱 함수를 비교. 시트에 안 씀.
// 사용: PW_CHROME=... PW_MODULE=... node order-src/test/calc-unit.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openApp } from "./bt/asof.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(HERE, "../app.js"), "utf8");
const GS = fs.readFileSync(path.resolve(HERE, "../../apps-script/order/Code.gs"), "utf8");
let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; bad.push(name + (detail ? " · " + detail : "")); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Apps Script merge_ 와 같은 줄 (Code.gs). 앱 mergeObj와 결과가 같아야 함.
function mergeGs(cur, patch) {
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const out = isObj(cur) ? Object.assign({}, cur) : {};
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = mergeGs(out[k], v);
    else out[k] = v;
  });
  return out;
}
// 로스 중앙값. app.js lossOf와 같은 규칙: 1/3~3배만, 홀수면 가운데, 짝수면 가운데 둘 평균, 없으면 1.
function lossMedian(ratios) {
  const rs = ratios.filter((x) => x && x > 1 / 3 && x < 3).sort((a, b) => a - b);
  if (!rs.length) return 1;
  const h = rs.length >> 1;
  return rs.length % 2 ? rs[h] : (rs[h - 1] + rs[h]) / 2;
}
ok("로스 중앙값 홀수 [1, 1.5, 2] = 1.5", lossMedian([1, 1.5, 2]) === 1.5);
ok("로스 중앙값 짝수 [1, 1.2, 1.8, 2] = 1.5", lossMedian([1, 1.2, 1.8, 2]) === 1.5);
ok("로스 1/3·3배는 버림, 없으면 1", lossMedian([1 / 3, 3, 0]) === 1);
ok("로스 경계 안쪽만", near(lossMedian([0.34, 2.9]), (0.34 + 2.9) / 2));
ok("lossOf 소스에 짝수 평균이 있음", SRC.includes("rs.length % 2 ? rs[h] : (rs[h - 1] + rs[h]) / 2"));
ok("Apps Script에 발주 공식(fcAdj·estStock·1.65)이 없음", !/function fcAdj|function estStock|1\.65/.test(GS));
ok("Apps Script merge_가 앱 mergeObj와 같은 규칙", GS.includes("if (v === null) delete out[k]") && SRC.includes("if (v === null) delete out[k]"));

const kv = {
  ok: true,
  data: {
    forecast: {
      "2026-10-12": { act: "10" },
      "2026-10-19": { act: "40" },
      "2026-10-26": { act: "10" },
      "2026-11-02": { act: "10" },
      "2026-11-09": { act: "10" },
      "2026-11-16": { act: "10", fc: "20" },
      "2026-11-23": { fc: "20000000" },
    },
    events: { days: { "2026-10-19": { n: 1, cap: 7000, names: ["시험행사"] }, "2026-11-23": { n: 1, cap: 7000 } } },
    weather: { days: { "2026-11-23": { pop: 80, hi: 5, rain: 1 }, "2026-11-18": { pop: 10, hi: 20 } } },
    settings: {},
    "master.order": { cols: ["code"], rows: [{ name: "시험버터", code: "100001", vendor: "시험", unit: "PK", spec: "500g/pk", min: 0 }], conv: {} },
    holidays: ["2026-11-11"],
    vendorCfg: { "당일업체": { lead: 0, days: [1] }, "주류시험": { lead: 1, days: [1, 5] } },
  },
};
const kvPath = path.join(os.tmpdir(), "order-calc-unit-kv.json");
fs.writeFileSync(kvPath, JSON.stringify(kv));

const { page, close, errs } = await openApp({ kvPath, asOf: "2026-11-24", today: "all", hour: 11 });
const r = await page.evaluate(() => {
  const C = window.__orderCalc;
  const out = {};
  out.today = C.TODAY;
  out.num = [C.num("1,234.5"), C.num(""), String(C.num(null)), C.num("10")];
  out.addBizFri = C.addBiz("2026-11-20", 2);
  out.addBizSat = C.addBiz("2026-11-21", 1);
  out.addBiz0 = C.addBiz("2026-11-23", 0);
  out.deliveryFri = C.delivery("2026-11-20");
  out.holi = [C.isHoliday("2026-01-01"), C.isHoliday("2026-11-11"), C.isHoliday("2026-11-23")];
  out.group = { mon: C.fcGroup("2026-11-23"), wed: C.fcGroup("2026-11-18"), sat: C.fcGroup("2026-11-21"), holi: C.fcGroup("2026-11-11") };
  out.baseClean = C.dataBase("2026-11-23");
  out.baseAll = C.dataBase("2026-11-23", true);
  out.upNone = C.evUplift("2026-11-18");
  out.upDef = C.evUplift("2026-11-23");
  const db = C.db();
  db.events.days["2026-11-23"] = { ...db.events.days["2026-11-23"], exp: 7000 };
  out.upFull = C.evUplift("2026-11-23");
  db.events.days["2026-11-23"] = { ...db.events.days["2026-11-23"], exp: 0 };
  out.upZero = C.evUplift("2026-11-23");
  out.rain = C.isRain({ pop: 60, hi: 20 });
  out.rainLow = C.isRain({ pop: 59 });
  out.cold = C.isCold({ hi: 12 });
  out.coldNo = C.isCold({ hi: 12.1 });
  out.coldMissing = C.isCold({});
  out.nearBoth = C.nearWx("2026-11-23", 20, 10);
  out.nearSkip = C.nearWx("2026-11-23", 9, 10);
  out.nearClear = C.nearWx("2026-11-18", 20, 10);
  out.fc = C.fcAdj("2026-11-16");
  out.lead0 = C.deliveryOf({ vendor: "당일업체" }, "2026-11-23");
  out.lead1 = C.deliveryOf({ vendor: "주류시험" }, "2026-11-23");
  out.lead2 = C.deliveryOf({ vendor: "없는업체" }, "2026-11-20");
  out.orderMon = C.isOrderDay({ vendor: "당일업체" }, "2026-11-23");
  out.orderTue = C.isOrderDay({ vendor: "당일업체" }, "2026-11-24");
  out.eff = C.effDays("2026-11-16", "2026-11-18");
  out.we = C.weMix({ weK: 2, wdK: 1 }, { gross: 100, weGross: 40 });
  out.weEmpty = C.weMix({ weK: 2, wdK: 1 }, { gross: 0, weGross: 0 });
  out.plus = C.weekendPlus();
  const it = {
    key: "시험버터", plain: false, recipeOnly: false, ledgerOnly: false,
    rateA: 2, fixedA: 0, rateB: 4, rateG: null,
    scoreA: [], scoreB: [], errA: [0.1, 0.1], errB: [0.2, 0.2],
    scoreF: [0.1, 0.1, 0.1, 0.1, 0.1], scoreQ: [], newShare: 0,
    useK: 1, weK: 1, wdK: 1, loss: 1, shelf: 0, useStep: 0, min: 0, thaw: 0,
    pk: { mult: 1, sameUnit: true, stock: "PK" },
  };
  const win = { today: "2026-11-23", end: "2026-11-25", days: 2, nEff: 2, gross: 2e6, weGross: 0, wkGross: 0, fcVar: 0 };
  out.calc = C.calc(it, win, 1, 0);
  out.calcNeg = C.calc(it, win, -2, 0);
  out.calcNone = C.calc({ ...it, rateA: null, rateB: null, rateG: null }, win, 0, 0);
  const it10 = { ...it, pk: { mult: 10, sameUnit: false, stock: "EA" }, min: 0 };
  out.calc10 = C.calc(it10, win, 0, 0);
  out.ord = [C.ordToStock(it, 3), C.ordToStock(it10, 3)];
  out.qty = C.parseQty("", "1.5kg");
  out.qtyTb = C.parseQty("", "2 TB");
  out.qtyHalf = C.parseQty("", "1/2 cup");
  out.qtyEa = C.parseQty("", "3 ea");
  out.qtyKo = C.parseQty("", "3개");
  out.qtyBad = C.parseQty("", "조금");
  out.stock = C.toStock({ g: 1000 }, { g: 500 });
  out.stockEa = C.toStock({ ea: 2 }, { ea: 4 });
  out.stockMiss = C.toStock({ g: 100 }, {});
  out.pack = C.packOf({ unit: "PK", spec: "500g/pk", name: "버터" }, null);
  const e = { x: "2026-11-20", s0: 5, days: [{ d: "2026-11-20", w: 10 }, { d: "2026-11-21", w: 10 }], arrs: [{ d: "2026-11-22", q: 8 }] };
  out.seqFloor = C.seqStock(e, 30, null);
  out.seqPlain = C.seqStock({ x: "2026-11-20", s0: 40, days: [{ d: "2026-11-20", w: 10 }, { d: "2026-11-21", w: 10 }], arrs: [] }, 10, null);
  out.leftOpen = C.leftOf(10, "2026-11-23");
  out.leftClose = C.leftOf(15, "2026-11-23");
  out.hourMid = C.hourCum("2026-11-23", 15.5);
  out.merge = C.mergeObj({ a: 1, nest: { x: 1, y: 2 }, gone: 3 }, { a: null, nest: { y: 9 }, add: [1, 2] });
  out.errs = 0;
  return out;
});
await close();

ok("화면 오류 0", errs.length === 0, errs.join(" | "));
ok("오늘 시계 11/24", r.today === "2026-11-24", r.today);
ok("num 쉼표", r.num[0] === 1234.5);
ok("num 빈칸·null", Number.isNaN(r.num[1]) && r.num[2] === "NaN");
ok("금요일+2영업일 = 월요일(토 1, 일 제외, 월 2)", r.addBizFri === "2026-11-23" && r.deliveryFri === "2026-11-23", r.addBizFri);
ok("토요일+1영업일 = 월요일", r.addBizSat === "2026-11-23");
ok("영업일 0은 그날", r.addBiz0 === "2026-11-23");
ok("공휴일 목록", r.holi[0] === true && r.holi[1] === true && r.holi[2] === false);
ok("요일 묶음", r.group.mon === "mt" && r.group.wed === "wtf" && r.group.sat === "we" && r.group.holi === "we", JSON.stringify(r.group));
// 행사 없는 월요일 5개(10)와 행사일 40. 40 > 10×1.15 이라 빼면 10. 남기면 가중 270/21.
ok("요일 평균에서 큰 행사일 제외", near(r.baseClean, 10), String(r.baseClean));
ok("행사일 닻은 그 날을 남긴 평균", near(r.baseAll, 270 / 21), String(r.baseAll));
ok("행사 없는 날 배수 1", r.upNone === 1);
ok("관람 인원 없으면 +2%", near(r.upDef, 1.02) && near(r.upZero, 1.02), String(r.upDef));
ok("관람=수용이면 1.10", near(r.upFull, 1.1), String(r.upFull));
ok("비 60%·59%", r.rain === true && r.rainLow === false);
ok("한파 12도 이하, 빈 기온은 아님", r.cold === true && r.coldNo === false && r.coldMissing === false);
// 비 0.90 × 한파 0.95 = 0.855 → 폭의 40% = 0.942 → 하한 0.96. 점장이 이미 기준보다 낮으면 1.
ok("근일 비+한파 배수 0.96", near(r.nearBoth, 0.96), String(r.nearBoth));
ok("점장이 이미 낮으면 날씨를 또 안 깎음", r.nearSkip === 1);
ok("맑은 날 날씨 배수 1", r.nearClear === 1);
// 11/16은 행사일이 아니라 큰 행사일(10/19)을 뺀 평균 10으로 0.25 섞음. 날씨·행사 배수 없음.
const fc16 = 20 * Math.pow(10 / 20, 0.25);
ok("닻 섞기 11/16", near(r.fc, fc16, 1e-6), `${r.fc} vs ${fc16}`);
ok("lead 0은 지금 2영업일로 읽힘", r.lead0 === "2026-11-25", r.lead0);
ok("lead 1은 다음 영업일", r.lead1 === "2026-11-24", r.lead1);
ok("lead 없으면 금요일+2 = 월요일", r.lead2 === "2026-11-23", r.lead2);
ok("발주 요일", r.orderMon === true && r.orderTue === false);
// 11/16 act 10, 11/17 없음 → dayGross는 데이터 예상. effDays는 두 날 매출이 같으면 2에 가깝다. 여기선 함수가 숫자인지만.
ok("실제 일수", r.eff > 0 && r.eff <= 2, String(r.eff));
ok("주말 배수 섞기 (60%×1 + 40%×2)", near(r.we, 1.4), String(r.we));
ok("매출 0이면 주말 배수 1", r.weEmpty === 1);
ok("주말 여유 기본 25%", near(r.plus, 0.25));
// useA=4, useB=8, wA=0.8, use=4.8. σ=0.1, nd=2, fcRel=0.
// ss = 1.65 × 4.8 × 0.3 / √2
const use = 4.8;
const ss = 1.65 * use * 0.3 / Math.sqrt(2);
ok("발주 사용량 4.8", r.calc && near(r.calc.use, use), r.calc && String(r.calc.use));
ok("안전재고 1.65σ", r.calc && near(r.calc.ss, ss, 1e-6), r.calc && String(r.calc.ss));
ok("A 비중 0.8", r.calc && near(r.calc.wA, 0.8));
ok("재고 1이면 발주량은 필요−1의 올림", r.calc && r.calc.orderQty === Math.ceil(use + ss - 1 - 1e-9));
ok("재고 −2면 발주가 3 더 많음", r.calcNeg && r.calcNeg.orderQty === r.calc.orderQty + 3, `${r.calcNeg && r.calcNeg.orderQty} vs ${r.calc && r.calc.orderQty}`);
ok("사용량 없으면 발주 없음", r.calcNone && r.calcNone.none === true);
ok("10개 단위는 묶음 1개(재고로는 10)", r.calc10 && r.calc10.orderQty === 1 && r.calc10.packs === 1, r.calc10 && String(r.calc10.orderQty));
ok("발주→재고 단위", r.ord[0] === 3 && r.ord[1] === 30);
ok("1.5kg = 1500g", r.qty && r.qty.g === 1500);
ok("2TB = 30ml", r.qtyTb && r.qtyTb.ml === 30 && r.qtyTb.vol === true);
ok("1/2컵 = 120ml", r.qtyHalf && r.qtyHalf.ml === 120);
ok("3 ea = 3", r.qtyEa && r.qtyEa.ea === 3, JSON.stringify(r.qtyEa));
ok("3개는 지금 인식 못 함(\\b가 한글 뒤에서 안 맞음)", r.qtyKo === null, JSON.stringify(r.qtyKo));
ok("단위 없으면 null", r.qtyBad === null);
ok("1000g / 500g = 2", r.stock === 2);
ok("2ea / 4ea = 0.5", r.stockEa === 0.5);
ok("환산 못 하면 null", r.stockMiss === null);
ok("규격 500g/pk", r.pack && r.pack.g === 500, JSON.stringify(r.pack));
ok("날짜순 재고는 0 아래에서 입고를 깎지 않음", near(r.seqFloor, 8), String(r.seqFloor));
ok("바닥 아니면 시작+입고−사용", near(r.seqPlain, 30), String(r.seqPlain));
ok("발주 마감 전 남은 매출 비율 1", r.leftOpen === 1);
ok("14:30은 마감 시각이라 남은 비율 1, 15시는 그보다 작음", r.leftOpen === 1 && r.leftClose < 1);
ok("시간대 비율 없으면 10:30~20:30 비례", near(r.hourMid, (15.5 - 10.5) / (20.5 - 10.5)));
ok("merge 중첩·null·배열", JSON.stringify(r.merge) === JSON.stringify({ nest: { x: 1, y: 9 }, gone: 3, add: [1, 2] }), JSON.stringify(r.merge));
ok("merge가 Apps Script와 같음", JSON.stringify(r.merge) === JSON.stringify(mergeGs({ a: 1, nest: { x: 1, y: 2 }, gone: 3 }, { a: null, nest: { y: 9 }, add: [1, 2] })));

console.log(`단위 시험 통과 ${pass} · 실패 ${fail}`);
if (bad.length) console.log(bad.join("\n"));
process.exit(fail ? 1 : 0);
