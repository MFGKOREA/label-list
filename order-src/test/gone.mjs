// 삭제 메뉴·식자재 시험 (11/28 KM "삭제 식자재 및 메뉴 전체 삭제 · 계산 방식에서도 삭제"): 실제 시트 자료로(쓰기는 막음)
// 사용: node order-src/test/gone.mjs <kv.json>   (kv.json은 매장 자료라 저장소에 넣지 마세요)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "../../order.html");
if (!process.argv[2]) { console.log("사용: node gone.mjs <kv.json>"); process.exit(2); }
const kv = fs.readFileSync(process.argv[2], "utf8"), D = JSON.parse(kv).data;
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (c) pass++; else fail++; };
const b = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
const open = async (data) => { const p = await (await b.newContext({ timezoneId: "Asia/Seoul", viewport: { width: 390, height: 844 } })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const body = JSON.stringify({ ok: true, data });
  await p.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? body : '{"ok":true,"data":{}}' }));
  await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await p.goto("file://" + html); await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 }); p.errs = errs; return p; };
const snap = (p) => p.evaluate(() => { const C = window.__orderCalc, M = C.model(), T = C.TODAY;
  const rows = M.items.filter((it) => !it.foh && !it.ledgerOnly).map((it) => { let use = null, none = false; try { const r = C.calc(it.hidden ? { ...it, hidden: false } : it, C.orderWindowFor(it, T), 0, 0); none = !!r.none; use = r.none ? null : r.use; } catch (e) { none = true; } return { n: it.name, hidden: !!it.hidden, A: it.rateA, A0: it.rateA0 != null ? it.rateA0 : it.rateA, Af: it.rateAFull, B: it.rateB, gs: it.goneShare, gf: it.goneFrom, go: !!it.goneOnly, use, none, rr: it._rr, rrRaw: it._rrRaw }; });
  return { rows, gone: [...M.goneRec.keys()], live: M.liveLine.map((r) => r.name), livePrep: M.livePrep.map((r) => r.name), prepN: M.prep.length, risk: C.risk1 ? M.items.filter((i) => !i.ledgerOnly && !i.hidden).map((it) => { try { return C.risk1(it, (C.db["input." + T] || {})[it.key]) ? it.name : null; } catch (e) { return null; } }).filter(Boolean) : [] }; });

const sw = D.menuSwap || {}, wantGone = Object.keys(sw).filter((k) => sw[k] && !sw[k].to);
const P = await open(D), S = await snap(P);
ok(S.gone.length === wantGone.length && wantGone.length >= 10 && S.gone.every((n) => !S.live.includes(n)), `삭제 메뉴 ${S.gone.length}개(menuSwap에서 이어받는 메뉴 없이 끝난 것)는 '지금 파는 레시피'에서 빠짐 · 남은 라인 레시피 ${S.live.length}개`);
console.log("   남은 프랩 중 의심:", S.livePrep.filter((n) => /Tteokbokki|Calamari Fritto_|Acai|Deep Green Juice|Panini Prep|Cooked Rigatoni/.test(n)).join(" | "));
ok(S.livePrep.length < S.prepN && !S.livePrep.some((n) => /Tteokbokki|Calamari Fritto_|Acai|Deep Green Juice|Panini Prep|Cooked Rigatoni/.test(n)), `삭제 메뉴만 쓰던 프랩 ${S.prepN - S.livePrep.length}개도 빠짐 (떡볶이·깔라마리·아사이·파니니·리가토니 등)`);
const R = new Map(S.rows.map((r) => [r.n, r])), has = S.rows.filter((r) => r.gs > 0);
ok(has.length >= 20 && S.rows.every((r) => r.gs >= 0 && r.gs <= 1) && has.every((r) => r.Af == null || Math.abs(r.A0 - r.Af * (1 - r.gs)) < 1e-9), `삭제 메뉴 몫이 있는 품목 ${has.length}개: 몫은 0~1, A = 빼기 전 × (1 − 몫) (추세를 곱하기 전 값으로 확인)`);
ok(S.rows.filter((r) => !(r.gs > 0)).every((r) => r.Af == null), "삭제 메뉴와 상관없는 품목의 A는 그대로");
const only = S.rows.filter((r) => r.go);
ok(only.every((r) => r.none || !(r.use > 1e-6)), `삭제 메뉴에만 쓰던 품목은 사용량 0: ${only.map((r) => r.n).join(", ") || "없음"}`);
const pick = (re) => S.rows.find((r) => re.test(r.n));
const honey = pick(/허니갈릭소스/), spa = pick(/스파게티니/), sal = pick(/샐러드믹스베이스/);
ok(honey && honey.gs > 0.5 && honey.A < honey.Af * 0.5, `허니 갈립 타워에 주로 쓰던 허니갈릭소스: 몫 ${(honey.gs * 100).toFixed(0)}% · A ${honey.Af.toFixed(3)} → ${honey.A.toFixed(3)}`);
ok(spa && spa.gs < 0.05, `파스타가 같이 쓰는 스파게티니는 거의 안 줄어듦(삭제 파스타 손님은 남은 파스타로): 몫 ${(spa.gs * 100).toFixed(1)}%`);
ok(sal && sal.gs < 0.1, `샐러드믹스베이스 몫 ${(sal.gs * 100).toFixed(1)}%`);
const rrAdj = S.rows.filter((r) => r.rrRaw != null);
ok(rrAdj.every((r) => r.rr <= r.rrRaw + 1e-12 && r.rr >= r.rrRaw * (1 - r.gs) - 1e-12), `최근 15일 실제(센 값)는 삭제일 전 기간만큼만 덜어 냄: ${rrAdj.length}개 품목, 모두 (1 − 몫) ~ 1배 사이`);
ok(!S.risk.some((n) => (R.get(n) || {}).hidden), "숨긴 품목은 86 위험에 안 나옴");

