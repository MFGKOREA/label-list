// GW 상황판·품절 기록 화면 시험 (11/15 KM "2주안 기획들 실행해"): 시트 사본으로 그날 아침을 열어
//  1) 발주 탭: [품절 기록]이 86 위험·0을 센 품목에만 보이는지, 검색하면 보이는지, 누르면 기록되고 다시 누르면 지워지는지(시트 저장 내용까지)
//  2) 리포트 탭: GW 상황판 줄·색, 품절 횟수, 일부러 끊긴 자료(오래된 PC 신호·합계 다름)를 넣었을 때 빨강으로 바뀌는지
//  3) 밤 9시: 86이 내일 기준("오늘"·지난 시각 없음, 제목 "내일 86 위험")
// 쓰기는 가짜 시트(이 시험 안에서만 합쳐 둠)로 받음. 사용: node order-src/test/health.mjs <kv.json> [날짜 2026-11-16] [사진 폴더]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const here = path.dirname(fileURLToPath(import.meta.url)), html = path.resolve(here, "../../order.html");
const [kvPath, day = "2026-11-16", shotDir] = process.argv.slice(2);
if (!kvPath) { console.log("사용: node health.mjs <kv.json> [날짜] [사진 폴더]"); process.exit(2); }
const RAW = JSON.parse(fs.readFileSync(kvPath, "utf8"));
const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: exe });
let fail = 0;
const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fail++; };
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const mergeObj = (cur, patch) => { const o = isObj(cur) ? { ...cur } : {}; Object.keys(patch).forEach((k) => { const v = patch[k]; if (v === null) delete o[k]; else if (isObj(v) && isObj(o[k])) o[k] = mergeObj(o[k], v); else o[k] = v; }); return o; };
async function open(tweak, hm = "09:30") {
  const data = JSON.parse(JSON.stringify(RAW.data || RAW)); if (tweak) tweak(data);
  const ctx = await b.newContext({ timezoneId: "Asia/Seoul", viewport: { width: 390, height: 844 }, deviceScaleFactor: shotDir ? 2 : 1 });
  const p = await ctx.newPage(), errs = [], posts = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("https://script.google.com/**", (r) => {
    const q = r.request(); if (q.method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
    let j = {}; try { j = JSON.parse(q.postData() || "{}"); } catch {}
    posts.push(j);
    if (j.action === "merge") data[j.key] = mergeObj(data[j.key], j.patch || {});
    else if (j.action === "set") data[j.key] = j.value; else if (j.action === "append") (data[j.key] = Array.isArray(data[j.key]) ? data[j.key] : []).push(j.item);
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: j.key ? { [j.key]: data[j.key] } : {} }) });
  });
  await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await p.clock.setFixedTime(new Date(day + "T" + hm + ":00+09:00"));
  await p.goto("file://" + html);
  await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: "#dock{display:none!important}" });
  return { p, ctx, errs, posts, data };
}
const dock = async (p, v) => { await p.evaluate((v) => document.querySelector(`#dock [data-dock="${v}"]`).click(), v); await p.waitForTimeout(800); }; // 사진에서 가리지 않게 아래 메뉴는 숨겨 두고 직접 누름
const report = (p) => dock(p, "report");
const board = (p) => p.evaluate(() => ({ sum: document.getElementById("hlthSum").textContent, sumCls: document.getElementById("hlthSum").className, rows: [...document.querySelectorAll("#hlth .kv.hl")].map((r) => ({ t: r.querySelector("span").firstChild.nextSibling.textContent, dot: r.querySelector(".dot").className.replace("dot ", ""), v: r.querySelector("b").textContent, cls: r.querySelector("b").className })) }));

