// 매출 불러오기 시험 (가짜 MIS + 가짜 Apps Script): mis-sales.js
//  1) 메뉴별 매출현황 하루씩 → 시트 menuDay.날짜 (합계 줄 빼고, 이미 있는 날은 건너뜀)
//  2) 예전 Gross 불러오기(MiscellaneousReport)도 그대로 되는지
//  합계 대조(11/15): 메뉴·Gross·세트 모두 화면 합계와 읽은 합이 다르면 결과 글에 ⚠ (저장은 그대로). SUM_BLOCK을 켜면 그날은 저장 안 함
// 사용: node order-src/test/gw/e2e-sales.mjs
import path from "path";
import { fileURLToPath } from "url";
import { load } from "../gas/sim.mjs";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const gas = load(REPO + "/apps-script/order/Code.gs");
let fails = 0, oks = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fails++; else oks++; };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ timezoneId: "Asia/Seoul" });
await ctx.route("https://script.google.com/**", async (r) => {
  const q = r.request();
  const body = q.method() === "GET" ? gas.get(Object.fromEntries(new URL(q.url()).searchParams)) : gas.post(JSON.parse(q.postData()));
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});
const pushes = []; // 한글표시사항 앱(수원) 알림 (11/26 라인체크 X)
await ctx.route("https://script.google.com/macros/s/AKfycbyPJbVBORKgT-X7ZzyROdnLtK1zRMxPhNPBEqo_UNX2usdGy6YavPyWAduqwdNsaFo/exec**", (r) => { pushes.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: 1 }) }); });
const swap = {}; // 시험마다 가짜 화면 바꿔 끼우기 (11/18 새 POS 메뉴 칸)
await ctx.route("https://mis.test/**", (r) => { const n = new URL(r.request().url()).pathname.slice(1); r.fulfill({ path: HERE + "/mock/" + (swap[n] || n) }); });
await ctx.route("https://mfgkorea.github.io/label-list/mis-sales.js*", (r) => r.fulfill({ path: REPO + "/mis-sales.js", contentType: "text/javascript" }));
const run = async (job, page = "sales-main.html", peek, block) => {
  gas.post({ action: "set", key: "salesPush", value: { id: Date.now(), at: Date.now(), status: "pending", ...job } });
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("page err", e.message)); p.on("dialog", (d) => d.accept());
  await p.goto("https://mis.test/" + page); await p.waitForTimeout(300);
  if (block) await p.evaluate(() => { window.__sumBlock = true; }); // 합계 대조 "다르면 저장 안 함" 켬 (11/15)
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
ok(!/⚠/.test(d.salesPush.text) && d.salesPush.parts.menu.chkBad === 0, "합계 대조: 메뉴 줄 합 = 화면 합계 줄이면 경고 없음");
// 1-1) 합계 대조를 "다르면 저장 안 함"으로 켜면(SUM_BLOCK) 그날은 저장하지 않고 ⚠ (다음에 다시 읽음)
d = await run({ kind: "menu", from: "2026-10-26", to: "2026-10-26" }, "sales-main.html", null, true);
ok(d.salesPush.status === "done" && /⚠ 합계 다른 날 10\/26 \(저장 안 함/.test(d.salesPush.text) && d.salesPush.parts.menu.chkBad === 1 && !d["menuDay.2026-10-26"], "합계 대조 켬: 메뉴 합계가 다른 10/26은 저장 안 함 · " + d.salesPush.text);
// 1-2) 합계 대조 (11/15 KM "합계는 한 번 더 맞춰 본다"): 화면 합계 줄과 읽은 합이 다르면 ⚠로 알리고 저장은 그대로
d = await run({ kind: "menu", from: "2026-10-26", to: "2026-10-26" });
ok(d.salesPush.status === "done" && /⚠ 합계 다른 날 10\/26/.test(d.salesPush.text) && d.salesPush.parts.menu.chkBad === 1 && (d["menuDay.2026-10-26"] || {}).rows.length === 4, "합계 대조: 메뉴 합계가 다르면 ⚠ 다른 날 10/26 (저장은 그대로) · " + d.salesPush.text);
// 1b) 11/18 새 POS: 소분류가 분류 이름(Soup·Salad)이고 메뉴명(S) 칸이 따로 → 메뉴명을 메뉴로, 소분류를 분류로. 소분류를 메뉴로 잘못 받아 둔 날은 다시 받음
swap["menureport.html"] = "menureport-newpos.html";
gas.post({ action: "set", key: "menuDay.2026-11-03", value: { at: 1, rows: [{ c: "Master", m: "Soup", q: 9 }], h: { cols: ["대분류", "중분류", "소분류", "메뉴코드", "메뉴명(S)", "수량"], menu: "소분류", cat: "중분류" } } });
gas.post({ action: "set", key: "menuDay.2026-11-04", value: { at: 1, rows: [{ c: "x", m: "y", q: 1 }] } });
d = await run({ kind: "menu", from: "2026-11-01", to: "2026-11-04" });
delete swap["menureport.html"];
const np = d["menuDay.2026-11-01"] || {}, npm = (np.rows || []).map((r) => r.m);
ok(np.h && np.h.menu === "메뉴명(S)" && np.h.cat === "소분류", "새 POS: 메뉴 칸 = 메뉴명(S), 분류 = 소분류 · " + JSON.stringify(np.h && { menu: np.h.menu, cat: np.h.cat }));
ok(npm.includes("매드 스테이크 & 치킨 플래터") && !npm.includes("Master") && npm.length === 5 && (np.rows || []).find((r) => r.m === "포레스트 스트립 스테이크").c === "스테이크", "새 POS: 메뉴 이름으로 저장 · 빈 메뉴명 소계 줄 뺌 · " + npm.join("/"));
ok(d["menuDay.2026-11-03"].h.menu === "메뉴명(S)" && d["menuDay.2026-11-03"].rows.some((r) => /플래터/.test(r.m)), "소분류를 메뉴로 잘못 받아 둔 날(11/03)은 다시 받음");
ok(d["menuDay.2026-11-04"].rows[0].m === "y", "제대로 있던 날(11/04)은 그대로");
// 1c) 11/19: 새 POS가 treegrid(분류 줄 아래 메뉴 줄이 자식)면 자식까지 펼쳐 읽음 · 메뉴 줄의 분류는 부모 줄에서 이어받음
swap["menureport.html"] = "menureport-newpos-tree.html";
d = await run({ kind: "menu", from: "2026-11-08", to: "2026-11-08", force: 1 });
delete swap["menureport.html"];
const tr = d["menuDay.2026-11-08"] || {}, trm = (tr.rows || []).map((r) => r.m);
ok(trm.length === 4 && trm.includes("포레스트 스트립 스테이크") && (tr.rows || []).find((r) => r.m === "포레스트 스트립 스테이크").c === "스테이크" && !/판매 없음/.test(d.salesPush.text || ""), "새 POS treegrid: 자식 메뉴 줄 4개 읽음 · 분류는 부모에서 · " + trm.join("/") + " · " + d.salesPush.text);
// 1d) 11/19: 메뉴명(S) 칸 필드가 비고 이름이 다른 필드에 있으면, 메뉴코드 있는 줄에서 이름 같은 필드를 찾아 읽음 (소계 줄은 뺌)
swap["menureport.html"] = "menureport-newpos-alt.html";
d = await run({ kind: "menu", from: "2026-11-09", to: "2026-11-09", force: 1 });
delete swap["menureport.html"];
const al = d["menuDay.2026-11-09"] || {}, alm = (al.rows || []).map((r) => r.m);
ok(alm.length === 4 && alm.includes("포레스트 스트립 스테이크") && !alm.includes("스테이크") && !alm.includes(""), "메뉴명 칸이 비면 이름 필드를 찾아 읽음 · 소계 줄 뺌 · " + alm.join("/") + " · " + d.salesPush.text);
// 1e) 11/20 (어사이드가 실제 화면 스크립트를 읽음): 조회구분 #selCD_SEARCH를 002(메뉴별)로 맞추고 조회 · sort 2 메뉴 줄만 · nm_type3 긴 이름 · 분류 = 대분류>중분류 · 0개 줄·소계 뺌
//  11/16~ 예전 방식(001)으로 받아 둔 날은 다시 받음, 002로 받은 날은 그대로
swap["menureport.html"] = "menureport-newpos-002.html";
gas.post({ action: "set", key: "menuDay.2026-11-17", value: { at: 1, rows: [{ c: "Master", m: "Soup", q: 9 }], h: { cols: ["대분류", "중분류", "소분류", "메뉴코드", "메뉴명(S)", "수량"], menu: "소분류", cat: "중분류" } } });
let modes = null;
d = await run({ kind: "menu", from: "2026-11-17", to: "2026-11-18" }, "sales-main.html", async (p) => { for (const f of p.frames()) { const m = await f.evaluate(() => window.__searchMode).catch(() => null); if (m) modes = m; } });
const n2 = d["menuDay.2026-11-18"] || {}, n2m = (n2.rows || []).map((r) => r.m);
ok(modes && modes.length === 2 && modes.every((m) => m === "002"), "조회구분을 002(메뉴별)로 맞추고 조회 · " + JSON.stringify(modes));
ok(n2.h && n2.h.q === "002" && n2m.length === 6 && n2m.filter((m) => m === "포레스트 스트립 스테이크").length === 2 && !n2m.includes("Steak") && !n2m.includes("갈릭 스노잉 피자"), "002 표: 메뉴 줄 6개(0개 줄·소계·합계 뺌, 분류별 따로) · " + n2m.join("/"));
ok((n2.rows || []).find((r) => r.s === "L포레스트^STK").c === "Lunch>Steak" && (n2.rows || []).find((r) => r.m === "갈릭 명란 파스타[DPF]").q === 2, "분류 = 대분류>중분류 · 짧은 이름 s · 수량");
ok(d["menuDay.2026-11-17"].h.q === "002" && d.salesPush.parts.menu.chkBad === 0, "예전 방식으로 받아 둔 11/17은 002로 다시 받음 · 합계 대조 통과");
d = await run({ kind: "menu", from: "2026-11-18", to: "2026-11-18" });
delete swap["menureport.html"];
ok(d["menuDay.2026-11-18"].h.q === "002" && !(modes.length > 2), "002로 받은 날은 다시 안 받음");
// 2) Gross 불러오기도 그대로
gas.post({ action: "set", key: "forecast", value: { "2026-10-20": { fc: "3000000", act: "" } } });
d = await run({ from: "2026-10-20", to: "2026-10-24" });
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(d.salesPush.status === "done" && d.forecast["2026-10-24"].act === "16366000", "Gross 불러오기 그대로 됨");
ok(d.forecast["2026-10-24"].total === "16866000" && d.forecast["2026-10-24"].net === "14878182" && d.salesPush.totalCol === "Total Sales" && d.salesPush.netCol === "Net Sales", "같은 화면에서 Total Sales·순매출도 읽어 forecast.total/net에 (PL 보드가 그록봇 수집분과 합침, 발주앱은 안 씀)");
ok(d.salesPush.chk && d.salesPush.chk.ok === true && d.salesPush.chk.table === 37545000 && !/⚠/.test(d.salesPush.text), "합계 대조: Gross 날짜 줄 합 = 화면 '합 계' 줄 (경고 없음)");
d = await run({ from: "2026-10-21", to: "2026-10-22" }, "sales-main.html", null, true);
ok(d.salesPush.status !== "done" && /합계가 달라서 안 넣었어요/.test(d.salesPush.text), "합계 대조 켬: Gross 합계가 다르면 안 넣음 · " + d.salesPush.text);
d = await run({ from: "2026-10-21", to: "2026-10-22" });
ok(d.salesPush.status === "done" && /⚠ 합계 다름/.test(d.salesPush.text) && d.salesPush.chk && d.salesPush.chk.ok === false && d.forecast["2026-10-21"].act === "3538000", "합계 대조: Gross 합계가 다르면 ⚠ (값은 그대로) · " + d.salesPush.text);
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
// 6) 입고현황 (11/14 KM): 날짜별 실제 받은 양을 misRecv.날짜에. "입고등록"(입고 입력 화면)은 절대 안 엶, 직원 이름(입고자)은 저장 안 함
let opened3 = null, rentry = 0;
d = await run({ kind: "recv", from: "2026-11-01", to: "2026-11-12" }, "recv-main.html", async (p) => { opened3 = await p.evaluate(() => window.__opened); rentry = await p.evaluate(() => window.__recvEntryOpened || 0); });
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(d.salesPush.status === "done" && d.salesPush.parts.recv.status === "done", "입고현황 읽기 끝남");
ok(rentry === 0 && Array.isArray(opened3) && opened3.length === 1 && opened3[0] === "입고현황", `열린 화면은 입고현황 하나뿐 (입고 입력 화면 ${rentry}번)`);
const r9 = (d["misRecv.2026-11-09"] || {}).rows || [];
ok(r9.length === 2 && r9.find((r) => r.code === "340002106").qty === 10 && r9.find((r) => r.code === "340002106").unit === "EA", "11/9 입고 2줄 · 주문수량(20)이 아니라 입고수량(10)");
ok(((d["misRecv.2026-11-12"] || {}).rows || []).length === 2 && d["misRecv.2026-11-12"].rows.find((r) => r.code === "340001980").qty === 3 && d["misRecv.2026-11-12"].rows.find((r) => r.code === "340001970" && r.qty === -1 && r.ret === 1) && d.misRecvScan.neg === 1, "11/12: 늦게 온 간마늘은 받은 날로 · 반품(−1)은 마이너스 줄로 남김");
ok(!JSON.stringify(d).includes("홍길동") && d.recvProbe && d.recvProbe.grids[0].cols.some((c) => /입고수량/.test(c)) && !d.recvProbe.grids[0].rows, "직원 이름은 어디에도 없음 · 열 이름만 기록");
ok(Array.isArray((d["misRecv.2026-11-10"] || {}).rows) && d["misRecv.2026-11-10"].rows.length === 0 && d.misRecvScan.empty === 10 && d.misRecvScan.days === 2 && d.misRecvScan.all === 1 && !d["misRecv.2026-10-01"], "받은 게 없는 날은 빈 기록(10일) · 기간 밖(10/1)은 안 씀");
ok(!Object.keys(d).some((k) => /^input\./.test(k)), "입고현황 읽기도 KM 입력(input.날짜)은 안 건드림");
// 6-3) LineCheck현황 (11/26 KM: O면 O · △면 왜 △인지(상세 읽기) · X면 수원 한글표시사항 앱에 알림). 작성자·매장명 칸 저장 안 함, 저장 단추 안 누름
let lcw = null;
d = await run({ kind: "linecheck", to: "2026-11-26" }, "lc-main.html", async (p) => { lcw = await p.evaluate(() => [window.__lcWrite || 0, (() => { const f = [...document.querySelectorAll("iframe")].pop(); return f.contentWindow.__q; })(), window.__lcDetail || 0]); });
const lc = d["lineCheck.2026-11-26"] || {};
ok(d.salesPush.status === "done" && d.salesPush.parts.linecheck.status === "done", "LineCheck현황 읽기 끝남: " + d.salesPush.parts.linecheck.text);
ok(lcw[0] === 0 && lcw[1] && lcw[1].day === "2026-11-26" && lcw[1].store === "1345090", "당일·이 매장으로 조회 (저장 단추 안 누름)");
ok(lc.status && lc.status.FOH === "O" && lc.status.BOH1 === "△" && lc.status.BOH2 === "X", "칸 상태 FOH O · BOH1 △ · BOH2 X");
ok(lcw[2] === 1 && d.lineCheckProbe.detail.BOH1 && d.lineCheckProbe.detail.BOH1.grids.length === 1 && d.lineCheckProbe.detail.BOH1.grids[0].n === 3, "△는 눌러서 상세 표를 읽음");
ok(pushes.length === 1 && pushes[0].action === "push_notice" && pushes[0].store === "suwon" && /X · BOH2/.test(pushes[0].text) && lc.sent === pushes[0].text, "X면 수원 한글표시사항 앱에 알림 한 번");
ok(!JSON.stringify(d).includes("홍길동") && !JSON.stringify(d).includes("MG수원") && d.lineCheckProbe.grids[0].drop === 2, "작성자·매장명 칸은 저장 안 함");
d = await run({ kind: "linecheck", to: "2026-11-26" }, "lc-main.html");
ok(pushes.length === 1, "같은 날 같은 X는 다시 알리지 않음");
// 6-2) 매장간재고이동 (11/17 KM "2번 좋다"): 받은 것(+)은 수령일, 보낸 것(−)은 발송일로 misXfer.날짜에. 등록·수신 단추와 다른 화면은 안 누름, 직원 이름·금액은 저장 안 함
let opened5 = null, xw = 0;
d = await run({ kind: "xfer", from: "2026-11-01", to: "2026-11-16" }, "xfer-main.html", async (p) => { opened5 = await p.evaluate(() => window.__opened); xw = await p.evaluate(() => (window.__xferWrite || 0) + (window.__recvEntryOpened || 0)); });
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(d.salesPush.status === "done" && d.salesPush.parts.xfer.status === "done", "매장간재고이동 읽기 끝남");
ok(xw === 0 && Array.isArray(opened5) && opened5.length === 1 && opened5[0] === "매장간재고이동", `열린 화면은 매장간재고이동 하나뿐 · 등록·수신 단추 안 누름 (${xw})`);
const x15 = (d["misXfer.2026-11-15"] || {}).rows || [], x10 = (d["misXfer.2026-11-10"] || {}).rows || [];
ok(x15.length === 2 && x15.every((r) => r.code === "340000032") && x15.reduce((a, r) => a + r.qty, 0) === 41 && x15.some((r) => r.other === "1345041"), "11/15 버터라이스 받음 15+26=41 (보낸 매장 코드 남김)");
ok(x10.length === 1 && x10[0].qty === 20 && ((d["misXfer.2026-11-11"] || {}).rows || []).some((r) => r.code === "340002142" && r.qty === 4), "받은 것은 수령일 기준 (탈각새우 발송 11/10 → 수령 11/11)");
ok(((d["misXfer.2026-11-06"] || {}).rows || []).some((r) => r.code === "340001444" && r.qty === -1 && r.other === "1345058"), "보낸 것은 마이너스 (11/06 파인애플 −1)");
ok(!JSON.stringify(d).includes("340009999") && !((d["misXfer.2026-11-16"] || {}).rows || []).some((r) => r.code === "340000404") && d.misXferScan.wait === 1, "다른 매장끼리 주고받은 줄은 뺌 · 아직 안 받은 줄(자숙홍합)은 다음에");
ok(!JSON.stringify(d).includes("홍길동") && !JSON.stringify(d).includes("김영희") && !/10,000/.test(JSON.stringify(d.misXferScan) + JSON.stringify(x15)) && d.xferProbe.grids[0].cols.some((c) => /수령일자/.test(c)), "직원 이름·금액은 저장 안 함 · 열 이름만 xferProbe");
ok(Array.isArray((d["misXfer.2026-11-08"] || {}).rows) && d["misXfer.2026-11-08"].rows.length === 0 && d.misXferScan.all === 1, "주고받은 게 없는 날은 빈 기록 (쪽 나눔 표를 다 불러옴)");
// 7) Set판매현황 (11/15 KM 승인): 실제 화면은 매장마다 한 줄 · 세트마다 수량 칸(treegrid). 이 매장 줄의 세트별 수량·고객수만 setDay.날짜에. 다른 화면은 안 엶, 금액·다른 매장은 저장 안 함
gas.post({ action: "set", key: "setDay.2026-11-11", value: { at: 1, tot: 1, rows: [{ s: "x", q: 1 }] } });
gas.post({ action: "set", key: "setDay.2026-11-13", value: { at: 1, rows: [] } }); // 첫 판이 남긴 빈 기록(tot 없음) → 다시 읽어야 함
let opened4 = null;
d = await run({ kind: "sets", from: "2026-11-11", to: "2026-11-14" }, "sets-main.html", async (p) => { opened4 = await p.evaluate(() => window.__opened); });
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(d.salesPush.status === "done" && d.salesPush.parts.sets.status === "done", "Set판매현황 읽기 끝남");
ok(Array.isArray(opened4) && opened4.length === 1 && opened4[0] === "Set판매현황", "열린 화면은 Set판매현황 하나뿐 (접힌 매출분석 폴더는 펼침 단추로만)");
const s13 = d["setDay.2026-11-13"] || {}, s14 = d["setDay.2026-11-14"] || {}, qOf = (x, k) => ((x.rows || []).find((r) => r.s === k) || {}).q;
ok(s13.cust === 180 && s13.tot === 7 && qOf(s13, "MGGGR") === 4 && qOf(s13, "MTDB") === 2 && qOf(s13, "ROMANTIC") === 1 && !(s13.rows || []).some((r) => r.s === "PREMIUM"), "11/13 이 매장 줄: 고객수 180 · 세트 7 (골고루 4 · 미트 더블 2 · 로맨틱 1, 0인 세트는 뺌) · 첫 판의 빈 기록은 다시 읽어 덮음");
ok(s14.cust === 420 && qOf(s14, "MGGGR") === 11 && qOf(s14, "PREMIUM") === 1, "11/14 토요일: 고객수 420 · 골고루 11 · 프리미엄 1 (treegrid 자식 줄에서 읽음)");
ok(Array.isArray((d["setDay.2026-11-12"] || {}).rows) && d["setDay.2026-11-12"].rows.length === 0 && d["setDay.2026-11-11"].rows[0].s === "x", "이 매장 세트가 없는 날(11/12)은 빈 기록 · 이미 있던 날(11/11)은 다시 안 읽음");
ok(!JSON.stringify(d).includes("다른매장") && ![s13, s14].some((x) => JSON.stringify({ rows: x.rows, cust: x.cust, tot: x.tot }).includes("50") || /,000/.test(JSON.stringify(x))) && !JSON.stringify(d).includes("MG수원"), "다른 매장 줄·금액·매장명은 저장 안 함");
ok(d.setProbe && d.setProbe.grids[0].tree === true && d.setProbe.grids[0].cols.includes("MGGGR_CNT=수량") && JSON.stringify(d.setProbe.grids[0].heads).includes("골고루*3") && d.misSetScan && d.misSetScan.to === "2026-11-14" && d.misSetScan.days === 2 && d.misSetScan.empty === 1 && d.misSetScan.cols.sets.includes("MTDB_CNT"), "열 이름·겹 머리글(세트 이름)은 setProbe에 · 스캔 기록(끝날·저장 2일·빈 날 1일)");
ok(!Object.keys(d).some((k) => /^input\./.test(k)), "Set판매현황 읽기도 KM 입력(input.날짜)은 안 건드림");
ok(!/⚠/.test(d.salesPush.text) && Array.isArray(d.misSetScan.chkBad) && d.misSetScan.chkBad.length === 0, "합계 대조: 세트별 합 = 세트 합계면 경고 없음");
ok(d.misSetScan.rule === 2 && (d["setDay.2026-11-13"].rows.find((r) => r.s === "ROANDPRE") || {}).sub === 1 && qOf(d["setDay.2026-11-13"], "WINE") === 3, "세트 짜임(11/16 실제 화면): 소계 ROANDPRE 줄엔 sub 표시 · 와인 3은 세트 합계(7)에 안 들어가도 경고 없음 · 새 기준 표시 rule 2");
d = await run({ kind: "sets", from: "2026-11-10", to: "2026-11-10" }, "sets-main.html", null, true);
ok(/⚠ 세트 합계 다른 날 11\/10 \(저장 안 함/.test(d.salesPush.text) && !d["setDay.2026-11-10"] && d.misSetScan.chkBad.join() === "2026-11-10", "합계 대조 켬: 세트 합계가 다른 11/10은 저장 안 함 · " + d.salesPush.text);
d = await run({ kind: "sets", from: "2026-11-10", to: "2026-11-10" }, "sets-main.html");
ok(d.salesPush.status === "done" && /⚠ 세트 합계 다른 날 11\/10/.test(d.salesPush.text) && d.misSetScan.chkBad.join() === "2026-11-10" && d["setDay.2026-11-10"].tot === 9, "합계 대조: 세트 합계(9)가 세트별 합(4)과 다르면 ⚠ (저장은 그대로) · " + d.salesPush.text);
// 7-2) 이 매장 줄이 한 번도 안 나오면(조회가 안 된 것일 수 있음) 빈 날로 저장하지 않고 화면 모양만 남김
d = await run({ kind: "sets", from: "2026-11-01", to: "2026-11-02" }, "sets-main.html");
console.log("결과:", d.salesPush.status, d.salesPush.text);
ok(!d["setDay.2026-11-01"] && !d["setDay.2026-11-02"] && d.setProbe.diag && d.setProbe.diag.grids[0].tree === true && d.misSetScan.to === null && d.salesPush.parts.sets.status === "error", "이 매장 줄이 없으면 아무 날도 저장 안 함 · setProbe.diag만 · 끝날 기록 안 함(다음에 다시)");
await b.close();
console.log(`합계: 통과 ${oks} · 실패 ${fails}`);
process.exitCode = fails ? 1 : 0;
