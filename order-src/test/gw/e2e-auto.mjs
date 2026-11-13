// 상시 수집 시험 (확장 gw-agent 1.8.0을 진짜로 올려서): 폰에서 누르지 않아도 PC가 스스로 요청하는지, 발주 전송이 오면 양보하는지, 끄면 멈추는지
//  크롬의 --host-resolver-rules로 시트·GW·MIS·GitHub Pages 주소를 모두 이 시험의 가짜 서버(127.0.0.1)로 보냄 → 진짜 서버에는 요청이 나가지 않음
// 사용: node order-src/test/gw/e2e-auto.mjs [--v]
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../.."), EXT = REPO + "/gw-agent", V = process.argv.includes("--v");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gw-auto-")), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", TMP + "/key.pem", "-out", TMP + "/cert.pem", "-days", "2", "-subj", "/CN=localhost"], { stdio: "ignore" });
const kday = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10), addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const T = kday(Date.now()), Y = addDay(T, -1);
// 가짜 시트: 어제 실제 매출만 비어 있고, MIS 메뉴 살펴보기(gwScout)도 아직 없음
const store = { "master.order": { rows: Array.from({ length: 120 }, (_, i) => [i]) }, forecast: {} };
for (let i = 1; i < 60; i++) { const x = addDay(T, -i); store.forecast[x] = { fc: "100", act: i === 1 ? "" : "90" }; if (i <= 40) store["menuDay." + x] = { at: 1, rows: [{ m: "a", q: 1 }] }; }
for (let i = 0; i < 30; i++) store["pad" + i] = 1;
const writes = [];
const mergeInto = (a, p) => { a = a && typeof a === "object" ? a : {}; Object.keys(p).forEach((k) => { if (p[k] === null) delete a[k]; else if (p[k] && typeof p[k] === "object" && !Array.isArray(p[k])) a[k] = mergeInto(a[k], p[k]); else a[k] = p[k]; }); return a; };
const pick = (o, ks) => { const out = {}; if (o) ks.forEach((k) => { if (o[k] != null) out[k] = o[k]; }); return out; };
const srv = https.createServer({ key: fs.readFileSync(TMP + "/key.pem"), cert: fs.readFileSync(TMP + "/cert.pem") }, async (rq, rs) => {
  const host = String(rq.headers.host || "").replace(/:\d+$/, ""), u = new URL(rq.url, "https://x");
  let body = ""; for await (const c of rq) body += c;
  const json = (o) => { rs.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); rs.end(JSON.stringify(o)); };
  if (/script\.google/.test(host)) {
    if (rq.method === "POST") { const b = JSON.parse(body); writes.push(JSON.parse(body)); if (b.action === "set") { if (b.value === null) delete store[b.key]; else store[b.key] = b.value; } else if (b.action === "merge") store[b.key] = mergeInto(store[b.key], b.patch); return json({ ok: true, data: { [b.key]: store[b.key] } }); }
    if (u.searchParams.get("status")) return json({ ok: true, status: { misPush: pick(store.misPush, ["date", "id", "at", "status", "startAt", "doneAt", "by"]), salesPush: pick(store.salesPush, ["id", "at", "status", "startAt", "doneAt"]), misAgent: pick(store.misAgent, ["at", "mode", "grid"]) }, ver: "1", locked: false });
    return json({ ok: true, data: store });
  }
  if (/github\.io/.test(host)) { const f = u.pathname.split("/").pop(); if (f === "gw-plan.json" || f === "mis-sales.js" || f === "mis-agent.js" || f === "mis.js") { rs.writeHead(200, { "Content-Type": f.endsWith(".json") ? "application/json" : "text/javascript", "Access-Control-Allow-Origin": "*" }); return rs.end(fs.readFileSync(REPO + "/" + f)); } }
  rs.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); rs.end("<!doctype html><meta charset=utf-8><title>가짜 GW</title><body>가짜 GW (메뉴 없음)</body>");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const rules = ["gw.madforgarlic.com", "mis.madforgarlic.com", "script.google.com", "script.googleusercontent.com", "mfgkorea.github.io"].map((h) => `MAP ${h} 127.0.0.1:${port}`).concat(["MAP * ~NOTFOUND", "EXCLUDE 127.0.0.1", "EXCLUDE localhost"]).join(", ");
const ctx = await chromium.launchPersistentContext(TMP + "/prof", {
  executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined, headless: true, env: { ...process.env, TZ: "Asia/Seoul" },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=${rules}`, "--ignore-certificate-errors", "--no-proxy-server"],
});
const getSW = async () => ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) || (await ctx.waitForEvent("serviceworker", { timeout: 40000 }));
const sw = async (fn, a) => { for (let i = 0; i < 6; i++) { try { return await (await getSW()).evaluate(fn, a); } catch (e) { await sleep(400); } } return null; };
const extId = (await getSW()).url().split("/")[2], ver = await sw(() => chrome.runtime.getManifest().version);
const pop = await ctx.newPage(); await pop.goto(`chrome-extension://${extId}/popup.html`); // 서비스 워커가 잠들지 않게 확장 화면 하나를 열어 둠
const setSt = (o) => sw((o) => chrome.storage.local.set(o), o), getSt = (k) => sw((k) => chrome.storage.local.get(k), k);
const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await fn(); if (r) return r; await sleep(500); } return null; };
const pcReqs = () => writes.filter((w) => w.key === "salesPush" && w.action === "set" && w.value && w.value.src === "pc");
let fails = 0, n = 0; const ok = (c, m, extra) => { n++; console.log((c ? "통과 " : "실패 ") + m + (c || !extra ? "" : "\n   " + extra)); if (!c) fails++; };
console.log(`# 확장 ${ver} · 오늘 ${T} · 어제 ${Y} · 가짜 서버 127.0.0.1:${port}`);
const LIM = { autoEvery: 4000, autoIdle: 4000, autoAnyTime: true }; // 시험: 4초마다 확인, 발주 시간대·밤에도

