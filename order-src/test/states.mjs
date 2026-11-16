// 상태 계약 시험 (11/16 "상태 머신 헌터"): 여러 파일에 따로 적힌 상태 낱말·시간 값이 서로 어긋나지 않는지 봄. 목록은 order-src/STATES.md
//  1) 파일만 읽는 검사(빠름, 브라우저 없음): 요청 수명 시간(앱 ↔ collect.py ↔ 확장), 상태 낱말, 수집 기록 원인, 문서에 빠진 낱말
//  2) kv.json을 주면 앱을 열어: appState() 낱말, 카드 data-need, 86 data-mode, 발주 전송 data-phase가 정해진 낱말인지
// 사용: node order-src/test/states.mjs [kv.json]   (kv.json은 매장 자료라 저장소에 넣지 않음)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), R = (f) => fs.readFileSync(path.resolve(HERE, "../..", f), "utf8");
const app = R("order-src/app.js"), col = R("order-src/auto/collect.py"), bg = R("gw-agent/bg.js"), auto = R("gw-agent/auto.js"), sales = R("mis-sales.js"), doc = R("order-src/STATES.md"), css = R("order-src/app.css");
let fail = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fail++; };
const ms = (expr) => { // "20 * 60e3" · "18 * 3600e3" · "180000" → ms
  const e = String(expr).trim().replace(/MIN/g, "60e3"); if (!/^[\d\s.*e]+$/.test(e)) throw new Error("시간 값을 못 읽음: " + expr); return Function(`return (${e})`)(); };
const pick = (src, re, name) => { const m = re.exec(src); if (!m) { ok(false, `${name}: 코드에서 못 찾음 (${re})`); return NaN; } return ms(m[1]); };
const min = (x) => `${Math.round(x / 6e4 * 10) / 10}분`;

