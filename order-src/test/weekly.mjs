// 7일마다 세기·급변 확인 화면 시험 (11/15): 시트 사본으로 그날 아침을 열어 접힌 칸·검색·급변 확인창(취소/확인)을 봄. 쓰기는 가짜 응답
// 사용: node order-src/test/weekly.mjs <kv.json> [날짜 2026-11-16] [사진 폴더]   (kv.json은 매장 데이터라 저장소에 넣지 않음)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const here = path.dirname(fileURLToPath(import.meta.url)), html = path.resolve(here, "../../order.html");
const [kvPath, day = "2026-11-16", shotDir] = process.argv.slice(2);
if (!kvPath) { console.log("사용: node weekly.mjs <kv.json> [날짜] [사진 폴더]"); process.exit(2); }
const kv = fs.readFileSync(kvPath, "utf8");
const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ timezoneId: "Asia/Seoul", viewport: { width: 390, height: 844 }, deviceScaleFactor: shotDir ? 2 : 1 });
const p = await ctx.newPage();
const posts = [], errs = []; let fail = 0;
const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fail++; };
p.on("pageerror", (e) => errs.push(e.message));
await p.route("https://script.google.com/**", (r) => { const m = r.request().method(); if (m !== "GET") posts.push(r.request().postData() || ""); r.fulfill({ status: 200, contentType: "application/json", body: m === "GET" ? kv : '{"ok":true,"data":{}}' }); });
await p.clock.setFixedTime(new Date(day + "T09:30:00+09:00"));
await p.goto("file://" + html);
await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.addStyleTag({ content: "#dock{display:none!important}" });
// 1) 접힌 칸
const f1 = await p.evaluate(() => { const d = document.querySelector("#orderList details.weekly"); return d ? { n: +d.querySelector("summary small").textContent, open: d.open, cells: d.querySelectorAll(".cell").length, main: document.querySelectorAll("#orderList > .group .cell").length } : null; });
ok(f1 && f1.n > 0 && !f1.open && f1.cells === 0, `접힌 칸: ${f1 ? f1.n : 0}개, 닫힘, 펼치기 전엔 안 그림 (목록 ${f1 ? f1.main : 0}개)`);
if (shotDir) { await p.evaluate(() => document.querySelector("#orderList details.weekly").scrollIntoView({ block: "center" })); await p.waitForTimeout(300); await p.screenshot({ path: shotDir + "/1-folded.png" }); }
await p.click("#orderList details.weekly > summary"); await p.waitForTimeout(400);
const f2 = await p.evaluate(() => { const d = document.querySelector("#orderList details.weekly"); return { open: d.open, cells: d.querySelectorAll(".cell").length, chip: (d.querySelector(".chip.wk") || {}).textContent || "" }; });
ok(f2.open && f2.cells === f1.n && /^다음 \d\d\.\d\d$/.test(f2.chip), `펼침: 칸 ${f2.cells}개, 칩 "${f2.chip}"`);
if (shotDir) { await p.evaluate(() => document.querySelector("#orderList details.weekly").scrollIntoView({ block: "start" })); await p.waitForTimeout(300); await p.screenshot({ path: shotDir + "/2-open.png" }); }
// 2) 검색하면 목록에 보임
const nm = await p.evaluate(() => document.querySelector("#orderList details.weekly .cell .c-name").firstChild.textContent);
await p.fill("#q", nm); await p.waitForTimeout(400);
const s1 = await p.evaluate((nm) => ({ main: [...document.querySelectorAll("#orderList > .group .cell .c-name")].some((e) => e.firstChild.textContent === nm), det: !!document.querySelector("#orderList details.weekly") }), nm);
ok(s1.main && !s1.det, `검색 "${nm}": 목록에 보임, 접힌 칸 없음`);
await p.fill("#q", ""); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.querySelector("#orderList details.weekly").open), "검색을 지워도 펼친 상태 그대로");
// 3) 급변 확인: 목록에 보이는 품목 중 직전에 센 값의 11배가 '묻기'인 것
const pick = await p.evaluate(() => {
  const C = window.__orderCalc, db = C.db(), T = C.TODAY, add = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  for (const el of document.querySelectorAll("#orderList > .group .cell[data-key]")) {
    const it = C.model().items.find((i) => i.key === el.dataset.key); if (!it || (db["input." + T] || {})[it.key]) continue;
    for (let k = 1; k <= 3; k++) { const r = (db["input." + add(T, -k)] || {})[it.key]; if (r && r.s !== "" && !r.est && Number(r.s) >= 2) { const a = Number(r.s) * 11, j = C.jumpOf(it, a); if (j && j.hard) return { key: it.key, name: it.name, a, b: Number(r.s) }; break; } }
  }
  return null;
});
ok(!!pick, `시험 품목: ${pick ? `${pick.name} ${pick.b} → ${pick.a}` : "없음"}`);
if (pick) {
  const cell = p.locator(`#orderList > .group .cell[data-key="${pick.key}"]`), inp = cell.locator("input").first();
  let msg = ""; p.once("dialog", async (d) => { msg = d.message(); await d.dismiss(); });
  const n0 = posts.length; await inp.fill(String(pick.a)); await inp.press("Tab"); await p.waitForTimeout(1500);
  const v1 = await inp.inputValue(), saved1 = posts.slice(n0).some((x) => x.includes(pick.key) && x.includes(`"s":"${pick.a}"`));
  ok(/맞나요/.test(msg) && msg.includes(`${pick.b} → 오늘 ${pick.a}`), `확인창: "${msg.replace(/\n/g, " / ")}"`);
  ok(v1 === "" && !saved1, `[취소]: 칸 비움("${v1}"), 저장 안 함`);
  msg = ""; p.once("dialog", async (d) => { msg = d.message(); await d.accept(); });
  const n1 = posts.length; await inp.fill(String(pick.a)); await inp.press("Tab"); await p.waitForTimeout(2500);
  const saved2 = posts.slice(n1).some((x) => x.includes(pick.key) && x.includes(String(pick.a)));
  ok(!!msg && saved2, "[확인]: 저장함");
  // 같은 값은 다시 안 물음 (발주칸을 바꿔도)
  let asked = false; p.once("dialog", async (d) => { asked = true; await d.accept(); });
  const o = cell.locator("input").nth(1); await o.fill("1"); await o.press("Tab"); await p.waitForTimeout(800);
  ok(!asked, "발주칸을 바꿀 땐 다시 안 물음");
  p.removeAllListeners("dialog");
}
ok(errs.length === 0, "페이지 오류 " + (errs.length ? errs.slice(0, 2).join(" | ") : "없음"));
await b.close();
console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0);
