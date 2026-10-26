// 매출 불러오기 시험 (가짜 MIS + 가짜 Apps Script): mis-sales.js
//  1) 메뉴별 매출현황 하루씩 → 시트 menuDay.날짜 (합계 줄 빼고, 이미 있는 날은 건너뜀)
//  2) 예전 Gross 불러오기(MiscellaneousReport)도 그대로 되는지
// 사용: node order-src/test/gw/e2e-sales.mjs
import path from "path";
import { fileURLToPath } from "url";
import { load } from "../gas/sim.mjs";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const gas = load(REPO + "/apps-script/order/Code.gs");
let fails = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ timezoneId: "Asia/Seoul" });
await ctx.route("https://script.google.com/**", async (r) => {
  const q = r.request();
  const body = q.method() === "GET" ? gas.get(Object.fromEntries(new URL(q.url()).searchParams)) : gas.post(JSON.parse(q.postData()));
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});
await ctx.route("https://mis.test/**", (r) => r.fulfill({ path: HERE + "/mock/" + new URL(r.request().url()).pathname.slice(1) }));
await ctx.route("https://mfgkorea.github.io/label-list/mis-sales.js*", (r) => r.fulfill({ path: REPO + "/mis-sales.js", contentType: "text/javascript" }));
const run = async (job) => {
  gas.post({ action: "set", key: "salesPush", value: { id: Date.now(), at: Date.now(), status: "pending", ...job } });
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("page err", e.message)); p.on("dialog", (d) => d.accept());
  await p.goto("https://mis.test/sales-main.html"); await p.waitForTimeout(300);
  await p.evaluate(() => { const s = document.createElement("script"); s.src = "https://mfgkorea.github.io/label-list/mis-sales.js?quiet=1&t=" + Date.now(); document.body.appendChild(s); });
  for (let i = 0; i < 120 && /pending|running/.test(gas.get({ api: "1" }).data.salesPush.status); i++) await p.waitForTimeout(500);
  await p.close();
  return gas.get({ api: "1" }).data;
};
// 1) 메뉴별: 10/23(금)은 이미 있다고 두고 건너뛰는지
gas.post({ action: "set", key: "menuDay.2026-10-23", value: { at: 1, rows: [{ c: "x", m: "y", q: 1 }] } });
let d = await run({ kind: "menu", from: "2026-10-19", to: "2026-10-25" });
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(d.salesPush.status === "done", "메뉴별 불러오기 끝남");
const days = Object.keys(d).filter((k) => k.startsWith("menuDay.")).sort();
ok(days.length === 7, `menuDay ${days.length}일 (7일)`);
ok(d["menuDay.2026-10-23"].rows[0].m === "y", "이미 있던 날은 다시 안 받음");
const sat = d["menuDay.2026-10-24"].rows, mon = d["menuDay.2026-10-19"].rows;
ok(sat.find((r) => r.m === "매드 스테이크 & 치킨 플래터" && r.c === "스테이크").q === 40 && mon.find((r) => r.m.includes("플래터")).q === 6, "주말·평일 수량이 날짜별로 따로");
ok(!sat.some((r) => /합계/.test(r.c + r.m)), "합계 줄은 뺌");
ok(sat.some((r) => r.c === "Brunch_Plates"), "중분류(브런치)까지 같이");
// 2) Gross 불러오기도 그대로
gas.post({ action: "set", key: "forecast", value: { "2026-10-20": { fc: "3000000", act: "" } } });
d = await run({ from: "2026-10-20", to: "2026-10-24" });
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(d.salesPush.status === "done" && d.forecast["2026-10-24"].act === "16366000", "Gross 불러오기 그대로 됨");
await b.close();
console.log(`합계: 통과 ${7 - fails} · 실패 ${fails}`);
process.exitCode = fails ? 1 : 0;