// ---------- 1) 발주 탭: 품절 기록 ----------
const A = await open();
const vis = await A.p.evaluate(() => {
  const C = window.__orderCalc, db = C.db(), T = C.TODAY, inp = db["input." + T] || {}, M = C.model(), out = { bad: [], n: 0, cells: 0, first: null, plain: null };
  for (const el of document.querySelectorAll("#orderList > .group .cell[data-key]")) {
    const it = M.items.find((i) => i.key === el.dataset.key); if (!it) continue; out.cells++;
    const v = inp[it.key] || {}, zero = v.s !== "" && v.s != null && !v.est && Number(v.s) === 0, want = !!C.risk1(it, v) || zero, has = !!el.querySelector(".soldbtn");
    if (has) { out.n++; if (!out.first) out.first = it.key; }
    if (want !== has) out.bad.push(it.name);
    if (!has && !out.plain) out.plain = { key: it.key, name: it.name };
  }
  return out;
});
ok(vis.n > 0 && vis.bad.length === 0, `[품절 기록] ${vis.n}개 / 목록 ${vis.cells}개 = 86 위험·0 센 품목과 같음${vis.bad.length ? " (다름: " + vis.bad.slice(0, 3).join(", ") + ")" : ""}`);
const key1 = vis.first, sk = "soldout." + day, cell = A.p.locator(`#orderList > .group .cell[data-key="${key1}"]`), btn = cell.locator(".soldbtn");
if (shotDir) { await cell.scrollIntoViewIfNeeded(); await A.p.waitForTimeout(200); await A.p.screenshot({ path: shotDir + "/1-soldbtn.png" }); }
const n0 = A.posts.length; await btn.click(); await A.p.waitForTimeout(1200);
const t1 = await btn.textContent(), on1 = await btn.getAttribute("aria-pressed"), sent1 = A.posts.slice(n0).find((x) => x.key === sk);
ok(/^품절 09:30 · 취소$/.test(t1) && on1 === "true", `누름: "${t1}" (aria-pressed ${on1})`);
ok(!!sent1 && sent1.patch && sent1.patch[key1] === "09:30" && (A.data[sk] || {})[key1] === "09:30", `시트에 ${sk} = {${key1}: "09:30"} 저장`);
if (shotDir) { await A.p.screenshot({ path: shotDir + "/2-soldon.png" }); }
// 다시 그려도(검색 → 지우기) 기록이 남아 보임
await A.p.fill("#q", "zzz"); await A.p.waitForTimeout(300); await A.p.fill("#q", ""); await A.p.waitForTimeout(500);
ok(/^품절 09:30/.test(await A.p.locator(`#orderList > .group .cell[data-key="${key1}"] .soldbtn`).textContent()), "목록을 다시 그려도 품절 표시 그대로");
// 검색하면 86이 아닌 품목에도 보임
if (vis.plain) { await A.p.fill("#q", vis.plain.name); await A.p.waitForTimeout(500); ok((await A.p.locator(`#orderList .cell[data-key="${vis.plain.key}"] .soldbtn`).count()) === 1, `검색 "${vis.plain.name}": [품절 기록] 보임`); await A.p.fill("#q", ""); await A.p.waitForTimeout(500); }
// 리포트: 이번 주 품절 1번
await report(A.p);
let bd = await board(A.p);
const sold = bd.rows.find((r) => r.t === "이번 주 품절");
ok(bd.rows.length >= 11 && sold && sold.v === "1번", `상황판 ${bd.rows.length}줄, 이번 주 품절 ${sold ? sold.v : "없음"}`);
ok(bd.sum === "이상 없음" && bd.sumCls === "ok", `아침 9:30(어제 매출 들어오기 전), 어젯밤 PC 꺼짐: "${bd.sum}" (11시 전엔 그제까지 있으면 정상)`);
console.log("   " + bd.rows.map((r) => `${r.t}=${r.v}(${r.dot})`).join(" · "));
ok(bd.rows.every((r) => /^(ok|warn|bad|none|info)$/.test(r.dot)), "점 색: 모두 ok·warn·bad·none·info 중 하나");
if (shotDir) { await A.p.evaluate(() => document.getElementById("hlthH").scrollIntoView({ block: "start" })); await A.p.waitForTimeout(300); await A.p.screenshot({ path: shotDir + "/3-board.png" }); }
// 취소: 다시 누르면 지움
await dock(A.p, "order");
const btn2 = A.p.locator(`#orderList > .group .cell[data-key="${key1}"] .soldbtn`), n1 = A.posts.length;
await btn2.click(); await A.p.waitForTimeout(1200);
const sent2 = A.posts.slice(n1).find((x) => x.key === sk);
ok((await btn2.textContent()) === "품절 기록" && !!sent2 && sent2.patch && sent2.patch[key1] === null && !(key1 in (A.data[sk] || {})), `다시 누름: "품절 기록", 시트에서 지움(patch ${JSON.stringify(sent2 && sent2.patch)})`);
ok(A.errs.length === 0, "페이지 오류 " + (A.errs.length ? A.errs.slice(0, 2).join(" | ") : "없음"));
await A.ctx.close();