// ---- 1) 매장 PC 살아 있음 ----
const aAlive = pick(app, /PC_ALIVE = \{ ondemand: ([^,]+),/, "앱 PC_ALIVE.ondemand"), aLegacy = pick(app, /PC_ALIVE = \{[^}]*legacy: ([^ }]+)/, "앱 PC_ALIVE.legacy");
const spAlive = pick(app, /const SP = Object\.assign\(\{[^}]*\balive: ([^,}]+)/, "앱 SP.alive");
const cAlive = pick(col, /alive = .*< \(([^)]*?) if ag\.get\("mode"\) == "ondemand"/, "collect.py alive(ondemand)"), cLegacy = pick(col, /alive = .*else ([^)]+)\)/, "collect.py alive(legacy)");
const beat = pick(bg, /now - lastBeat > ([^)]+)\)/, "확장 신호 간격");
ok(aAlive === spAlive && aAlive === cAlive && aLegacy === cLegacy, `PC 살아 있음: 앱 ${min(aAlive)} = 매출 버튼 ${min(spAlive)} = collect.py ${min(cAlive)} (예전 방식 ${min(aLegacy)} = ${min(cLegacy)})`);
ok(aAlive > beat, `PC 살아 있음 ${min(aAlive)} > 확장 신호 간격 ${min(beat)} (한 번 빠져도 꺼짐으로 안 봄: ${aAlive >= 2 * beat ? "두 배 이상" : "두 배 미만"})`);
// ---- 2) 발주 전송(misPush) ----
const stP = pick(app, /MIS_STALE = \{ pending: ([^,]+),/, "앱 MIS_STALE.pending"), stR = pick(app, /MIS_STALE = \{[^}]*running: ([^,]+),/, "앱 MIS_STALE.running");
const lOrder = pick(bg, /LIMIT = \{ order: ([^,]+),/, "확장 LIMIT.order"), lRun = pick(bg, /LIMIT = \{[^}]*orderRun: ([^,]+),/, "확장 LIMIT.orderRun"), lSales = pick(bg, /LIMIT = \{[^}]*sales: ([^,]+),/, "확장 LIMIT.sales");
ok(stP > lOrder && stR > lRun, `발주 전송 "응답 없음": 앱 ${min(stP)}·${min(stR)} > 확장이 스스로 끝내는 ${min(lOrder)}·${min(lRun)} (확장이 결과를 적기 전에 앱이 먼저 실패로 안 봄)`);
// ---- 3) 매출 요청(salesPush) ----
const spRun = pick(app, /const SP = Object\.assign\(\{[^}]*runMax: ([^,}]+)/, "앱 SP.runMax"), spPend = pick(app, /const SP = Object\.assign\(\{ pendMax: ([^,}]+)/, "앱 SP.pendMax"), spOff = pick(app, /const SP = Object\.assign\(\{[^}]*offMax: ([^,}]+)/, "앱 SP.offMax");
const cRun = pick(col, /== "running" and now - .*? < (\d+ \* MIN) or/, "collect.py running"), cPend = pick(col, /age < \(([^)]*?) if alive/, "collect.py pending"), cOff = pick(col, /if alive else ([^)]+)\)/, "collect.py PC 꺼짐");
ok(spRun === cRun && spPend === cPend && spOff === cOff, `매출 요청이 살아 있는 시간: 읽는 중 ${min(spRun)} = ${min(cRun)} · 기다림 ${min(spPend)} = ${min(cPend)} · PC 꺼짐 ${min(spOff)} = ${min(cOff)} (앱 = collect.py)`);
ok(spRun > lSales, `매출 읽는 중 ${min(spRun)} > 확장이 스스로 끝내는 ${min(lSales)}`);
const bgSales = pick(bg, /salesWaiting = .*< ([^;]+);/, "확장 salesWaiting");
ok(bgSales <= spOff, `확장이 받아 주는 매출 요청 나이 ${min(bgSales)} ≤ 앱이 기다리는 ${min(spOff)} (그 사이는 앱·collect.py가 다시 보냄 — STATES.md "알려진 틈")`);
// ---- 4) 상태 낱말 ----
const ST = new Set(["pending", "running", "done", "error"]);
for (const [name, src] of [["앱", app], ["collect.py", col], ["확장 bg.js", bg], ["확장 auto.js", auto], ["mis-sales.js", sales]]) {
  const used = new Set([...src.matchAll(/status(?:"\))?\s*(?:[:=]|===?|!==?)\s*"([a-z]+)"/g)].map((m) => m[1]));
  const extra = [...used].filter((x) => !ST.has(x));
  ok(extra.length === 0, `${name}: 요청 상태 낱말은 pending·running·done·error뿐 (${[...used].sort().join("·") || "없음"}${extra.length ? " · 모르는 낱말 " + extra.join(",") : ""})`);
}
// 수집 기록 원인: collect.py가 남기는 why ⊆ 앱이 아는 WHY
const whyApp = new Set([...(/const WHY = \{([^}]+)\}/.exec(app) || ["", ""])[1].matchAll(/(\w+):/g)].map((m) => m[1]));
const whyCol = new Set([...col.matchAll(/clog\(a\.dry, \w+, kst, "\w+", "(\w+)"/g)].map((m) => m[1]).concat([...col.matchAll(/return "(\w+)"/g)].map((m) => m[1])).concat(["tried", "fresh"]));
const missWhy = [...whyCol].filter((x) => !whyApp.has(x));
ok(whyCol.size >= 8 && missWhy.length === 0, `수집 기록 원인 ${whyCol.size}개 모두 앱 상황판이 아는 낱말${missWhy.length ? " — 모름: " + missWhy.join(",") : ""}`);
// 상황판 점 색: gwHealth가 쓰는 s ⊆ CSS .dot.*
const dots = new Set([...css.matchAll(/\.kv\.hl \.dot\.(\w+)/g)].map((m) => m[1]).concat(["none"]));
const hs = new Set([...(app.slice(app.indexOf("function gwHealth()"), app.indexOf("function renderHealth(")).matchAll(/"(ok|warn|bad|none|info)"/g))].map((m) => m[1]));
ok([...hs].every((x) => dots.has(x)), `상황판 상태 ${[...hs].sort().join("·")} 모두 점 색이 있음`);
// ---- 5) 문서에 빠진 낱말 ----
const NEED = [...new Set([...app.slice(app.indexOf("const needOf = () => {"), app.indexOf("const draw = () => {")).matchAll(/st: (?:offDay \? )?"(\w+)"(?: : "(\w+)")?/g)].flatMap((m) => [m[1], m[2]].filter(Boolean)))];
const WORDS = { "필요량 칸": NEED, "발주 전송·매출 버튼": ["idle", "run", "wait", "ok", "bad"], "재고 칸": ["none", "counted", "est"], "86 모드": ["counted", "est", "night"], "하루 시간대": ["pre", "open", "night"], "7일 세기": ["today", "due", "low"], "수집 기록": [...whyCol] };
for (const [k, ws] of Object.entries(WORDS)) { const miss = ws.filter((w) => !new RegExp("`" + w + "`").test(doc)); ok(ws.length > 0 && miss.length === 0, `STATES.md에 ${k} 낱말 ${ws.length}개 모두 있음${miss.length ? " — 빠짐: " + miss.join(",") : ""}`); }

// ---- 6) 앱을 열어 실제 값 ----
const kv = process.argv[2];
if (kv) {
  const { openApp } = await import("./bt/asof.mjs");
  for (const [label, hour] of [["아침 10시", 10], ["밤 21시", 21]]) {
    const raw = JSON.parse(fs.readFileSync(kv, "utf8")), D = raw.data || raw, asOf = Object.keys(D).filter((k) => /^input\.\d/.test(k)).map((k) => k.slice(6)).sort().pop();
    const { page, close, errs } = await openApp({ kvPath: kv, asOf, hour, today: "all" });
    const r = await page.evaluate(() => { const C = window.__orderCalc, s = C.appState();
      return { s, need: [...new Set([...document.querySelectorAll("#orderList .cell[data-key]")].map((c) => c.dataset.need || "(없음)"))], cards: document.querySelectorAll("#orderList .cell[data-key]").length, modes: [...new Set([...document.querySelectorAll("#orderList .risk86 button")].map((b) => b.dataset.mode || "(없음)"))], phase: (document.getElementById("misBar") || {}).dataset?.phase || null, misHidden: (document.getElementById("misBar") || {}).hidden }; });
    await close();
    const V = ["idle", "run", "wait", "ok", "bad"], s = r.s;
    ok(["pre", "open", "night"].includes(s.day) && V.includes(s.order) && V.includes(s.sales.gross) && V.includes(s.sales.menu) && typeof s.pc.alive === "boolean" && typeof s.sync.online === "boolean" && Number.isInteger(s.sync.unsent), `${label} appState: 시간대 ${s.day} · 화면 ${s.view}/${s.tab} · PC ${s.pc.alive ? "켜짐" : "꺼짐"} · 발주 전송 ${s.order} · 매출 ${s.sales.gross}/${s.sales.menu} · 못 보낸 저장 ${s.sync.unsent} · 86 ${s.risk.n}개(${s.risk.modes.join(",") || "-"}) · 상황판 빨강 ${s.health.bad.length}`);
    ok(r.cards > 50 && r.need.every((x) => NEED.includes(x)), `${label} 카드 ${r.cards}개 data-need: ${r.need.join("·")}`);
    ok(r.modes.every((x) => ["counted", "est", "night"].includes(x)) && (s.day !== "night" || r.modes.every((x) => x === "night")), `${label} 86 data-mode: ${r.modes.join("·") || "없음"}`);
    ok(r.misHidden || V.includes(r.phase), `${label} 발주 전송 칸 data-phase: ${r.misHidden ? "(숨김)" : r.phase}`);
    ok(errs.length === 0, `${label} 앱 오류 ${errs.length ? errs[0] : "없음"}`);
  }
}
console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0);
