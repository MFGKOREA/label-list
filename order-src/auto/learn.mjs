// 매일 채점: 시트 자료로 앱을 열어 어제 예측이 얼마나 맞았는지 재고, 학습 기록(learnlog)에 한 줄 남김
//  - 읽기만 함. --log를 줄 때만 시트 learnlog에 하루 한 번 덧붙임(append). 같은 날 기록이 이미 있으면 안 씀
//  - 화면에 찍는 숫자는 매장 자료이므로 저장소·커밋에 옮기지 않음
// 사용: node order-src/auto/learn.mjs [--log] [--final] [--dry] [--kv 파일]
//   --final: 오늘 마지막 차례. 어제 매출이 아직 없어도 "못 받음"으로 기록
//   --dry:   기록할 내용을 보여 주기만 함
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openApp } from "../test/bt/asof.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.ORDER_API_TEST || /DEFAULT_API = "([^"]+)"/.exec(fs.readFileSync(path.join(HERE, "../app.js"), "utf8"))[1];
const arg = (n) => process.argv.includes(n), val = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const get = async () => { let last; for (let i = 0; i < 3; i++) { try { const j = await (await fetch(API + "?api=1&t=" + Date.now())).json(); if (j && j.ok) return j; last = j && j.error; } catch (e) { last = e.message; } await new Promise((r) => setTimeout(r, 2000 + 3000 * i)); } throw new Error("시트를 못 읽음: " + last); };
let kvPath = val("--kv");
if (!kvPath) { const dir = path.join(os.tmpdir(), "order-auto"); fs.mkdirSync(dir, { recursive: true }); kvPath = path.join(dir, "kv.json"); fs.writeFileSync(kvPath, JSON.stringify(await get())); }
const raw = JSON.parse(fs.readFileSync(kvPath, "utf8")), D = raw.data || raw;
// 시트가 비었거나 바뀐 것 같으면 멈춤 (collect.py와 같은 기준)
const nRows = (((D["master.order"] || {}).rows) || []).length, nFc = Object.keys(D.forecast || {}).length;
if (nRows < 50 || nFc < 30 || Object.keys(D).length < 30) { console.log(`시트 비정상: 품목 ${nRows} · Forecast ${nFc}일 → 채점·기록 안 함`); process.exit(3); }
const { page, close, errs } = await openApp({ kvPath });
const r = await page.evaluate(() => {
  const C = window.__orderCalc, M = C.model(), db = C.db(), T = C.TODAY, fc = db.forecast || {};
  const add = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const Y = add(T, -1), n = (v) => +String(v == null ? "" : v).replace(/,/g, "");
  const ratio = (d) => { const f = n((fc[d] || {}).fc), a = n((fc[d] || {}).act); return f > 0 && a > 0 ? a / f : null; };
  const mape = (from, to) => { const e = []; for (let d = from; d <= to; d = add(d, 1)) { const x = ratio(d); if (x != null) e.push(Math.abs(x - 1)); } return e.length ? { n: e.length, v: e.reduce((s, x) => s + x, 0) / e.length * 100 } : null; };
  // 앱 리포트의 "예상 재고 적중 · WAPE"와 같은 식
  const hitOf = (l) => { const z = l.filter((x) => x.pF != null && isFinite(x.actual) && isFinite(x.e)); if (!z.length) return null; const hit = z.filter((x) => Math.abs(x.pF - x.actual) <= Math.max(x.u || 1, 0.1 * Math.abs(x.e))).length, ae = z.reduce((t, x) => t + Math.abs(x.pF - x.actual), 0), se = z.reduce((t, x) => t + Math.abs(x.e), 0); return { n: z.length, hit: hit / z.length * 100, wape: se ? ae / se * 100 : null }; };
  const sc = (M.scores || []).filter((s) => !s.src), rng = (a, b) => sc.filter((s) => s.end > a && s.end <= b);
  // 살펴볼 품목: 최근 14일에 3번 넘게 채점됐고 오차가 한쪽으로만 쏠린 것 (주간 점검이 원인을 봄)
  const by = {}; rng(add(T, -14), T).forEach((s) => { if (s.pF == null || !isFinite(s.actual)) return; const o = (by[s.key] = by[s.key] || { name: s.name, n: 0, bias: 0, abs: 0, e: 0 }); o.n++; o.bias += s.pF - s.actual; o.abs += Math.abs(s.pF - s.actual); o.e += Math.abs(s.e || 0); });
  const watch = Object.values(by).filter((o) => o.n >= 3 && o.abs > 0 && Math.abs(o.bias) / o.abs >= 0.8 && o.abs / Math.max(o.e, 1) > 0.25).sort((a, b) => b.abs / Math.max(b.e, 1) - a.abs / Math.max(a.e, 1)).slice(0, 6).map((o) => ({ name: o.name, n: o.n, dir: o.bias > 0 ? "예상 사용이 실제보다 많음" : "예상 사용이 실제보다 적음", rel: Math.round(o.abs / Math.max(o.e, 1) * 100) }));
  const cnt = (o) => ({ s: Object.values(o || {}).filter((v) => v && v.s !== "" && v.s != null && !v.est).length, o: Object.values(o || {}).filter((v) => v && +v.o > 0).length });
  const noFc = []; for (let i = 0; i < 7; i++) { const d = add(T, i); if (!(n((fc[d] || {}).fc) > 0)) noFc.push(d); }
  const ag = db.misAgent || {};
  return { T, Y, dowY: new Date(Y + "T00:00:00Z").getUTCDay(), ratioY: ratio(Y), hasFcY: n((fc[Y] || {}).fc) > 0, menuY: !!db["menuDay." + Y], menuDays: Object.keys(db).filter((k) => /^menuDay\.\d/.test(k)).length,
    mape7: mape(add(T, -7), Y), mape7p: mape(add(T, -14), add(T, -8)), hit7: hitOf(rng(add(T, -7), T)), hit7p: hitOf(rng(add(T, -14), add(T, -7))), hit28: hitOf(rng(add(T, -28), T)),
    watch, cntY: cnt(db["input." + Y]), cntT: cnt(db["input." + T]), noFc, bias: C.fcBias().label, pcAgoMin: ag.at ? Math.round((Date.now() - ag.at) / 60000) : null, pcVer: ag.ver || null, logIds: (db.learnlog || []).map((e) => e.id) };
});
await close();
const DOW = "일월화수목금토", md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`, pc = (x) => (x == null ? "–" : Math.round(x) + "%");
console.log(`기준 ${r.T} · 화면 오류 ${errs.length}`);
console.log(`어제 ${md(r.Y)}(${DOW[r.dowY]}): 실제 매출 ${r.ratioY != null ? "있음 · Forecast의 " + pc(r.ratioY * 100) : r.hasFcY ? "없음" : "Forecast 없음"} · 메뉴 판매 ${r.menuY ? "있음" : "없음"}(모두 ${r.menuDays}일) · 센 품목 ${r.cntY.s} · 발주 ${r.cntY.o}`);
console.log(`Forecast 오차(하루 평균): 최근 7일 ${r.mape7 ? pc(r.mape7.v) + " (" + r.mape7.n + "일)" : "–"} · 그 전 7일 ${r.mape7p ? pc(r.mape7p.v) : "–"} · 지금 요일 보정 "${r.bias || "없음"}"`);
console.log(`예상 재고 적중 / WAPE: 최근 7일 ${r.hit7 ? pc(r.hit7.hit) + " / " + pc(r.hit7.wape) + " (" + r.hit7.n + "쌍)" : "–"} · 그 전 7일 ${r.hit7p ? pc(r.hit7p.hit) + " / " + pc(r.hit7p.wape) + " (" + r.hit7p.n + "쌍)" : "–"} · 28일 ${r.hit28 ? pc(r.hit28.hit) + " / " + pc(r.hit28.wape) + " (" + r.hit28.n + "쌍)" : "–"}`);
console.log(`살펴볼 품목(한쪽으로 쏠린 오차): ${r.watch.length ? r.watch.map((w) => `${w.name}(${w.n}번, ${w.dir}, 재고 대비 ${w.rel}%)`).join(" · ") : "없음"}`);
console.log(`Forecast 빈 날(오늘부터 7일): ${r.noFc.length ? r.noFc.map(md).join(", ") : "없음"} · PC 마지막 신호 ${r.pcAgoMin == null ? "없음" : r.pcAgoMin + "분 전"} · 확장 ${r.pcVer || "?"}`);
// 학습 기록 한 줄 (하루 한 번)
const id = "collect-" + r.T, notes = [];
if (r.ratioY != null) notes.push(["learn", `${md(r.Y)}(${DOW[r.dowY]}) 실제 매출 반영 · Forecast의 ${pc(r.ratioY * 100)}${r.menuY ? " · 메뉴 판매도 반영" : ""}`]);
else if (arg("--final") && r.hasFcY) notes.push(["err", `${md(r.Y)}(${DOW[r.dowY]}) 실제 매출을 못 받음 · 매장 PC가 꺼져 있었거나 MIS에 아직 없음`]);
if (r.ratioY != null && !r.menuY && arg("--final")) notes.push(["err", `${md(r.Y)} 메뉴 판매를 못 받음`]);
if (notes.length && r.hit7 && r.hit7.n >= 30) { const dw = r.hit7p && r.hit7p.n >= 30 && r.hit7.wape != null && r.hit7p.wape != null ? r.hit7.wape - r.hit7p.wape : 0; notes.push([dw <= -1 ? "down" : dw >= 1 ? "up" : "learn", `예상 재고 적중 최근 7일 ${pc(r.hit7.hit)} · 오차 ${pc(r.hit7.wape)}${r.hit7p && r.hit7p.n >= 30 ? ` (그 전 7일 ${pc(r.hit7p.hit)} · ${pc(r.hit7p.wape)})` : ""}`]); }
if (notes.length && r.watch.length) notes.push(["learn", `살펴볼 품목: ${r.watch.slice(0, 3).map((w) => w.name).join(", ")}`]);
if (!arg("--log") && !arg("--dry")) process.exit(0);
if (!notes.length) { console.log("기록할 것 없음(어제 매출이 아직 없음)"); process.exit(0); }
if (r.logIds.includes(id)) { console.log("오늘 기록은 이미 있음 → 안 씀"); process.exit(0); }
const k = new Date(Date.now() + 9 * 3600e3).toISOString(), entry = { id, t: k.slice(0, 10) + " " + k.slice(11, 16), by: "자동 수집", notes };
console.log("기록: " + JSON.stringify(entry));
if (arg("--dry")) process.exit(0);
const res = await (await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "append", key: "learnlog", item: entry }) })).json();
console.log(res && res.ok ? "학습 기록에 남김" : "기록 실패: " + (res && res.error));
process.exit(res && res.ok ? 0 : 4);