// ---------- 2) 끊긴 자료를 일부러 넣으면 빨강 ----------
const B = await open((d) => {
  d.misAgent = { ...(d.misAgent || {}), at: new Date(day + "T09:30:00+09:00").getTime() - 3 * 864e5 }; // PC 신호 3일 전
  d.salesPush = { ...(d.salesPush || {}), parts: { ...((d.salesPush || {}).parts || {}), menu: { ...(((d.salesPush || {}).parts || {}).menu || {}), chkBad: 2 } } }; // 메뉴 합계 다른 날 2
  d.hourShare = { ...(d.hourShare || {}), to: "2026-10-20" }; // 시간대 비율 27일 전
  d.collectLog = [{ t: "2026-11-16 08:23", r: "ok", why: "ok" }, { t: "2026-11-16 09:10", r: "fail", why: "login", txt: "GW 로그인이 풀려 MIS를 못 열었어요" }]; // 자동 수집: 로그인 풀림
});
await report(B.p);
bd = await board(B.p);
const g = (t) => bd.rows.find((r) => r.t === t) || {};
ok(g("매장 PC 연결").dot === "bad" && /3일 전/.test(g("매장 PC 연결").v), `PC 신호 3일 전 → 빨강 ("${g("매장 PC 연결").v}")`);
ok(g("합계 대조").dot === "bad" && /다른 날 2/.test(g("합계 대조").v), `합계 다름 2 → 빨강 ("${g("합계 대조").v}")`);
ok(g("시간대 비율").dot === "bad", `시간대 비율 10/20까지 → 빨강 ("${g("시간대 비율").v}")`);
ok(g("자동 수집").dot === "bad" && /로그인 풀림/.test(g("자동 수집").v), `자동 수집 로그인 풀림 → 빨강 ("${g("자동 수집").v}")`);
ok(/^확인 필요 \d+$/.test(bd.sum) && +bd.sum.split(" ").pop() >= 3 && bd.sumCls === "bad", `제목 옆: "${bd.sum}"`);
const hp = await B.p.evaluate(() => window.__orderCalc.gwHealth().filter((r) => r.s === "bad").map((r) => r.t));
ok(hp.includes("매장 PC 연결") && hp.includes("합계 대조") && hp.includes("자동 수집"), `gwHealth() bad = ${hp.join(", ")}`);
if (shotDir) { await B.p.evaluate(() => document.getElementById("hlthH").scrollIntoView({ block: "start" })); await B.p.waitForTimeout(300); await B.p.screenshot({ path: shotDir + "/4-board-bad.png" }); }
ok(B.errs.length === 0, "페이지 오류 " + (B.errs.length ? B.errs.slice(0, 2).join(" | ") : "없음"));
await B.ctx.close();