// 삭제 표시를 지우면(menuSwap 없음) 예전 계산 그대로 → 줄어드는 쪽으로만 바뀌는지, 계산 방식(A·B 유무)이 뒤집히지 않는지
const P0 = await open({ ...D, menuSwap: Object.fromEntries(Object.entries(sw).filter(([, v]) => v && v.to)) }), S0 = await snap(P0), R0 = new Map(S0.rows.map((r) => [r.n, r]));
ok(S0.gone.length === 0 && S0.rows.every((r) => !(r.gs > 0) && r.Af == null), "삭제 메뉴가 없으면 몫 0 (계산에 손대지 않음)");
// (삭제 표시가 없을 때의 B에는 삭제 메뉴 판매가 들어 있어, 11/26부터 B에서 빼던 것까지 되돌린 값과 견줌)
const cmp = S.rows.filter((r) => R0.get(r.n) && r.use != null && R0.get(r.n).use != null).map((r) => ({ n: r.n, a: R0.get(r.n).use, b: r.use, gs: r.gs, A0: R0.get(r.n).A, B0: R0.get(r.n).B, A: r.A, B: r.B }));
const up = cmp.filter((x) => x.b > x.a * 1.02 + 1e-6);
ok(up.length === 0, `삭제 때문에 사용량이 늘어난 품목 없음 (${cmp.length}개 비교)` + (up.length ? " — " + up.slice(0, 5).map((x) => `${x.n} ${x.a.toFixed(2)}→${x.b.toFixed(2)}`).join(", ") : ""));
const same = cmp.filter((x) => !(x.gs > 0) && !(S.rows.find((r) => r.n === x.n) || {}).gf);
ok(same.every((x) => Math.abs(x.b - x.a) <= Math.max(1e-6, x.a * 0.02)), `삭제 메뉴와 상관없는 품목 ${same.length}개의 사용량은 그대로(±2%)`);

// 화면: 레시피 연결 확인에 삭제 메뉴 재료가 안 나옴 · 메뉴 고르기에도 삭제 메뉴가 없음
await P.evaluate(() => window.__go("files:recipe")); await P.waitForTimeout(700);
const mp = await P.evaluate(() => ({ count: document.querySelector("#mapCount").textContent, txt: document.querySelector("#mapList").innerText, opts: [...new Set([...document.querySelectorAll("#mapList select option")].map((o) => o.value))] }));
ok(!/치아바타 브레드|보코치니 치즈/.test(mp.txt) && !S.gone.some((n) => mp.opts.includes(n)), `레시피 연결 확인: 삭제 메뉴 재료·삭제 메뉴 이름이 없음 (${mp.count})`);
ok(!P.errs.length && !P0.errs.length, "화면 오류 없음 " + P.errs.concat(P0.errs).join(" / "));
console.log(`삭제 메뉴 시험 통과 ${pass} · 실패 ${fail}`);
await b.close();
process.exit(fail ? 1 : 0);
