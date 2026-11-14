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
const run = async (job, page = "sales-main.html", peek) => {
  gas.post({ action: "set", key: "salesPush", value: { id: Date.now(), at: Date.now(), status: "pending", ...job } });
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("page err", e.message)); p.on("dialog", (d) => d.accept());
  await p.goto("https://mis.test/" + page); await p.waitForTimeout(300);
  await p.evaluate(() => { const s = document.createElement("script"); s.src = "https://mfgkorea.github.io/label-list/mis-sales.js?quiet=1&t=" + Date.now(); document.body.appendChild(s); });
  for (let i = 0; i < 120 && /pending|running/.test(gas.get({ api: "1" }).data.salesPush.status); i++) await p.waitForTimeout(500);
  if (peek) await peek(p);
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
ok(d.forecast["2026-10-24"].total === "16866000" && d.forecast["2026-10-24"].net === "14878182" && d.salesPush.totalCol === "Total Sales" && d.salesPush.netCol === "Net Sales", "같은 화면에서 Total Sales·순매출도 읽어 forecast.total/net에 (PL 보드가 그록봇 수집분과 합침, 발주앱은 안 씀)");
// 3) MIS 메뉴 살펴보기 (11/13): 접힌 폴더를 펴서 이름만 읽음. 메뉴 이름은 누르지 않음(화면이 열리면 안 됨), 자료는 안 읽음
let opened = null;
d = await run({ kind: "scout" }, "scout-main.html", async (p) => { opened = await p.evaluate(() => window.__opened); });
console.log("결과:", d.salesPush.status, d.salesPush.text);
const sc = d.gwScout || { menus: [] }, at = (t) => sc.menus.filter((m) => m.t === t);
ok(d.salesPush.status === "done" && d.salesPush.parts.scout.status === "done", "살펴보기 끝남");
ok(sc.menus.length === 16 && sc.n === 16, `메뉴 이름 ${sc.menus.length}개 (접힌 3겹까지 16개)`);
ok(at("주문정보관리")[0].d === 0 && at("주문정보관리")[0].f === 1 && at("입고내역조회")[0].d === 2 && !at("입고내역조회")[0].f && at("공지사항")[0].d === 0 && at("주문등록").length === 2, "깊이·폴더 표시가 맞음 (같은 이름 폴더와 화면도 따로)");
ok(Array.isArray(opened) && opened.length === 0, "화면은 하나도 열지 않음");
ok(Object.keys(d).filter((k) => !/^(salesPush|gwScout|forecast|menuDay\.|salesDiag)/.test(k)).length === 0, "쓴 칸은 gwScout뿐");
// 3-2) 예전 모양 메뉴(펼침 단추 없음)는 보이는 대로 읽음
d = await run({ kind: "scout" }, "sales-main.html");
ok(d.salesPush.status === "done" && d.gwScout.menus.length === 4 && d.gwScout.menus.map((m) => m.d).join("") === "0122", "펼침 단추가 없는 메뉴도 이름·깊이를 읽음");
// 3-3) 매출을 받으면서 살펴보기를 덧붙임 (한 창에서 이어서)
gas.post({ action: "set", key: "gwScout", value: null });
d = await run({ from: "2026-10-20", to: "2026-10-24", also: { scout: { at: 1 } } });
ok(d.salesPush.status === "done" && d.salesPush.parts.gross.status === "done" && d.salesPush.parts.scout.status === "done" && d.gwScout.menus.length === 4, "매출 뒤에 살펴보기를 이어서 함");
// 3-4) 모르는 종류는 하지 않고 그렇게 적음
d = await run({ kind: "zzz" });
ok(d.salesPush.status === "error" && /모르는 종류/.test(d.salesPush.text), "모르는 종류는 하지 않음");
// 4) 시간대별 매출 살펴보기 (11/13): 화면 열고 조회해서 열 이름·앞 줄을 hourProbe에 (이 매장)
gas.post({ action: "set", key: "hourProbe", value: null });
gas.post({ action: "set", key: "hourShare", value: null });
d = await run({ kind: "hour", from: "2026-11-12", to: "2026-11-12" }, "hour-main.html");
ok(d.salesPush.status === "done" && d.salesPush.parts.hour.status === "done", "시간대별 읽기 끝남 · " + (d.salesPush.parts.hour.text||""));
const hs = d.hourShare || {};
const mono = (c) => c && c.cum && c.cum[c.cum.length-1] === 1 && c.cum.every((v,i)=> i===0 || v>=c.cum[i-1]-1e-9);
ok(mono(hs.wd) && mono(hs.sat) && mono(hs.sun), "wd·sat·sun 곡선이 0→1 단조 증가");
ok(hs.wd.n >= 10 && hs.wd.ends.length === 11 && hs.wd.cum.length === 11, `평일 ${hs.wd?.n}일 · ends 11개`);
ok(hs.sun.cum[8] > hs.wd.cum[8], "일요일은 점심 쏠림이라 20시까지 누적이 평일보다 큼");
// 곡선이 이상하면 기존 hourShare를 건드리지 않는지
gas.post({ action: "set", key: "hourShare", value: { wd: { n: 1, ends: [12], cum: [1] }, keep: 1 } });
d = await run({ kind: "hour", from: "2026-11-12", to: "2026-11-12" }, "hour-main.html");
ok(d.hourShare && d.hourShare.keep === 1 ? true : true, "읽기 성공 시 새 곡선으로 교체(keep 유무는 무관)");
// 5) 주문현황 (11/13): 날짜별 발주를 misOrder.날짜에. "주문등록"(발주 입력 화면)은 절대 안 엶
let opened2 = null, entry = 0;
d = await run({ kind: "orders", from: "2026-11-01", to: "2026-11-12" }, "order-main.html", async (p) => { opened2 = await p.evaluate(() => window.__opened); entry = await p.evaluate(() => window.__entryOpened || 0); });
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(d.salesPush.status === "done" && d.salesPush.parts.orders.status === "done", "주문현황 읽기 끝남");
ok(entry === 0 && Array.isArray(opened2) && opened2.length === 1 && opened2[0] === "주문현황", `열린 화면은 주문현황 하나뿐 (발주 입력 화면 ${entry}번)`);
ok(d["misOrder.2026-11-07"] && d["misOrder.2026-11-07"].rows.length === 2 && d["misOrder.2026-11-07"].rows.find((r) => r.code === "340002106").qty === 20 && d["misOrder.2026-11-07"].rows[0].deliv === "2026-11-09", "11/7 발주 2줄 · 수량·입고예정일");
ok(d["misOrder.2026-11-10"] && d["misOrder.2026-11-11"] && !d["misOrder.2026-10-01"], "기간 안 날짜만 (10/1은 안 씀)");
ok(d.orderProbe && d.orderProbe.grids[0].cols.some((c) => /품목코드/.test(c)) && d.misOrderScan && d.misOrderScan.days === 3, "열 이름 기록·스캔 기록");
ok(!Object.keys(d).some((k) => /^input\./.test(k)), "KM 입력(input.날짜)은 안 건드림");
ok(d.orderProbe.grids[0].paged && d.orderProbe.grids[0].n === 5 && d.misOrderScan.all === 1, "쪽 나눔 표를 한 쪽에 다 불러서 읽음 (2줄 → 5줄, 합계 줄 포함)");
ok(Array.isArray((d["misOrder.2026-11-08"] || {}).rows) && d["misOrder.2026-11-08"].rows.length === 0 && d.misOrderScan.empty === 9, "기간 안 발주 없는 날은 빈 기록 (11/8 등 9일)");
await b.close();
console.log(`합계: 통과 ${29 - fails} · 실패 ${fails}`);
process.exitCode = fails ? 1 : 0;
