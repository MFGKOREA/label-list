// 되돌려 보기 공용 도구: 앱(order.html)을 "그날 그 시각" 상태로 여는 함수. 시트에 쓰지 않음(GET은 파일로 대답, POST는 막음)
//  - 앱 계산 함수들을 밖에서 부를 수 있게 window.__orderCalc에 이름을 더한 사본을 임시 폴더에 만들어 엶 (저장소 파일은 안 건드림)
//  - asOf를 주면 그날 뒤의 자료(실제 Gross, 재고·발주 입력, 재고 기록, 메뉴 판매)를 잘라내고 시계를 그날로 고정 → 미래 자료가 새지 않음
// 사용 (다른 .mjs에서):
//   import { openApp } from "./bt/asof.mjs";
//   const { page, close } = await openApp({ kvPath: "kv.json", asOf: "2026-11-05", hour: 11 });
//   const r = await page.evaluate(() => { const C = window.__orderCalc, M = C.model(); /* … */ });
//   await close();
// 직접 실행: node order-src/test/bt/asof.mjs <kv.json> [날짜]   → 그날의 품목 수·채점 수·발주 추천 수
// kv.json = 시트 사본(curl -sL "<DEFAULT_API>?api=1" 로 받은 것). 매장 자료라 저장소에 넣지 않음.
// 한계: 달 자료(수불·매출)는 나중에 올라온 것이라 그 달 중의 as-of에는 누수가 있음(dropMonths로 민감도 확인). 점장 Forecast는 지금 값.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const NAMES = "ORDER_CUTOFF_H, misTrust, misOn, ordCnt, unknownArr, menuW, estStock, dayRowsOf, COUPON, wholeStep, OPEN_H, CLOSE_H, arrivalsOf, sumGross, dayGross, leftOf, hourOf, hourCum, isMeat, logOn, inputLog, arrBetween, weSum, isWE, stockOf, counted, batchRawOf, prepRawOf, weMix, isOrderDay, deliveryOf, nextOrderDay, fcGroup, isHoliday, addDays, addBiz, delivery, dow, parseISO, num, MEAT_H, effDays, wkGross, weekendPlus, vcfg, countStepOf, riskOf, applyScores, mergeLogs, fcHist".split(", ");
// 계산 함수를 더 내보낸 사본 (앱에 그 이름이 있을 때만)
export function extended(htmlPath = REPO + "/order.html") {
  const s = fs.readFileSync(htmlPath, "utf8"), m = /window\.__orderCalc = \{ /.exec(s);
  if (!m) throw new Error("order.html에서 window.__orderCalc 줄을 못 찾음");
  const have = NAMES.filter((n) => new RegExp("(const|let|function)\\s+" + n + "\\b|[,{]\\s*" + n + "\\s*=").test(s) && !new RegExp("__orderCalc = \\{[^;]*\\b" + n + "\\b").test(s));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "order-x-")), "order-x.html");
  fs.writeFileSync(out, s.replace("window.__orderCalc = { ", "window.__orderCalc = { " + have.join(", ") + ", "));
  return out;
}
export function cutKv(data, asOf, { today = "counted", dropMonths = [] } = {}) {
  const d = JSON.parse(JSON.stringify(data));
  if (!asOf) return d;
  Object.keys(d.forecast || {}).forEach((x) => { if (x >= asOf && d.forecast[x]) d.forecast[x] = { ...d.forecast[x], act: "" }; });
  Object.keys(d).forEach((k) => {
    let m;
    if ((m = /^input\.(\d{4}-\d\d-\d\d)$/.exec(k))) {
      if (m[1] > asOf || (m[1] === asOf && today === "none")) delete d[k];
      else if (m[1] === asOf && today === "counted") { const o = {}; Object.keys(d[k]).forEach((n) => { const v = d[k][n]; if (v && v.s !== "" && v.s != null) o[n] = { ...v, o: "", r: "" }; }); d[k] = o; }
    } else if ((m = /^(menuDay|menuDayPart|prepOnhand|misOrder)\.(\d{4}-\d\d-\d\d)$/.exec(k))) { if (m[2] >= asOf) delete d[k]; }
    else if ((m = /^month\.(\d{4}-\d\d)$/.exec(k))) { if (m[1] > asOf.slice(0, 7)) delete d[k]; else if (dropMonths.includes(m[1])) ["gross", "ledger", "sales"].forEach((f) => delete d[k][f]); }
  });
  const lim = today === "none" ? asOf : asOf + " 99";
  ["onhand", "onhand.archive", "prepLog"].forEach((k) => { if (Array.isArray(d[k])) d[k] = d[k].filter((l) => l && l.t && l.t < lim); });
  ["misPush", "salesPush", "learnlog", "learnsnap"].forEach((k) => delete d[k]);
  return d;
}
// today: "counted"(그날 재고는 남기고 그날 발주·추천은 지움) | "none"(그날 입력 전부 지움) | "all"(그대로)
export async function openApp({ kvPath, html, asOf = null, hour = 11, today = "counted", dropMonths = [], mutate = null } = {}) {
  const raw = JSON.parse(fs.readFileSync(kvPath, "utf8")); let data = cutKv(raw.data || raw, asOf, { today, dropMonths });
  if (mutate) data = mutate(data) || data;
  const body = JSON.stringify({ ok: true, data });
  const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
  const ctx = await browser.newContext({ timezoneId: "Asia/Seoul" }); const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (asOf) await page.clock.setFixedTime(new Date(`${asOf}T${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}:00+09:00`));
  await page.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? body : '{"ok":true,"data":{}}' }));
  await page.goto("file://" + extended(html));
  await page.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 90000 });
  await page.waitForTimeout(600);
  return { browser, page, errs, data, close: () => browser.close() };
}
if (process.argv[1] && process.argv[1].endsWith("asof.mjs")) {
  const [kvPath, asOf] = process.argv.slice(2);
  if (!kvPath) { console.log("사용: node order-src/test/bt/asof.mjs <kv.json> [날짜]"); process.exit(1); }
  const { page, close, errs } = await openApp({ kvPath, asOf: asOf || null });
  const r = await page.evaluate(() => { const C = window.__orderCalc, M = C.model(), T = C.TODAY, rows = C.db()["input." + T] || {}; let rec = 0, cnt = 0; M.items.forEach((it) => { if (it.ledgerOnly) return; const v = rows[it.key]; if (!C.counted(v)) return; cnt++; const c = C.calc(it, C.orderWindowFor(it, T), C.availOf(it, v), C.incomingOf(it, T)); if (!c.none && c.orderQty > 0) rec++; }); return { T, items: M.items.length, scores: M.scores.length, counted: cnt, rec, fcBias: C.fcBias().label }; });
  console.log(JSON.stringify(r), "화면 오류", errs.length); await close();
}
