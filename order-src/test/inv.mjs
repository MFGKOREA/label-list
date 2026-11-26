// 인벤토리 탭 시험 (11/26 KM 월재고마감): 실제 시트 자료로(쓰기는 막음) 독 자리·프랩 환산·합계를 봅니다.
// 사용: node order-src/test/inv.mjs <kv.json>   (kv.json은 매장 자료라 저장소에 넣지 마세요)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "../../order.html");
if (!process.argv[2]) { console.log("사용: node inv.mjs <kv.json>"); process.exit(2); }
const kv = fs.readFileSync(process.argv[2], "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (c) pass++; else fail++; };
const b = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const posts = [];
await p.route("https://script.google.com/**", (r) => {
  if (r.request().method() !== "GET") posts.push(r.request().postData());
  r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? kv : '{"ok":true,"data":{}}' });
});
await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
await p.goto("file://" + html);
await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 });

const dock = await p.$$eval("#dock [data-dock]", (a) => a.map((x) => x.dataset.dock));
ok(dock.indexOf("inv") === dock.indexOf("prep") + 1 && dock.indexOf("forecast") === dock.indexOf("inv") + 1, "독: 프랩 | 인벤토리 | Forecast 순서 " + dock.join(","));
const rows = await p.$$eval("#dock button", (a) => new Set(a.map((x) => Math.round(x.getBoundingClientRect().top))).size);
ok(rows === 1, "독이 한 줄 (390px)");

await p.click("#dock [data-dock=inv]");
await p.waitForTimeout(300);
ok(!(await p.$eval("#v-inv", (v) => v.hidden)) && (await p.$$("#invBody input[data-part=raw]")).length > 50, "인벤토리 화면 · 원자재 칸");

// 프랩 연결: 11/25 새 레시피에서 번호가 바뀌어도 이름으로 (매시드 포테이토 → Mashed Potato)
const map = Object.fromEntries((await p.evaluate(() => window.__orderCalc.invPreps())).map((x) => [x.name, x.pdf]));
ok(map["매시드 포테이토"] === "Mashed Potato" && map["소테 새우"] === "Saute Shrimp" && map["튀긴 새송이 포션"] === "Fried Oyster Mushrooms portion" && map["갈릭 어니언 크럼블"] === "Garlic Onion Crumble", "프랩 이름 연결 (번호가 바뀐 프랩)");

// 매시드 포테이토 1X = 루토사 매쉬 1PK + 매드크림 900g(2.5kg 통의 0.36) + 버터 80g (레시피)
await p.click("#invSeg [data-iv=prep]");
await p.waitForTimeout(200);
await p.evaluate(() => {
  const i = [...document.querySelectorAll("#invBody input[data-part=prep]")].find((x) => x.getAttribute("aria-label") === "매시드 포테이토 재고");
  i.value = "2"; i.dispatchEvent(new Event("change", { bubbles: true }));
});
await p.waitForTimeout(200);
const conv = await p.evaluate(() => [...document.querySelectorAll("#invBody .inv-row.prep")].find((r) => /매시드 포테이토/.test(r.textContent)).querySelector(".inv-conv").textContent);
ok(/매쉬포테이토\S* 2PK/.test(conv) && /매드크림소스\S* 0\.72EA/.test(conv), "매시드 포테이토 2X → 원재료: " + conv);

// 11/26 KM "레시피 상 일드·환산량으로": 마늘쫑 포션 1포션 = 냉동 마늘종 40g → 25포션 = 1kg = 냉동마늘쫑 1EA
await p.evaluate(() => {
  const i = [...document.querySelectorAll("#invBody input[data-part=prep]")].find((x) => x.getAttribute("aria-label") === "마늘쫑 포션 또잉 재고");
  i.value = "25"; i.dispatchEvent(new Event("change", { bubbles: true }));
});
await p.waitForTimeout(200);
const scape = await p.evaluate(() => [...document.querySelectorAll("#invBody .inv-row.prep")].find((r) => /마늘쫑 포션/.test(r.textContent)).querySelector(".inv-conv").textContent);
ok(/1포션 = 40g/.test(scape) && /냉동마늘쫑\S* 1EA/.test(scape), "마늘쫑 포션 25 → 냉동마늘쫑 1EA (1포션 40g): " + scape);