// 1) 스스로 요청: 어제 매출이 비었고 계획에 메뉴 살펴보기가 있음 → 한 요청에 둘 다, 그리고 창을 열어 일을 시작
await setSt({ id: "tester", pw: "pw123", on: true, auto: true, tries: [], limits: LIM, autoSt: { next: 0 } });
const r1 = await until(() => pcReqs()[0], 75000);
const q1 = r1 && r1.value;
ok(!!q1 && q1.status === "pending" && q1.to === Y && !q1.kind && q1.also && q1.also.scout && !q1.also.menu, "어제 매출이 비면 PC가 스스로 요청 (매출 + 메뉴 살펴보기를 한 요청에)", JSON.stringify(q1));
const j1 = await until(async () => { const { job } = (await getSt("job")) || {}; return job && job.kind === "sales" ? job : null; }, 20000);
ok(!!j1 && q1 && j1.id === "s" + q1.id, "그 요청으로 자동 창을 엶 (폰 버튼과 같은 길)", JSON.stringify(j1 && { kind: j1.kind, id: j1.id }));
const st1 = ((await getSt("autoSt")) || {}).autoSt || {};
ok(st1.n === 1 && st1.reqId === (q1 && q1.id) && /스스로 받는 중/.test(st1.msg || ""), "확장 설정 창에 보일 상태가 남음", JSON.stringify(st1));
await sleep(6000);
ok(pcReqs().length === 1, "받는 중에는 또 요청하지 않음 (" + pcReqs().length + "번)");

// 2) 발주가 먼저: 스스로 받던 중에 폰에서 [GW 전송] → 받던 것을 멈추고 발주 창으로
store.misPush = { date: T, id: 777, at: Date.now(), status: "pending", n: 3 };
const e2 = await until(() => (store.salesPush && store.salesPush.status === "error" && /발주 전송이 먼저/.test(store.salesPush.text || "") ? store.salesPush : null), 20000);
ok(!!e2, "발주 전송이 오면 스스로 받던 매출을 멈춤", JSON.stringify(pick(store.salesPush, ["status", "text"])));
const j2 = await until(async () => { const { job } = (await getSt("job")) || {}; return job && job.kind === "order" ? job : null; }, 20000);
ok(!!j2 && j2.id === "o777", "곧바로 발주 창을 엶", JSON.stringify(j2 && { kind: j2.kind, id: j2.id }));
store.misPush = { ...store.misPush, status: "done", doneAt: Date.now() + 1000 };
await until(async () => !((await getSt("job")) || {}).job, 20000);

// 3) 끄면 멈춤
const before3 = pcReqs().length;
await setSt({ auto: false, autoSt: { next: 0 } });
await sleep(12000);
ok(pcReqs().length === before3, "상시 수집을 끄면 스스로 요청하지 않음");

// 4) 다 받아 뒀으면 요청 없이 쉼
store.forecast[Y].act = "88"; store.gwScout = { at: 1, menus: [] }; store.hourProbe = { at: 1, grids: [] }; store.salesPush = { id: 1, at: Date.now() - 3600e3, status: "done", doneAt: Date.now() - 3500e3 };
await setSt({ auto: true, autoSt: { next: 0 } });
const st4 = await until(async () => { const s = ((await getSt("autoSt")) || {}).autoSt || {}; return s.okAt ? s : null; }, 20000);
ok(!!st4 && st4.msg === "다 받아 둠" && pcReqs().length === before3, "다 받아 뒀으면 요청 없이 쉼", JSON.stringify(st4));

// 5) 하루 4번까지만: 계속 못 받아도 MIS를 끝없이 두드리지 않음
store.forecast[Y].act = "";
await setSt({ autoSt: { day: await sw(() => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }), n: 4, next: 0 } });
const st5 = await until(async () => { const s = ((await getSt("autoSt")) || {}).autoSt || {}; return /내일 다시/.test(s.msg || "") ? s : null; }, 20000);
ok(!!st5 && pcReqs().length === before3, "하루 4번 요청한 뒤에는 내일까지 쉼", JSON.stringify(st5));

// 6) 시트가 비정상이면 아무것도 쓰지 않음
const keepFc = store.forecast; store.forecast = {};
const w6 = writes.length;
await setSt({ autoSt: { next: 0 } });
const st6 = await until(async () => { const s = ((await getSt("autoSt")) || {}).autoSt || {}; return /시트 비정상/.test(s.msg || "") ? s : null; }, 20000);
ok(!!st6 && writes.filter((w) => w.key === "salesPush").length === writes.slice(0, w6).filter((w) => w.key === "salesPush").length, "시트가 비어 보이면 요청하지 않음", JSON.stringify(st6));
store.forecast = keepFc;

if (V) console.log(writes.map((w) => `${w.action} ${w.key} ${JSON.stringify(w.value || w.patch).slice(0, 100)}`).join("\n"));
console.log(`합계: 통과 ${n - fails} · 실패 ${fails}`);
await ctx.close(); srv.close(); fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
