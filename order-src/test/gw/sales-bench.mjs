// Gross·메뉴 판매 불러오기 되돌려 보기(백테스트): 같은 상황을 옛 버전과 새 버전에 넣어 비교
//  가짜 MIS(조회를 진짜 요청으로 보내 지연·빈 날·실패를 흉내) + 가짜 시트(Code.gs를 node에서) + 가짜 PC(확장 1.7.0의 규칙: 30분 안의 pending만, 요청마다 한 번, 12분 제한)
//  실제 GW·MIS·시트에는 아무 요청도 안 보냄.
// 사용: node order-src/test/gw/sales-bench.mjs [--only A,B] [--n 3] [--old <폴더>]
//   --old 폴더에 mis-sales.old.js·order.old.html이 있으면 옛 버전도 같이 돌려 비교 (없으면 새 버전만)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "../gas/sim.mjs";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = (arg("--only", "") || "").split(",").filter(Boolean), N = +arg("--n", "2"), OLD = arg("--old", "");
const VARS = { new: { sales: REPO + "/mis-sales.js", app: REPO + "/order.html" } };
if (OLD && fs.existsSync(OLD + "/mis-sales.old.js")) VARS.old = { sales: OLD + "/mis-sales.old.js", app: OLD + "/order.old.html" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const TODAY = kst(), YDAY = addDays(TODAY, -1);
// 가짜 MIS가 내는 값: 날짜마다 다르게 (다른 날 자료가 섞이면 바로 드러남)
const qOf = (day) => 100 + +day.slice(8) * 3 + +day.slice(5, 7);
const menuRows = (day) => [{ NM_CLS2: "스테이크", NM_MENU: "매드 스테이크 & 치킨 플래터", QT_SALE: String(qOf(day)), AM_SALE: "1" }, { NM_CLS2: "피자", NM_MENU: "갈릭 스노잉 피자", QT_SALE: String(qOf(day) + 1), AM_SALE: "1" }, { NM_CLS2: "합계", NM_MENU: "", QT_SALE: "999" }];
const grossOf = (day) => 2000000 + +day.slice(8) * 10000;
const b = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });

