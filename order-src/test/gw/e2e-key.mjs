// 가게 키(시트 잠금) 시험: 가짜 Apps Script가 APP_KEY로 잠겨 있을 때
//  1) 앱: 키 없이 열면 한 번 물어봄 → 넣으면 읽기·쓰기에 키가 붙음, 틀린 키는 거절
//  2) PC 자동 대기(mis-agent.js): 확장이 키를 넣어 주면 GW 전송 저장, 키가 없으면 저장 안 함(대기 그대로)
//  3) 키 없이 되는 건 전송 상태(status=1)뿐 — 품목·수량이 안 나오는지
// 사용: node order-src/test/gw/e2e-key.mjs <kv.json>
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const store = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).data;
const KEY = "store-123";
const pad = (n) => String(n).padStart(2, "0"), d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
const T = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rows = store["master.order"].rows, src = store["input.2026-10-23"], byName = new Map(rows.map((r) => [r.name, r]));
const pick = Object.keys(src).filter((k) => +src[k].o > 0 && (byName.get(k) || {}).code && byName.get(k).vendor === "온세물류").slice(0, 2);
store["input." + T] = Object.fromEntries(pick.map((k) => [k, { s: "", o: src[k].o }]));
delete store.misPush; delete store.misAgent;
const log = { get: [], post: [] };
// Code.gs와 같은 규칙의 가짜 서버
const api = (r) => {
  const q = r.request(), u = new URL(q.url());
  if (q.method() === "GET") {
    log.get.push(u.searchParams.get("k"));
    if (u.searchParams.get("status")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, locked: true, status: { misPush: store.misPush ? { status: store.misPush.status, date: store.misPush.date } : {}, salesPush: {}, misAgent: {} } }) });
    if (u.searchParams.get("k") !== KEY) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, auth: true, error: "가게 키가 필요해요" }) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: store }) });
  }
  const b = JSON.parse(q.postData()); log.post.push(b.k);
  if (b.k !== KEY) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, auth: true, error: "가게 키가 필요해요" }) });
  if (b.action === "set") store[b.key] = b.value;
  r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: store }) });
};
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); c ? pass++ : fail++; };

// 1) 앱
{
  const ctx = await b.newContext({ timezoneId: "Asia/Seoul" }); await ctx.route("https://script.google.com/**", api);
  const p = await ctx.newPage(); let asked = 0;
  p.on("dialog", (dl) => { if (dl.type() === "prompt") { asked++; dl.accept(KEY); } else dl.dismiss(); });
  await p.goto("file://" + REPO + "/order.html");
  await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.db()["master.order"], null, { timeout: 60000 });
  ok(asked === 1, `앱이 키를 한 번만 물어봄 (${asked}번)`);
  ok(log.get.includes(KEY), "키를 넣은 뒤 읽기에 키가 붙음");
  const inp = p.locator("#v-main .cell input").first(); await inp.fill("3"); await inp.dispatchEvent("change"); await p.waitForTimeout(1500);
  ok(log.post.length > 0 && log.post.every((k) => k === KEY), `쓰기에 키가 붙음 (${log.post.length}건)`);
  await ctx.close();
}
// 2) 틀린 키는 거절
{
  const r = await fetch("https://example.invalid").catch(() => null); void r;
  log.get.length = 0;
  const ctx = await b.newContext(); await ctx.route("https://script.google.com/**", api);
  const p = await ctx.newPage(); await p.goto("about:blank");
  const j = await p.evaluate(async () => (await fetch("https://script.google.com/macros/s/x/exec?api=1&k=wrong")).json());
  ok(j.ok === false && j.auth === true, "틀린 키 읽기 거절");
  const s = await p.evaluate(async () => (await fetch("https://script.google.com/macros/s/x/exec?api=1&status=1")).json());
  ok(s.ok && s.status && !JSON.stringify(s).includes("input."), "키 없이 전송 상태만 보임 (품목·수량 없음)");
  await ctx.close();
}
// 3) PC 자동 대기: 키 있음 → 저장 / 키 없음 → 저장 안 함
for (const withKey of [true, false]) {
  const ctx = await b.newContext({ timezoneId: "Asia/Seoul" }); await ctx.route("https://script.google.com/**", api);
  await ctx.route("https://mfgkorea.github.io/label-list/mis*.js*", (r) => r.fulfill({ path: REPO + "/" + new URL(r.request().url()).pathname.split("/").pop(), contentType: "text/javascript" }));
  const master = rows.filter((r) => r.code && r.vendor === "온세물류").map((r) => ({ code: String(r.code), grp: "46492" }));
  await ctx.route("https://mis.test/**", (r) => { const f = new URL(r.request().url()).pathname.slice(1); if (f === "main.html") return r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><iframe src="grid.html"></iframe><script>window.__master=${JSON.stringify(master)};window.__saved={};</script></body>` }); r.fulfill({ path: HERE + "/mock/" + f }); });
  const p = await ctx.newPage(); p.on("dialog", (dl) => dl.accept());
  await p.goto("https://mis.test/main.html"); await p.waitForTimeout(600);
  store.misPush = { date: T, id: Date.now(), at: Date.now(), status: "pending", n: pick.length };
  await p.evaluate((u) => { const s = document.createElement("script"); s.src = u; document.body.appendChild(s); }, "https://mfgkorea.github.io/label-list/mis-agent.js?quiet=1&t=1" + (withKey ? "&k=" + KEY : ""));
  for (let i = 0; i < 30 && !/done|error/.test(store.misPush.status); i++) await p.waitForTimeout(500);
  const saved = await p.evaluate(() => JSON.stringify(window.__saved));
  if (withKey) ok(store.misPush.status === "done" && saved.includes("46492"), `키 있는 자동 대기 → 저장 (${store.misPush.status})`);
  else ok(store.misPush.status === "pending" && saved === "{}", `키 없는 자동 대기 → 저장 안 함 (${store.misPush.status}, MIS ${saved})`);
  await ctx.close();
}
await b.close();
console.log(`합계: 통과 ${pass} · 실패 ${fail}`);
process.exitCode = fail ? 1 : 0;
