// MIS를 따라가는 GW 전송 시험 (11/28 KM "앱이 아닌 MIS에서 따로 넣은 발주가 있으면 앱에서 0이고 전송하면 MIS 날아가게 했어? · 너가 MIS를 따라가야지")
//  가짜 시트 + 가짜 MIS 주문등록(mock/grid.html) + 실제 mis-agent.js·mis.js. 자료는 지어낸 것만 씀
//  1) 오늘 처음 전송: MIS에 직접 넣은 값이 있으면 MIS를 따름(앱 발주칸도 그 값) · 앱에만 있는 품목은 앱 값을 넣음 · 앱 품목이 아닌 MIS 발주는 그대로
//  2) 다시 전송: 그 사이 MIS에서 바꾼 품목은 MIS를 따르고, 앱에서 바꾼 품목은 앱 값(앱에서 지운 것은 0)
// 사용: node order-src/test/gw/e2e-follow.mjs
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const pad = (n) => String(n).padStart(2, "0"), d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
const T = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rows = Array.from({ length: 6 }, (_, i) => ({ name: "품목" + (i + 1), code: String(800001 + i), vendor: "온세물류", unit: "EA" }));
const store = { "master.order": { rows }, ["input." + T]: { "품목1": { s: "1", o: "3" }, "품목2": { s: "2", o: "5" }, "품목3": { s: "0", o: "" }, "품목4": { s: "1", o: "2" } } };
// 1) MIS: 품목2 = 8(직접 넣음) · 품목3 = 4(직접 넣음, 앱은 빈칸) · 999999 = 7(앱에 없는 품목)
const MIS0 = { "46492": { "800002": 8, "800003": 4, "999999": 7 } };
const master = rows.map((r) => ({ code: r.code, grp: "46492" })).concat([{ code: "999999", grp: "46492" }]);
const mg = (c, p) => { const o = { ...(c && typeof c === "object" ? c : {}) }; Object.keys(p || {}).forEach((k) => { const v = p[k]; if (v === null) delete o[k]; else if (v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object") o[k] = mg(o[k], v); else o[k] = v; }); return o; };
const api = (r) => {
  const q = r.request(), u = new URL(q.url());
  if (q.method() === "GET") {
    const pk = (o, ks) => { const out = {}; if (o) ks.forEach((k) => { if (o[k] != null) out[k] = o[k]; }); return out; };
    if (u.searchParams.get("status")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, status: { misPush: pk(store.misPush, ["date", "id", "at", "status", "startAt", "doneAt", "by"]) } }) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: store }) });
  }
  const b = JSON.parse(q.postData());
  if (b.action === "set") store[b.key] = b.value; else if (b.action === "merge") store[b.key] = mg(store[b.key], b.patch);
  r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: store }) });
};
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "통과 " : "실패 ") + m); if (!c && x) console.log("   ", x); c ? pass++ : fail++; };
const send = async (mis) => {
  const ctx = await b.newContext({ timezoneId: "Asia/Seoul" }); await ctx.route("https://script.google.com/**", api);
  await ctx.route("https://mfgkorea.github.io/label-list/mis*.js*", (r) => r.fulfill({ path: REPO + "/" + new URL(r.request().url()).pathname.split("/").pop(), contentType: "text/javascript" }));
  await ctx.route("https://mis.test/**", (r) => { const f = new URL(r.request().url()).pathname.slice(1); if (f === "main.html") return r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><iframe src="grid.html"></iframe><script>window.__master=${JSON.stringify(master)};window.__saved=${JSON.stringify(mis)};</script></body>` }); r.fulfill({ path: HERE + "/mock/" + f }); });
  const p = await ctx.newPage(); p.on("dialog", (dl) => dl.accept());
  await p.goto("https://mis.test/main.html"); await p.waitForTimeout(600);
  store.misPush = { date: T, id: Date.now(), at: Date.now(), status: "pending" };
  await p.evaluate((u) => { const s = document.createElement("script"); s.src = u; document.body.appendChild(s); }, "https://mfgkorea.github.io/label-list/mis-agent.js?quiet=1&t=" + Date.now());
  for (let i = 0; i < 120 && !/done|error/.test(store.misPush.status); i++) await p.waitForTimeout(500);
  const saved = await p.evaluate(() => JSON.parse(JSON.stringify(window.__saved)));
  await ctx.close(); return (saved || {})["46492"] || {};
};
const inp = () => store["input." + T];
// 1) 오늘 처음
let m = await send(MIS0);
ok(store.misPush.status === "done", "1차 전송 끝 (" + store.misPush.status + ")", store.misPush.text);
ok(m["800001"] === 3 && m["800004"] === 2, `앱에만 있던 품목은 앱 값으로 MIS에 (품목1 = ${m["800001"]} · 품목4 = ${m["800004"]})`, JSON.stringify(m));
ok(m["800002"] === 8 && m["800003"] === 4, `MIS에 직접 넣은 값은 그대로 (품목2 = ${m["800002"]}, 앱은 5였음 · 품목3 = ${m["800003"]}, 앱은 빈칸)`, JSON.stringify(m));
ok(m["999999"] === 7, "앱 품목이 아닌 MIS 발주도 그대로 (7)", JSON.stringify(m));
ok(inp()["품목2"].o === "8" && inp()["품목3"].o === "4" && inp()["품목2"].mis === 1 && inp()["품목1"].o === "3" && !inp()["품목1"].mis, `앱 발주칸이 MIS를 따라옴 (품목2 ${inp()["품목2"].o} · 품목3 ${inp()["품목3"].o}, MIS 표시) · 품목1은 그대로 ${inp()["품목1"].o}`, JSON.stringify(inp()));
ok(/MIS 기준으로 맞춤 2개/.test(store.misPush.text) && /앱에 없는 품목의 MIS 발주 1개는 그대로 둠/.test(store.misPush.text) && !/0개로 정리/.test(store.misPush.text), "결과 글: MIS 기준으로 맞춤 2개 · 앱에 없는 MIS 발주 1개 그대로", store.misPush.text);
ok(store.misKnown && store.misKnown.date === T && store.misKnown.q["800002"] === 8 && store.misKnown.q["800001"] === 3 && store.misKnown.q["800005"] === 0, "맞춰진 값(misKnown) 기록", JSON.stringify(store.misKnown));
// 2) 그 사이: MIS에서 품목1을 3 → 10(직접) · 앱에서 품목4를 2 → 6, 품목2를 8 → 지움(취소)
const MIS1 = { "46492": { ...m, "800001": 10 } };
inp()["품목4"] = { ...inp()["품목4"], o: "6" }; inp()["품목2"] = { ...inp()["품목2"], o: "", mis: 0 };
m = await send(MIS1);
ok(store.misPush.status === "done", "2차 전송 끝 (" + store.misPush.status + ")", store.misPush.text);
ok(m["800001"] === 10 && inp()["품목1"].o === "10", `MIS에서 바꾼 품목1은 MIS를 따름 (MIS ${m["800001"]} · 앱 ${inp()["품목1"].o})`, JSON.stringify({ m, a: inp()["품목1"] }));
ok(m["800004"] === 6, `앱에서 바꾼 품목4는 앱 값으로 (MIS ${m["800004"]})`, JSON.stringify(m));
ok(!m["800002"], `앱에서 지운 품목2는 MIS에서도 0 (MIS ${m["800002"] ?? 0})`, JSON.stringify(m));
ok(m["800003"] === 4 && m["999999"] === 7, "건드리지 않은 품목3 · 앱에 없는 품목은 그대로", JSON.stringify(m));
console.log(`MIS 따라가기 시험 통과 ${pass} · 실패 ${fail}`);
await b.close(); process.exit(fail ? 1 : 0);