// ---------- 3) 같은 자료를 낮 1시에 열면: 어제 매출이 아직 없음 · 영업 중 PC 신호 없음 → 노랑 ----------
const C3 = await open(null, "13:00");
await report(C3.p);
bd = await board(C3.p);
const g3 = (t) => bd.rows.find((r) => r.t === t) || {};
ok(g3("실제 매출").dot === "warn" && g3("매장 PC 연결").dot === "warn" && !bd.rows.some((r) => r.dot === "bad"), `13:00: 실제 매출 ${g3("실제 매출").v}(${g3("실제 매출").dot}) · PC ${g3("매장 PC 연결").v}(${g3("매장 PC 연결").dot}) · 빨강 없음`);
ok(/^늦음 \d+$/.test(bd.sum) && bd.sumCls === "warn", `제목 옆: "${bd.sum}"`);
ok(C3.errs.length === 0, "페이지 오류 " + (C3.errs.length ? C3.errs.slice(0, 2).join(" | ") : "없음"));
await C3.ctx.close();

// ---------- 3b) 자동 수집 기록: 미룸은 초록, 한 번 못 받음은 노랑, 두 번 연속 못 받음은 빨강 ----------
for (const [log, want, label] of [
  [[{ t: day + " 12:20", r: "skip", why: "ordertime" }], "ok", "발주 시간대 미룸"],
  [[{ t: day + " 10:23", r: "ok", why: "ok" }, { t: day + " 12:23", r: "fail", why: "no_reply" }], "warn", "한 번 PC 응답 없음"],
  [[{ t: day + " 10:23", r: "fail", why: "no_reply" }, { t: day + " 12:23", r: "skip", why: "pc_off" }], "bad", "두 번 연속(응답 없음 → PC 꺼짐)"],
]) {
  const X = await open((d) => { d.collectLog = log; }, "13:00");
  const h = await X.p.evaluate(() => window.__orderCalc.gwHealth().find((r) => r.k === "auto"));
  ok(h && h.s === want, `자동 수집 ${label} → ${want} ("${h && h.v}")`);
  await X.ctx.close();
}

// ---------- 3c) BOH 수원컨벤션점 발주시트 (11/16 KM: 주차별 · 날짜·요일 · Forecast · 재고 안 넣은 날은 예상 재고 · 발주는 앱 먼저, 없으면 GW · 발주품목순 · 설명 없이) ----------
{
  const L = await open(null, "10:00");
  await L.p.evaluate(() => document.querySelector('[data-go="log"]').click()); await L.p.waitForTimeout(800);
  const lv = await L.p.evaluate(() => {
    const C = window.__orderCalc, M = C.model(), db = C.db(), items = M.items.filter((i) => !i.ledgerOnly);
    const wk = document.querySelector("#v-log .logwk"), hs = [...wk.querySelectorAll("thead th.dh")].map((x) => x.textContent);
    const rows = [...wk.querySelectorAll("tbody tr:not(.fcrow)")], days = [...wk.querySelectorAll("thead th.dh")].map((x) => x.textContent.split(" ")[0]);
    // 앱 발주 칸(>0)이 있는 칸은 그 값이어야 함 (GW 주문현황보다 먼저)
    const year = C.TODAY.slice(0, 4), iso = (md) => { const [m, d] = md.split("/"); return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };
    let appN = 0, appBad = 0; const vendorOrder = [];
    rows.forEach((tr, r) => { const it = items.find((x) => x.name === tr.querySelector("th").title); if (!it) return; vendorOrder.push(it.vendor || "");
      days.forEach((md, k) => { const o = Number(((db["input." + iso(md)] || {})[it.key] || {}).o); if (o > 0) { appN++; if (tr.querySelectorAll("td.o")[k].textContent !== String(Math.round(o * 10) / 10)) appBad++; } }); });
    let switches = 0; for (let k = 1; k < vendorOrder.length; k++) if (vendorOrder[k] !== vendorOrder[k - 1]) switches++;
    return { title: document.querySelector("#v-log h2").textContent, h3: wk.querySelector("h3").textContent, first: hs[0], n: hs.length, rows: rows.length, items: items.length, fc: !!wk.querySelector("tr.fcrow"), legend: !!document.querySelector("#v-log .loglegend, #logHead"), groupRows: wk.querySelectorAll("tr.lg").length, appN, appBad, vendors: new Set(vendorOrder).size, switches, chips: document.querySelectorAll("#logWeeks button[aria-pressed=true]").length };
  });
  const mon = new Date(day + "T00:00:00Z"); mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7) - 14);
  const want0 = `${mon.getUTCMonth() + 1}/${mon.getUTCDate()}`;
  ok(lv.title === "BOH 수원컨벤션점 발주시트" && /^\d+주차/.test(lv.h3) && lv.chips === 3, `제목 "${lv.title}" · "${lv.h3}" · 고른 주 ${lv.chips}개`);
  ok(lv.first.startsWith(want0) && /월$/.test(lv.first) && lv.n === 7 && lv.fc, `첫 주 ${lv.first} ~ 7일 · Forecast 줄`);
  ok(lv.rows === lv.items && lv.groupRows === 0 && lv.switches === lv.vendors - 1 && !lv.legend, `품목 ${lv.rows}/${lv.items} · 위치 나눔 없음 · 업체별로 한 번씩 이어짐(발주품목순) · 설명 문구 없음`);
  ok(lv.appN > 0 && lv.appBad === 0, `앱 발주 칸 ${lv.appN}개 모두 앱 값으로 표시`);
  if (shotDir) await L.p.screenshot({ path: shotDir + "/6-log.png" });
  ok(L.errs.length === 0, "페이지 오류 " + (L.errs.length ? L.errs.slice(0, 2).join(" | ") : "없음"));
  await L.ctx.close();
}