// 한 번의 시험 세계: 가짜 시트 + 가짜 MIS + 가짜 PC (+ 앱 화면)
async function world(variant, sc) {
  const V = VARS[variant], gas = load(REPO + "/apps-script/order/Code.gs"), log = [];
  const ctx = await b.newContext({ timezoneId: "Asia/Seoul" });
  let posts = 0; const qn = { menu: 0, gross: 0 }, qByDay = {};
  await ctx.route("https://script.google.com/**", async (r) => {
    const q = r.request();
    if (q.method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(gas.get(Object.fromEntries(new URL(q.url()).searchParams))) });
    const body = JSON.parse(q.postData()), h = (sc.gasPost && sc.gasPost(body, ++posts)) || {};
    if (h.delay) await sleep(h.delay);
    if (h.fail) return r.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(gas.post(body)) });
  });
  await ctx.route("https://mis.test/**", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.endsWith("/q/menu")) {
      const day = u.searchParams.get("day"), n = ++qn.menu; qByDay[day] = (qByDay[day] || 0) + 1;
      const h = (sc.menu && sc.menu(day, qByDay[day], n)) || {};
      await sleep(h.delay ?? 250);
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(h.empty ? [] : menuRows(day)) }).catch(() => {});
    }
    if (u.pathname.endsWith("/q/hold")) { await sleep(120e3); return r.fulfill({ status: 200, contentType: "application/json", body: "[]" }).catch(() => {}); }
    if (u.pathname.endsWith("/q/gross")) {
      const from = u.searchParams.get("from"), to = u.searchParams.get("to"), n = ++qn.gross, h = (sc.gross && sc.gross(from, to, n)) || {};
      await sleep(h.delay ?? 350);
      const rows = []; for (let d = from; d <= to; d = addDays(d, 1)) rows.push({ DT_SALE: d, AM_NET: 1, AM_GROSS: grossOf(d).toLocaleString() });
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(u.searchParams.get("daily") === "1" ? rows : [{ DT_SALE: "합계", AM_GROSS: "1" }]) }).catch(() => {});
    }
    const file = u.pathname.split("/").pop(), fp = HERE + "/mock/" + ((sc.pages || {})[file] || file);
    if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: "" }); // 없는 파일(favicon 등)도 밖으로 안 나가게
    r.fulfill({ path: fp });
  });
  await ctx.route("https://mfgkorea.github.io/label-list/mis-sales.js*", (r) => r.fulfill({ path: V.sales, contentType: "text/javascript" }));
  await ctx.route("https://app.test/order.html", (r) => r.fulfill({ path: V.app, contentType: "text/html" }));
  await ctx.addInitScript((o) => { window.__salesTest = o.sales; window.__spTest = o.sp; }, { sales: sc.salesTest || { q: 8000, emptyWait: 1200, retry: [300, 600], progEvery: 1500 }, sp: sc.spTest || null });
  // 가짜 PC: 확장 1.7.0의 규칙
  const P = { on: sc.pcOn !== false, job: null, tried: {}, beat: 0, limit: sc.limit || 60e3, waitMax: sc.waitMax || 30 * 60e3, open: sc.openDelay ?? 400, opened: 0, closed: 0 };
  const post = (key, value) => gas.post({ action: "set", key, value });
  let stop = false;
  const pcLoop = (async () => {
    while (!stop) {
      await sleep(150);
      if (!P.on) continue;
      const now = Date.now(), sp = (gas.get({ api: "1", status: "1" }).status || {}).salesPush || {};
      if (!P.job && now - P.beat > (sc.beatEvery || 600e3)) { P.beat = now; post("misAgent", { at: now, mode: "ondemand", ver: "1.7.0" }); }
      if (!P.job) {
        if (sc.pcDeaf) continue; // 켜져 있지만 요청을 못 받는 PC (확장이 멈춤)
        if (sc.skipFirst && sp.status === "pending" && !P.skipped) { P.skipped = sp.id; P.tried[sp.id] = 1; continue; } // 첫 요청만 놓침 (다음 요청부터는 받음)
        if (!(sp.status === "pending" && now - (sp.at || 0) < P.waitMax) || P.tried[sp.id]) continue;
        P.tried[sp.id] = 1; P.job = { id: sp.id, openedAt: now, page: null }; P.opened++; post("misAgent", { at: now, mode: "ondemand", ver: "1.7.0", job: "sales", step: "Gross 불러오기 받음 → GW·MIS 열기", stepAt: now }); log.push(`PC: 요청 ${String(sp.id).slice(-5)} 받음 → 창 엶`);
        const job = P.job;
        (async () => {
          await sleep(P.open); // GW 로그인 → MIS 첫 화면까지 걸리는 시간
          if (P.job !== job) return;
          const pg = await ctx.newPage(); job.page = pg; pg.on("dialog", (d) => d.accept().catch(() => {})); pg.on("pageerror", (e) => log.push("MIS 화면 오류: " + e.message));
          await pg.goto("https://mis.test/sales2-main.html").catch(() => {}); await sleep(200);
          await pg.evaluate(() => { const s = document.createElement("script"); s.src = "https://mfgkorea.github.io/label-list/mis-sales.js?quiet=1&t=" + Date.now(); document.body.appendChild(s); }).catch(() => {});
        })();
        continue;
      }
      const same = sp.id === P.job.id, age = now - P.job.openedAt, end = async (why) => { const j = P.job; P.job = null; P.closed++; log.push("PC: " + why); if (j.page) await j.page.close().catch(() => {}); };
      if (same && /done|error/.test(sp.status) && (sp.doneAt || 0) > P.job.openedAt) await end(`매출 ${sp.status === "done" ? "가져옴" : "못 가져옴"} → 창 닫음 (${Math.round(age / 100) / 10}초)`);
      else if (age > P.limit) { if (same && /pending|running/.test(sp.status)) post("salesPush", { ...sp, status: "error", doneAt: now, text: "PC가 12분 안에 못 끝냄 · 멈춘 곳: 시험" }); await end("매출 시간 초과 → 창 닫음"); }
    }
  })();
  const full = () => gas.get({ api: "1" }).data;
  if (process.argv.includes("--trace")) { let last = ""; const t0 = Date.now(); (async () => { while (!stop) { const sp = full().salesPush || {}, sig = JSON.stringify({ id: String(sp.id || "").slice(-5), st: sp.status, kind: sp.kind, cur: sp.cur, also: Object.keys(sp.also || {}), parts: Object.fromEntries(Object.entries(sp.parts || {}).map(([k, v]) => [k, v && v.status])), prog: sp.prog, re: sp.re }); if (sig !== last) { last = sig; console.log(`     ${((Date.now() - t0) / 1000).toFixed(1)}s`, sig); } await sleep(100); } })(); }
  const request = (job) => post("salesPush", { id: Date.now(), at: Date.now(), status: "pending", ...job });
  const waitDone = async (ms, pred) => { const t = Date.now(); while (Date.now() - t < ms) { const sp = full().salesPush || {}; if (pred ? pred(full()) : /done|error/.test(sp.status)) return Date.now() - t; await sleep(150); } return -1; };
  // 앱 화면 (버튼을 눌러 보는 시험에서만)
  const openApp = async () => {
    post("btnLock", { salt: "s", hash: "h" });
    const pg = await ctx.newPage(); pg.on("dialog", (d) => d.accept().catch(() => {})); pg.on("pageerror", (e) => log.push("앱 오류: " + e.message));
    await pg.goto("https://app.test/order.html"); await pg.evaluate(() => localStorage.setItem("order-calc-pin", "h")); await pg.reload(); await sleep(900);
    await pg.click('#dock [data-dock="forecast"]'); await sleep(400);
    const bar = async (id) => ({ text: ((await pg.locator(`#${id} .mis-s`).textContent().catch(() => "")) || "").trim(), disabled: await pg.locator(`#${id} button.btn`).isDisabled().catch(() => null) });
    return { pg, gross: () => bar("salesBar"), menu: () => bar("menuBar"), pressGross: () => pg.evaluate(() => document.getElementById("salesGo").click()), pressMenu: () => pg.evaluate(() => document.getElementById("menuGo").click()) };
  };
  const close = async () => { stop = true; await pcLoop.catch(() => {}); await ctx.close(); };
  return { gas, P, log, full, request, waitDone, openApp, close, qn, qByDay };
}
// 판정 도우미
const menuCheck = (d, days, emptyDays = []) => {
  let ok = 0, wrong = 0, miss = 0;
  days.forEach((day) => { const m = d["menuDay." + day]; if (emptyDays.includes(day)) { if (m) wrong++; else ok++; return; } if (!m) { miss++; return; } if (m.rows.length === 2 && m.rows[0].q === qOf(day) && m.rows[1].q === qOf(day) + 1) ok++; else wrong++; });
  return { ok, wrong, miss };
};
const range = (from, to) => { const a = []; for (let d = from; d <= to; d = addDays(d, 1)) a.push(d); return a; };