// 소분(KM: 감자튀김 등): 원자재 줄에 포션 칸이 처음부터 열림, 1포션 g = 레시피(감자튀김 200g) → 10포션 = 2kg = 1PK
await p.click("#invSeg [data-iv=raw]");
await p.waitForTimeout(200);
const fries = await p.evaluate(() => { const r = [...document.querySelectorAll("#invBody .inv-row")].find((x) => /냉동감자튀김/.test(x.textContent)); return r && r.querySelector("input[data-part=subg]") ? r.querySelector("input[data-part=subg]").value : null; });
ok(fries === "200", "감자튀김 소분 칸 · 1포션 200g (레시피)");
await p.evaluate(() => { const i = [...document.querySelectorAll("#invBody input[data-part=sub]")].find((x) => /냉동감자튀김/.test(x.getAttribute("aria-label"))); i.value = "10"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(200);
const fsub = await p.evaluate(() => [...document.querySelectorAll("#invBody .inv-row")].find((x) => /냉동감자튀김/.test(x.textContent)).querySelector(".inv-sub").textContent);
ok(/= 1PK/.test(fsub), "감자튀김 소분 10포션 = 1PK: " + fsub.replace(/\s+/g, " "));
await p.evaluate(() => {
  const i = [...document.querySelectorAll("#invBody input[data-part=raw]")].find((x) => /매드크림소스/.test(x.getAttribute("aria-label")));
  i.value = "3"; i.dispatchEvent(new Event("change", { bubbles: true }));
});
await p.click("#invSeg [data-iv=sum]");
await p.waitForTimeout(200);
const sum = await p.evaluate(() => [...document.querySelectorAll(".inv-t tbody tr")].map((r) => [...r.children].map((c) => c.textContent)));
const cream = sum.find((r) => /매드크림소스/.test(r[0]));
ok(cream && cream[1] === "3" && cream[3] === "0.72" && /^3\.72/.test(cream[4]), "합계: 원자재 3 + 프랩 0.72 = 3.72 " + JSON.stringify(cream));
const fr = sum.find((r) => /냉동감자튀김/.test(r[0]));
ok(fr && fr[2] === "1" && /^1PK/.test(fr[4]), "합계: 감자튀김 소분 1PK " + JSON.stringify(fr));
ok(posts.some((x) => /"key":"inv\./.test(x || "")), "넣은 값은 시트 inv.날짜에 저장");
const fohIn = await p.evaluate(() => { const M = window.__orderCalc.model(); const foh = new Set(M.items.filter((i) => i.foh).map((i) => i.key)); return [...document.querySelectorAll("#invBody .inv-t tbody tr, #invBody .inv-row")].length >= 0 && foh.size; });
await p.click("#invSeg [data-iv=raw]"); await p.waitForTimeout(200);
const fohRows = await p.evaluate(() => { const M = window.__orderCalc.model(); const foh = new Set(M.items.filter((i) => i.foh).map((i) => i.key)); return [...document.querySelectorAll("#invBody .inv-row[data-key]")].filter((r) => foh.has(r.dataset.key)).length; });
ok(fohIn > 0 && fohRows === 0 && !(await p.$$eval(".inv-h", (a) => a.some((x) => x.textContent === "FOH"))), `FOH 품목은 인벤토리에서 뺌 (FOH ${fohIn}개)`);
const supRows = await p.evaluate(() => [...document.querySelectorAll(".inv-h")].map((x) => x.textContent).filter((t) => /소모품/.test(t)).length + [...document.querySelectorAll("#invBody .inv-row[data-key]")].filter((r) => /장갑|세제|락스|유니랩|호일|봉투/.test(r.textContent)).length);
ok(supRows === 0, "소모품·세제는 인벤토리에서 뺌");
// 최첨단판(11/26): 더하기 셈 · MIS 단위(계란 판=30개) · 예상과 차이 · 안 센 것 거르기
const setRaw = (re, v) => p.evaluate(([re, v]) => { const i = [...document.querySelectorAll("#invBody input[data-part=raw]")].find((x) => new RegExp(re).test(x.getAttribute("aria-label"))); i.value = v; i.dispatchEvent(new Event("change", { bubbles: true })); }, [re, v]);
await p.click("#invSeg [data-iv=raw]"); await p.waitForTimeout(200);
await setRaw("계란", "60+30");
await setRaw("꿀\\(사양벌꿀\\)", "3+2+0.5");
const honey = await p.evaluate(() => [...document.querySelectorAll("#invBody .inv-row")].find((r) => /꿀\(사양벌꿀\)/.test(r.textContent)).querySelector(".inv-eq").textContent);
ok(honey === "= 5.5", "더하기 셈 3+2+0.5 = 5.5");
const rowsAll = await p.evaluate(() => window.__orderCalc.invRows());
const egg = rowsAll.find((r) => /계란/.test(r.name));
ok(egg && egg.mis === "판" && Math.abs(egg.f - 1 / 30) < 1e-3, "계란: 앱 EA → MIS 판(30개) 환산 " + JSON.stringify(egg));
ok(rowsAll.some((r) => r.misOnly) && !rowsAll.some((r) => /와인|Sauvignon|콜라|사이다/.test(r.name)), "MIS에만 있는 품목도 셈 · 주류·음료는 뺌");
await p.click("#invFilt [data-f=todo]"); await p.waitForTimeout(150);
const todoHasEgg = await p.evaluate(() => [...document.querySelectorAll("#invBody .inv-row")].some((r) => /계란/.test(r.textContent)));
ok(!todoHasEgg, "안 센 것: 센 품목(계란)은 안 보임");
await p.click("#invFilt [data-f=all]");
await p.click("#invSeg [data-iv=sum]"); await p.waitForTimeout(200);
const eggSum = await p.evaluate(() => { const r = [...document.querySelectorAll(".inv-t tbody tr")].find((x) => /계란/.test(x.textContent)); return r && [...r.children].map((c) => c.textContent); });
ok(eggSum && /^3판/.test(eggSum[4]), "합계: 계란 90개 = MIS 3판 " + JSON.stringify(eggSum));
ok(!(await p.$("#invPrintBtn")) && !(await p.$("#invPrint")), "종이 점검표는 없음 (11/26 KM 삭제)");
ok(!errs.length, "화면 오류 없음 " + errs.join(" / "));
console.log(`인벤토리 시험 통과 ${pass} · 실패 ${fail}`);
await b.close();
process.exit(fail ? 1 : 0);
