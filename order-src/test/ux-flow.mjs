import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const HTML = "file://" + path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../order.html");
// 사용: node order-src/test/ux-flow.mjs <kv.json이 있는 폴더>  (결과·캡처도 그 폴더에. 시트에는 안 씀 — 요청은 모두 가짜 응답)
const S = process.argv[2]; if (!S) { console.log("사용: node ux-flow.mjs <kv.json 폴더>"); process.exit(2); }
const kv = fs.readFileSync(S + "/kv.json", "utf8");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Seoul", hasTouch: true, isMobile: true }); const p = await ctx.newPage();
const posts = [], errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
await p.route("https://script.google.com/**", (r) => { if (r.request().method() !== "GET") posts.push(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? kv : '{"ok":true,"data":{}}' }); });
let fails = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fails++; };
const cur = () => p.locator('#dock [aria-current="page"]').textContent();
await p.goto(HTML); await p.waitForTimeout(2500);
await p.click('#dock [data-dock="foh"]'); await p.waitForTimeout(700);
ok((await cur()) === "FOH 발주" && (await p.textContent("#mainTitle")) === "FOH 발주", "FOH 탭: 독·제목");
await p.click('#dock [data-dock="forecast"]'); await p.waitForTimeout(500);
await p.evaluate(() => document.querySelector('.view:not([hidden]) .back').click()); await p.waitForTimeout(500);
ok((await cur()) === "FOH 발주" && (await p.textContent("#mainTitle")) === "FOH 발주" && (await p.locator("#orderList .cell").count()) > 40, "Forecast 갔다 뒤로: 독·제목·목록이 FOH 그대로 · 독=" + (await cur()));
await p.fill("#q", "테너"); await p.waitForTimeout(500);
const names = await p.locator("#orderList .cell .c-name").allTextContents();
ok(names.length === 2 && names.every((n) => /테너/.test(n)), "FOH 검색 '테너' → " + names.join(", "));
await p.fill("#q", "등심"); await p.waitForTimeout(500);
ok((await p.locator("#orderList .cell").count()) === 0 && !(await p.isHidden("#nores")), "FOH에서 BOH 품목(등심) 검색 → 0개 · '검색 결과가 없습니다' 보임=" + !(await p.isHidden("#nores")));
await p.fill("#q", ""); await p.waitForTimeout(400);
// 계산 카드(온세물류): 재고·발주 입력
const c1 = p.locator('#orderList .cell', { hasText: "테너베이스레몬" }).first(); const ins = c1.locator("input");
await ins.nth(0).fill("2"); await ins.nth(0).blur(); await p.waitForTimeout(900);
ok(posts.some((x) => /input\.2026/.test(x) && /테너베이스레몬/.test(x) && /"s":"2"/.test(x)), "FOH 계산 카드 재고 2 → 시트 저장(merge)");
const need = await p.locator('#orderList .cell', { hasText: "테너베이스레몬" }).first().getAttribute("data-need");
ok(/buy|enough|offday/.test(need || ""), "재고 넣으면 필요량 상태가 바뀜: " + need);
// 재고·발주만 카드(롯데칠성)
await p.click('#cats button:nth-child(3)'); await p.waitForTimeout(500);
const c2 = p.locator("#orderList .cell").first(), n2 = await c2.locator(".c-name").textContent(); const in2 = c2.locator("input");
await in2.nth(1).fill("2"); await in2.nth(1).blur(); await p.waitForTimeout(900);
const c2b = p.locator('#orderList .cell', { hasText: n2 }).first();
ok((await c2b.getAttribute("data-need")) === "done" && /발주완료/.test(await c2b.textContent()), `재고·발주만 카드(${n2}) 발주 2 → 발주완료`);
ok(/GW 전송 1/.test(await p.textContent("#misBar")), "GW 전송 개수에 FOH 발주 포함: " + (await p.textContent("#misBar")).replace(/\s+/g, " ").slice(0, 40));
await p.click('#dock [data-dock="order"]'); await p.waitForTimeout(600);
ok((await p.textContent("#mainTitle")) === "발주량 계산" && (await p.locator("#cats button").count()) === 4 && !(await p.locator("#orderList .cell", { hasText: "테너베이스" }).count()), "발주 탭으로: BOH 목록만 · 업체 4칩");
await p.click('#dock [data-dock="prep"]'); await p.waitForTimeout(500); await p.click('#dock [data-dock="foh"]'); await p.waitForTimeout(600);
ok((await p.textContent("#mainTitle")) === "FOH 발주" && !(await p.isHidden("#pOrder")), "프랩 → FOH 발주: 제목·목록");
ok(errs.length === 0, "화면 오류 0 " + errs.join(" | "));
console.log(fails ? `실패 ${fails}` : "모두 통과"); await b.close(); process.exitCode = fails ? 1 : 0;