const SC = {
  // ---------- PC 쪽 스크립트만 (요청을 시트에 바로 넣음) ----------
  A: { name: "Gross 기본 (조회 0.35초)", run: async (w) => {
    const from = addDays(YDAY, -4); w.request({ from, to: YDAY }); const t = await w.waitDone(40e3); const d = w.full(), sp = d.salesPush;
    const good = range(from, YDAY).filter((x) => (d.forecast || {})[x] && d.forecast[x].act === String(grossOf(x))).length;
    return { pass: sp.status === "done" && good === 5, note: `${sp.status} · 맞게 들어간 날 ${good}/5 · ${(t / 1000).toFixed(1)}초` };
  } },
  B: { name: "메뉴 28일 기본 (조회 0.25초, 시트 저장 0.3초)", sc: { gasPost: (b) => (/^menuDay/.test(b.key) ? { delay: 300 } : null) }, run: async (w) => {
    const from = addDays(YDAY, -27), days = range(from, YDAY); w.request({ kind: "menu", from, to: YDAY }); const t = await w.waitDone(90e3); const d = w.full(), c = menuCheck(d, days);
    return { pass: d.salesPush.status === "done" && c.ok === 28, note: `${d.salesPush.status} · 맞음 ${c.ok} 틀림 ${c.wrong} 빠짐 ${c.miss} /28 · ${(t / 1000).toFixed(1)}초` };
  } },
  C: { name: "메뉴: 한 날의 조회가 13초 걸림 (MIS가 잠깐 느림) + 시트 저장 0.8초", sc: { menu: (day, nth) => (day === addDays(YDAY, -6) && nth === 1 ? { delay: 13000 } : null), gasPost: (b) => (/^menuDay/.test(b.key) ? { delay: 800 } : null), salesTest: { q: 20000, emptyWait: 1200, retry: [300, 600], progEvery: 1500 } }, run: async (w) => {
    const from = addDays(YDAY, -9), days = range(from, YDAY); w.request({ kind: "menu", from, to: YDAY }); const t = await w.waitDone(120e3); const d = w.full(), c = menuCheck(d, days);
    return { pass: d.salesPush.status === "done" && c.ok === 10, note: `${d.salesPush.status} · 맞음 ${c.ok} 틀림(다른 날 자료) ${c.wrong} 빠짐 ${c.miss} /10 · ${(t / 1000).toFixed(1)}초 · "${String(d.salesPush.text).slice(0, 60)}"` };
  } },
  D: { name: "메뉴: 판매 없는 날(휴무) 3일 포함", sc: { menu: (day) => ([addDays(YDAY, -2), addDays(YDAY, -5), addDays(YDAY, -8)].includes(day) ? { empty: true } : null) }, run: async (w) => {
    const from = addDays(YDAY, -9), days = range(from, YDAY), em = [addDays(YDAY, -2), addDays(YDAY, -5), addDays(YDAY, -8)]; w.request({ kind: "menu", from, to: YDAY }); const t = await w.waitDone(120e3); const d = w.full(), c = menuCheck(d, days, em);
    return { pass: d.salesPush.status === "done" && c.ok === 10, note: `${d.salesPush.status} · 맞음 ${c.ok}/10 · ${(t / 1000).toFixed(1)}초 · "${String(d.salesPush.text).slice(0, 70)}"` };
  } },
  E: { name: "메뉴: 시트 저장이 두 번 실패(서버 오류)", sc: { gasPost: (() => { let k = 0; return (b) => (/^menuDay/.test(b.key) && (++k === 3 || k === 6) ? { fail: true } : null); })() }, mk: () => ({ gasPost: (() => { let k = 0; return (b) => (/^menuDay/.test(b.key) && (++k === 3 || k === 6) ? { fail: true } : null); })() }), run: async (w) => {
    const from = addDays(YDAY, -9), days = range(from, YDAY); w.request({ kind: "menu", from, to: YDAY }); const t = await w.waitDone(120e3); const d = w.full(), c = menuCheck(d, days), said = /(\d+)일 저장/.exec(String(d.salesPush.text)) || [];
    return { pass: c.ok === 10 && d.salesPush.status === "done", note: `${d.salesPush.status} · 실제 저장 ${c.ok}/10 · 화면엔 "${said[0] || d.salesPush.text}" · ${(t / 1000).toFixed(1)}초` };
  } },
  F: { name: "Gross: 조회가 12초 걸림", sc: { gross: () => ({ delay: 12000 }), salesTest: { q: 30000, emptyWait: 1200, retry: [300, 600] } }, run: async (w) => {
    const from = addDays(YDAY, -4); w.request({ from, to: YDAY }); const t = await w.waitDone(60e3); const d = w.full(), sp = d.salesPush;
    const good = range(from, YDAY).filter((x) => (d.forecast || {})[x] && d.forecast[x].act === String(grossOf(x))).length;
    return { pass: sp.status === "done" && good === 5, note: `${sp.status} · 맞게 들어간 날 ${good}/5 · ${(t / 1000).toFixed(1)}초 · "${String(sp.text).slice(0, 50)}"` };
  } },
  // ---------- 앱 화면에서 버튼을 눌러 봄 ----------
  G: { name: "앱: Gross를 누르고 기다림 (PC가 GW 로그인에 25초) — 화면이 '응답 없음'이라며 다시 누르라고 하나", sc: { openDelay: 25000, limit: 120e3, spTest: { tick: 1000, redraw: 1000 } }, run: async (w) => {
    const a = await w.openApp(); await a.pressGross(); await sleep(18000);
    const mid = await a.gross(); const false18 = /응답 없음|다시 눌러/.test(mid.text);
    let again = false; if (!mid.disabled && false18) { await a.pressGross(); again = true; } // 화면이 시키는 대로 다시 누름
    const t = await w.waitDone(120e3, (d) => /done|error/.test((d.salesPush || {}).status) && !w.P.job); await sleep(1500); const end = await a.gross(), d = w.full();
    const good = Object.keys(d.forecast || {}).filter((x) => d.forecast[x].act === String(grossOf(x))).length;
    return { pass: !false18 && d.salesPush.status === "done" && good >= 1 && w.P.opened === 1, note: `18초 때 화면 "${mid.text}"${again ? " → 다시 누름" : ""} · 끝 "${end.text.slice(0, 40)}" · 창 ${w.P.opened}번 열림 · 받은 날 ${good} · ${t < 0 ? "2분 안에 안 끝남" : (t / 1000).toFixed(0) + "초"}` };
  } },
  H: { name: "앱: Gross를 누르고 20초 뒤 메뉴도 누름 (PC는 GW 로그인 6초)", sc: { openDelay: 6000, limit: 150e3, gross: () => ({ delay: 16000 }), spTest: { tick: 1000, redraw: 1000 }, salesTest: { q: 30000, emptyWait: 1200, retry: [300, 600], progEvery: 1500 } }, run: async (w) => {
    const a = await w.openApp(); await a.pressGross(); await sleep(20000);
    const m0 = await a.menu(); if (!m0.disabled) await a.pressMenu();
    const days = range(addDays(YDAY, -27), YDAY);
    const t = await w.waitDone(170e3, (d) => !w.P.job && /done|error/.test((d.salesPush || {}).status) && menuCheck(d, days).ok === 28 && Object.keys(d.forecast || {}).some((x) => d.forecast[x].act === String(grossOf(x))));
    await sleep(1200); const d = w.full(), c = menuCheck(d, days), g = Object.keys(d.forecast || {}).filter((x) => d.forecast[x].act === String(grossOf(x))).length, eg = await a.gross(), em = await a.menu();
    return { pass: t >= 0 && c.ok === 28 && g >= 1 && w.P.opened === 1 && /^✓/.test(eg.text) && /^✓/.test(em.text), note: `Gross 받은 날 ${g} · 메뉴 맞음 ${c.ok}/28 · 창 ${w.P.opened}번 · ${t < 0 ? "170초 안에 둘 다는 안 끝남" : (t / 1000).toFixed(0) + "초"} · Gross칸 "${eg.text.slice(0, 26)}" · 메뉴칸 "${em.text.slice(0, 30)}"` };
  } },
  I: { name: "앱: PC가 꺼져 있을 때 Gross를 누름 → (확장이 요청을 버리는 30분에 해당하는 시간 뒤) PC 켬", sc: { pcOn: false, waitMax: 8000, beatEvery: 3000, limit: 60e3, spTest: { tick: 700, redraw: 700, pendMax: 3000, bgMax: 7500, aliveWait: 2500, alive: 6000 } }, run: async (w) => {
    w.gas.post({ action: "set", key: "misAgent", value: { at: Date.now() - 3600e3, mode: "ondemand", ver: "1.7.0" } });
    const a = await w.openApp(); await a.pressGross(); await sleep(2500); const off = await a.gross();
    await sleep(7500); w.P.on = true; // 요청 뒤 10초 = 확장 기준 30분 넘김
    const t = await w.waitDone(40e3, (d) => (d.salesPush || {}).status === "done"); await sleep(1200); const end = await a.gross(), d = w.full();
    const good = Object.keys(d.forecast || {}).filter((x) => d.forecast[x].act === String(grossOf(x))).length;
    return { pass: t >= 0 && good >= 1, note: `PC 꺼진 동안 화면 "${off.text}" · PC 켠 뒤 ${t < 0 ? "40초 안에 안 받음 (요청이 버려짐)" : (t / 1000).toFixed(0) + "초 만에 받음"} · 끝 "${end.text.slice(0, 36)}" · 받은 날 ${good}` };
  } },
  J: { name: "앱: 메뉴 받는 중(약 25초) 화면에 진행 상황이 보이고 버튼이 잠기나", sc: { openDelay: 3000, limit: 120e3, menu: () => ({ delay: 700 }), spTest: { tick: 1000, redraw: 1000 } }, run: async (w) => {
    const a = await w.openApp(); await a.pressMenu(); await sleep(16000); const mid = await a.menu(), g = await a.gross();
    const t = await w.waitDone(120e3, (d) => !w.P.job && /done|error/.test((d.salesPush || {}).status)); await sleep(1200); const end = await a.menu(), d = w.full(), c = menuCheck(d, range(addDays(YDAY, -27), YDAY));
    return { pass: mid.disabled === true && !/응답 없음/.test(mid.text) && c.ok === 28 && w.P.opened === 1, note: `16초 때 "${mid.text}" (버튼 ${mid.disabled ? "잠김" : "열림"}) · Gross 버튼 ${g.disabled ? "잠김" : "열림"} · 끝 "${end.text.slice(0, 34)}" · 맞음 ${c.ok}/28 · 창 ${w.P.opened}번 · ${(t / 1000).toFixed(0)}초` };
  } },
  K: { name: "메뉴: MIS가 느려 시간 안에 다 못 받음 → 한 번 더 요청하면 이어서 받나", sc: { menu: () => ({ delay: 1500 }), salesTest: { budget: 14000, q: 3000, reserve: 1000, emptyWait: 1200, retry: [300, 600], progEvery: 1500 }, limit: 60e3 }, run: async (w) => {
    const from = addDays(YDAY, -9), days = range(from, YDAY); w.request({ kind: "menu", from, to: YDAY }); await w.waitDone(60e3, (d) => !w.P.job && /done|error/.test((d.salesPush || {}).status)); const d1 = w.full(), c1 = menuCheck(d1, days), t1 = String(d1.salesPush.text);
    await sleep(300); w.request({ kind: "menu", from, to: YDAY }); await w.waitDone(60e3, (d) => !w.P.job && /done|error/.test((d.salesPush || {}).status)); const d2 = w.full(), c2 = menuCheck(d2, days);
    return { pass: c1.wrong === 0 && c2.ok === 10 && c2.wrong === 0, note: `첫 번째: ${d1.salesPush.status} 맞음 ${c1.ok} 틀림 ${c1.wrong} · "${t1.slice(0, 60)}" → 두 번째: ${d2.salesPush.status} 맞음 ${c2.ok}/10 틀림 ${c2.wrong}` };
  } },
  L: { name: "지금까지 Gross(오늘) 조회: 학습 칸에 안 넣고 결과만", run: async (w) => {
    w.gas.post({ action: "set", key: "forecast", value: { [TODAY]: { fc: "4500000", act: "" } } });
    w.request({ kind: "now", from: TODAY, to: TODAY }); const t = await w.waitDone(40e3); const d = w.full(), sp = d.salesPush;
    return { pass: sp.status === "done" && sp.now === grossOf(TODAY) && d.forecast[TODAY].act === "", note: `${sp.status} · now ${sp.now} · 오늘 실제 칸 "${d.forecast[TODAY].act}" (비어 있어야 함) · ${(t / 1000).toFixed(1)}초` };
  } },
  M: { name: "앱: 받는 중에 폰에서 Forecast를 고침 → Gross 저장이 그 값을 덮지 않나", sc: { openDelay: 300, gross: () => ({ delay: 4000 }) }, run: async (w) => {
    const from = addDays(YDAY, -2); w.gas.post({ action: "set", key: "forecast", value: { [TODAY]: { fc: "1000000", act: "" }, [YDAY]: { fc: "3000000", act: "" } } });
    w.request({ from, to: YDAY }); await sleep(3000);
    w.gas.post({ action: "merge", key: "forecast", patch: { [TODAY]: { fc: "7777777" } } }); // 그새 폰에서 오늘 Forecast를 고침
    const t = await w.waitDone(40e3); const d = w.full();
    return { pass: d.salesPush.status === "done" && d.forecast[TODAY].fc === "7777777" && d.forecast[YDAY].act === String(grossOf(YDAY)), note: `${d.salesPush.status} · 오늘 Forecast "${d.forecast[TODAY].fc}" (7777777이어야 함) · 어제 실제 ${d.forecast[YDAY].act}` };
  } },
  N: { name: "메뉴: MIS가 아예 응답을 안 함 → 오래 붙잡지 않고 바로 알리나", sc: { menu: () => ({ delay: 60000 }), salesTest: { q: 2500, reserve: 1000, emptyWait: 1200, retry: [300, 600], progEvery: 1500 }, limit: 60e3 }, run: async (w) => {
    const from = addDays(YDAY, -9); w.request({ kind: "menu", from, to: YDAY }); const t = await w.waitDone(50e3); const sp = w.full().salesPush;
    return { pass: t >= 0 && t < 25e3 && sp.status === "error" && /응답하지 않아/.test(sp.text), note: `${sp.status} · ${t < 0 ? "50초 안에 안 끝남" : (t / 1000).toFixed(1) + "초"} · "${String(sp.text).slice(0, 80)}"` };
  } },
  O: { name: "Gross: 표가 두 개인 화면(합계 표가 먼저 채워짐)", sc: { pages: { "report2.html": "report3.html" }, gross: () => ({ delay: 900 }) }, run: async (w) => {
    const from = addDays(YDAY, -4); w.request({ from, to: YDAY }); const t = await w.waitDone(40e3); const d = w.full(), sp = d.salesPush;
    const good = range(from, YDAY).filter((x) => (d.forecast || {})[x] && d.forecast[x].act === String(grossOf(x))).length;
    return { pass: sp.status === "done" && good === 5, note: `${sp.status} · 맞게 들어간 날 ${good}/5 · ${(t / 1000).toFixed(1)}초 · "${String(sp.text).slice(0, 50)}"` };
  } },
  P: { name: "앱: PC는 켜져 있는데 요청을 못 받음(확장 멈춤) → 두 번 다시 보내고, 그래도 안 되면 분명히 알리나", sc: { pcDeaf: true, spTest: { tick: 600, redraw: 600, pendMax: 60000, quickMax: 2000, aliveWait: 60000, bgMax: 60000 } }, run: async (w) => {
    const a = await w.openApp(); await a.pressGross(); await sleep(1200); const s1 = await a.gross();
    await sleep(11000); const s2 = await a.gross(), sp = w.full().salesPush;
    return { pass: sp.re === 2 && /못 받았어요/.test(s2.text) && s2.disabled === false && !/응답 없음/.test(s1.text), note: `1초 때 "${s1.text}" · 12초 때 "${s2.text}" (버튼 ${s2.disabled ? "잠김" : "열림"}) · 다시 보낸 횟수 ${sp.re}` };
  } },
  Q: { name: "메뉴: 보고서 화면에 끝나지 않는 요청(세션 확인 등)이 늘 떠 있음", sc: { pages: { "menureport2.html": "menureport4.html" }, menu: (day) => (day === addDays(YDAY, -3) ? { empty: true } : null) }, run: async (w) => {
    const from = addDays(YDAY, -9), days = range(from, YDAY); w.request({ kind: "menu", from, to: YDAY }); const t = await w.waitDone(90e3); const d = w.full(), c = menuCheck(d, days, [addDays(YDAY, -3)]);
    return { pass: d.salesPush.status === "done" && c.ok === 10, note: `${d.salesPush.status} · 맞음 ${c.ok}/10 · ${(t / 1000).toFixed(1)}초 · "${String(d.salesPush.text).slice(0, 60)}"` };
  } },
  R: { name: "앱: PC가 첫 요청만 놓침(실제 11/12 21:55 사례) → 앱이 알아채 다시 보내 받아 오나", sc: { limit: 60e3, spTest: { tick: 600, redraw: 600, quickMax: 2500 } }, mk: () => ({ skipFirst: true }), run: async (w) => {
    const a = await w.openApp(); await a.pressGross(); await sleep(1500); const s1 = await a.gross();
    const t = await w.waitDone(40e3, (d) => (d.salesPush || {}).status === "done" && !w.P.job); await sleep(1200); const end = await a.gross(), d = w.full();
    const good = Object.keys(d.forecast || {}).filter((x) => d.forecast[x].act === String(grossOf(x))).length;
    return { pass: t >= 0 && good >= 1 && d.salesPush.re === 1 && /^✓/.test(end.text), note: `1.5초 때 "${s1.text}" · ${t < 0 ? "40초 안에 안 받음" : (t / 1000).toFixed(0) + "초 만에 받음"} · 다시 보낸 횟수 ${d.salesPush.re || 0} · 끝 "${end.text.slice(0, 36)}" · 받은 날 ${good}` };
  } },
};
const out = [];
for (const key of Object.keys(SC)) {
  if (ONLY.length && !ONLY.includes(key)) continue;
  const S = SC[key]; console.log(`\n[${key}] ${S.name}`);
  for (const v of Object.keys(VARS).sort().reverse()) {
    let pass = 0; const notes = [];
    for (let i = 0; i < N; i++) {
      const w = await world(v, S.mk ? { ...(S.sc || {}), ...S.mk() } : S.sc || {});
      let r; try { r = await S.run(w); } catch (e) { r = { pass: false, note: "시험 오류: " + e.message }; }
      const errs = w.log.filter((x) => /오류/.test(x)); await w.close();
      if (r.pass) pass++; notes.push(r.note + (errs.length ? ` · ${errs[0]}` : ""));
    }
    console.log(`  ${v === "old" ? "옛" : "새"} 버전: ${pass}/${N} 통과`); notes.forEach((n, i) => console.log(`     ${i + 1}) ${n}`));
    out.push({ key, name: S.name, v, pass, n: N, notes });
  }
}
await b.close();
console.log("\n요약"); out.forEach((o) => console.log(`${o.key} ${o.v === "old" ? "옛" : "새"} ${o.pass}/${o.n}  ${o.name}`));
if (arg("--json", "")) fs.writeFileSync(arg("--json", ""), JSON.stringify(out, null, 1));
process.exitCode = out.some((o) => o.v === "new" && o.pass < o.n) ? 1 : 0;