// ---------- 4) 밤 9시 (11/15 KM "영업 끝난 시간에 당일 86위험은 이해가 안가. 밤에는 다음날 기준"): 86은 내일 문 열 때 예상 재고 기준 ----------
const N = await open(null, "21:00");
const nv = await N.p.evaluate(() => {
  const C = window.__orderCalc, M = C.model(), db = C.db(), inp = db["input." + C.TODAY] || {};
  const l = M.items.filter((i) => !i.ledgerOnly).map((it) => C.risk1(it, inp[it.key])).filter(Boolean);
  return { night: C.nightNow(), n: l.length, today: l.filter((x) => /^오늘/.test(x.when)).length, past: l.filter((x) => x.at < 1).length, allNight: l.every((x) => x.night), head: ((document.querySelector("#orderList .risk86 .r-top b") || {}).textContent || ""), sub: ((document.querySelector("#orderList .risk86 .r-top span") || {}).textContent || ""), first: l.sort((a, b) => a.at - b.at).slice(0, 3).map((x) => x.when) };
});
ok(nv.night && nv.n > 0 && nv.today === 0 && nv.past === 0 && nv.allNight, `21:00: 86 ${nv.n}개 · "오늘" ${nv.today}개 · 지난 시각 ${nv.past}개 · 앞 3개 ${JSON.stringify(nv.first)}`);
ok(nv.head === "내일 86 위험" && /내일 문 열 때/.test(nv.sub), `제목 "${nv.head}" · "${nv.sub}"`);
await report(N.p);
bd = await board(N.p);
ok(bd.rows.some((r) => r.t === "내일 86 위험"), `상황판 줄: ${bd.rows.filter((r) => /86/.test(r.t)).map((r) => r.t + " " + r.v).join(", ")}`);
if (shotDir) { await dock(N.p, "order"); await N.p.evaluate(() => window.scrollTo(0, 0)); await N.p.waitForTimeout(300); await N.p.screenshot({ path: shotDir + "/5-night86.png" }); }
ok(N.errs.length === 0, "페이지 오류 " + (N.errs.length ? N.errs.slice(0, 2).join(" | ") : "없음"));
await b.close();
console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0);
