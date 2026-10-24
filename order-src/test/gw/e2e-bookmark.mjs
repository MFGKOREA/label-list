// GW 전송 시험 (북마크 자동 대기): 가짜 MIS(주문현황+주문등록 탭) + 가짜 시트로 폰 [GW 전송] → PC 자동 대기 → 저장 → 폰 결과까지
// 사용: node order-src/test/gw/e2e-bookmark.mjs <kv.json>   (TWO=1 이면 자동 대기 탭 2개가 같이 받는 경우)    (kv.json은 시트 사본, 저장소에 넣지 않음. 진짜 시트·MIS에는 안 씀)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const KV = process.argv[2], HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../.."), TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
const store = JSON.parse(fs.readFileSync(KV, "utf8")).data;
const pad = (n) => String(n).padStart(2, "0"), d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 오늘 발주: 온세 3개 + 새싹 1개만 남김
const src = store["input.2026-10-23"], rows = store["master.order"].rows, byName = new Map(rows.map((r) => [r.name, r]));
const pick = Object.keys(src).filter((k) => +src[k].o > 0 && (byName.get(k) || {}).code);
const ons = pick.filter((k) => byName.get(k).vendor === "온세물류").slice(0, 3), sae = pick.filter((k) => byName.get(k).vendor === "새싹농산").slice(0, 1);
store["input." + TODAY] = Object.fromEntries([...ons, ...sae].map((k) => [k, { s: src[k].s, o: src[k].o }]));
console.log("TODAY", TODAY, "items", [...ons, ...sae].map((k) => `${k}=${src[k].o}`).join(", "));
const grpOf = { "온세물류": "46492", "새싹농산": "49212" };
const master = rows.filter((r) => r.code && grpOf[r.vendor]).map((r) => ({ code: String(r.code), grp: grpOf[r.vendor] }));
const writes = [];
const apiRoute = async (r) => {
  const q = r.request();
  if (q.method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(/ver=1/.test(q.url()) ? { ok: true, data: {} } : { ok: true, data: store }) });
  const b = JSON.parse(q.postData());
  if (b.action !== "set") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "알 수 없는 요청" }) });
  store[b.key] = b.value; writes.push(b.key + ":" + (b.value && b.value.status || ""));
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { [b.key]: b.value } }) });
};
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ timezoneId: "Asia/Seoul", viewport: { width: 390, height: 844 } });
await ctx.route("https://script.google.com/**", apiRoute);
await ctx.route("https://mfgkorea.github.io/label-list/mis.js*", (r) => r.fulfill({ path: REPO + "/mis.js", contentType: "text/javascript" }));
await ctx.route("https://mfgkorea.github.io/label-list/mis-agent.js*", (r) => r.fulfill({ path: REPO + "/mis-agent.js", contentType: "text/javascript" }));
await ctx.route("https://mis.test/**", (r) => r.fulfill({ path: HERE + "/mock/" + new URL(r.request().url()).pathname.slice(1) }));
const errs = [];
// PC: MIS 화면 + 북마크(자동 대기)
const pc = await ctx.newPage(); pc.on("pageerror", (e) => errs.push("pc " + e.message)); pc.on("dialog", (dl) => { console.log("PC dialog:", dl.message().split("\n")[0]); dl.accept(); });
await pc.goto("https://mis.test/main.html");
await pc.evaluate((m) => { window.__master = m; window.__saved = {}; }, master);
await pc.waitForTimeout(500);
await pc.evaluate(() => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = "https://mfgkorea.github.io/label-list/mis-agent.js?t=" + Date.now(); document.body.appendChild(s); });
// 탭 2개(북마크 자동 대기 2개)가 같이 받는 경우: TWO=1
if (process.env.TWO) {
  const pc2 = await ctx.newPage(); pc2.on("pageerror", (e) => errs.push("pc2 " + e.message)); pc2.on("dialog", (dl) => dl.accept());
  await pc2.goto("https://mis.test/main.html"); await pc2.evaluate((m) => { window.__master = m; window.__saved = {}; }, master); await pc2.waitForTimeout(500);
  await pc2.evaluate(() => { const s = document.createElement("script"); s.src = "https://mfgkorea.github.io/label-list/mis-agent.js?t=" + Date.now(); document.body.appendChild(s); });
  globalThis.__pc2 = pc2;
}
await pc.waitForTimeout(3000);
console.log("misAgent", JSON.stringify(store.misAgent), "title", await pc.title());
// 폰: 앱에서 보내기
const ph = await ctx.newPage(); ph.on("pageerror", (e) => errs.push("phone " + e.message)); ph.on("dialog", (dl) => { console.log("phone dialog:", dl.message().split("\n").slice(0, 2).join(" / ")); dl.accept(); });
await ph.goto("file://" + REPO + "/order.html");
await ph.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 });
await ph.waitForTimeout(1500);
console.log("bar:", (await ph.textContent("#misBar")).trim());
await ph.screenshot({ path: TMP + "/mis-1before.png", clip: { x: 0, y: 380, width: 390, height: 330 } });
await ph.click("#misGo"); await ph.waitForTimeout(1000);
console.log("after send:", (await ph.textContent("#misBar")).trim(), JSON.stringify(store.misPush));
for (let i = 0; i < 6 && !/done|error/.test((store.misPush || {}).status); i++) await pc.waitForTimeout(6000);
console.log("misPush", JSON.stringify(store.misPush));
console.log("saved in MIS", JSON.stringify(await pc.evaluate(() => window.__saved)), "saveCalls", await pc.evaluate(() => window.__saveCalls));
if (globalThis.__pc2) console.log("pc2 saved", JSON.stringify(await globalThis.__pc2.evaluate(() => window.__saved)), "saveCalls", await globalThis.__pc2.evaluate(() => window.__saveCalls));
for (let i = 0; i < 4 && !/저장 완료|확인 필요/.test(await ph.textContent("#misBar")); i++) await ph.waitForTimeout(6000);
console.log("phone bar:", (await ph.textContent("#misBar")).trim());
await ph.evaluate(() => document.getElementById("misBar").scrollIntoView({ block: "center" }));
await ph.screenshot({ path: TMP + "/mis-2after.png", clip: { x: 0, y: 300, width: 390, height: 240 } });
await pc.screenshot({ path: TMP + "/mis-pc.png" });
console.log("writes", writes.join(" "), "errors", errs);
await b.close();
