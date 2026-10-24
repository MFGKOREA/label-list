// GW 전송 시험 (크롬 확장 gw-agent): 가짜 GW 로그인 → 경영정보 → 가짜 MIS → 주문등록 → 자동 대기 → 저장
// 사용: node order-src/test/gw/e2e-extension.mjs <kv.json>
//  한계: 확장·새 창이 연 탭은 Playwright 가로채기가 안 돼서 첫 탭은 테스트가 다시 열어 줌(GW→MIS 새 창 넘어가기는 실제 PC에서 확인)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const KV = process.argv[2], HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../.."), TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")), EXT = REPO + "/gw-agent";
const store = JSON.parse(fs.readFileSync(KV, "utf8")).data;
const pad = (n) => String(n).padStart(2, "0"), d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const src = store["input.2026-10-23"], rows = store["master.order"].rows, byName = new Map(rows.map((r) => [r.name, r]));
const pick = Object.keys(src).filter((k) => +src[k].o > 0 && (byName.get(k) || {}).code && byName.get(k).vendor === "온세물류").slice(0, 2);
store["input." + TODAY] = Object.fromEntries(pick.map((k) => [k, { s: src[k].s, o: src[k].o }]));
delete store.misAgent; delete store.misPush;
const grpOf = { "온세물류": "46492", "새싹농산": "49212" };
const master = rows.filter((r) => r.code && grpOf[r.vendor]).map((r) => ({ code: String(r.code), grp: grpOf[r.vendor] }));
const writes = [];
const ctx = await chromium.launchPersistentContext(TMP + "/prof", { executablePath: "/opt/pw-browsers/chromium", headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
await ctx.route("https://script.google.com/**", async (r) => {
  const q = r.request();
  if (q.method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: store }) });
  const b = JSON.parse(q.postData()); store[b.key] = b.value; writes.push(b.key + ":" + ((b.value && b.value.status) || ""));
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
});
await ctx.route("https://mfgkorea.github.io/label-list/mis.js*", (r) => r.fulfill({ path: REPO + "/mis.js", contentType: "text/javascript" }));
await ctx.route("https://mfgkorea.github.io/label-list/mis-agent.js*", (r) => r.fulfill({ path: REPO + "/mis-agent.js", contentType: "text/javascript" }));
let logins = 0;
await ctx.route("https://gw.madforgarlic.com/**", (r) => {
  const u = new URL(r.request().url()), ck = r.request().headers()["cookie"] || "";
  if (u.pathname === "/main_frame.aspx" && /gwS=1/.test(ck)) return r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><iframe src="/menu.aspx" style="width:200px;height:300px"></iframe><div>HOME</div></body>` });
  if (u.pathname === "/menu.aspx") return r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><ul><li><a href="#"><span>메일</span></a></li><li><a href="#" id="mis"><span>경영정보</span></a></li></ul><script>document.getElementById("mis").onclick=function(e){e.preventDefault();window.open("https://mis.madforgarlic.com:8443/MainFrame/Main.do?sso=1","_blank");}</script></body>` });
  if (/gwS=1/.test(ck)) return r.fulfill({ status: 302, headers: { location: "https://gw.madforgarlic.com/main_frame.aspx" } });
  return r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><input type="text" value="tester"><input type="password"><button id="b">LOGIN</button><script>document.getElementById("b").onclick=function(){if(document.querySelector("input[type=password]").value==="pw123"){document.cookie="gwS=1;path=/";location.href="/main_frame.aspx";}}</script></body>` });
});
await ctx.route("https://mis.madforgarlic.com:8443/**", (r) => {
  const u = new URL(r.request().url()), ck = r.request().headers()["cookie"] || "";
  const f = u.pathname.split("/").pop();
  if (f === "Main.do") {
    if (u.searchParams.get("sso") === "1") return r.fulfill({ status: 302, headers: { location: "https://mis.madforgarlic.com:8443/MainFrame/Main.do", "set-cookie": "misS=1; Path=/" } });
    if (!/misS=1/.test(ck)) return r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><input type="text" id="uid" value=""><input type="password" id="upw"><a href="#" id="go">LOGIN</a><script>document.getElementById("go").onclick=function(e){e.preventDefault();window.__lg=(window.__lg||0)+1;if(document.getElementById("upw").value==="pw123"&&document.getElementById("uid").value==="tester"){document.cookie="misS=1;path=/";location.reload();}else{document.body.insertAdjacentHTML("beforeend","<p>bad</p>")}}</script></body>` });
    return r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>MIS</title><body style="margin:0"><iframe src="menu.html" style="width:200px;height:400px"></iframe><div id="tabs"></div><script>window.__master=${JSON.stringify(master)};window.__saved={};function openTab(s){var f=document.createElement("iframe");f.src=s;f.style.cssText="width:600px;height:400px";document.getElementById("tabs").appendChild(f);}</script></body>` });
  }
  return r.fulfill({ path: HERE + "/mock/" + f });
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];
const pop = await ctx.newPage();
await pop.goto(`chrome-extension://${extId}/popup.html`);
await pop.fill("#id", "tester"); await pop.fill("#pw", "pw123"); await pop.check("#on"); await pop.click("#save");
console.log("saved settings");
let t0 = null; for (let i = 0; i < 60 && !t0; i++) { await pop.waitForTimeout(500); t0 = ctx.pages().find((p) => p !== pop && !/^about:blank$/.test(p.url()) && !p.url().startsWith("chrome-extension")); if (i % 10 === 0) console.log("pages", ctx.pages().map((p) => p.url())); }
{ const t = t0; console.log("ext tab before:", t && t.url()); t.on("console", (m) => console.log("tab console:", m.text())); t.on("pageerror", (e) => console.log("tab err:", e.message)); await t.goto("https://gw.madforgarlic.com/").catch((e) => console.log("goto err", e.message.split("\n")[0])); }
for (let i = 0; i < 20 && !store.misAgent; i++) {
  await pop.waitForTimeout(2000);
  // 테스트 도구 한계: 확장·새 창이 연 탭은 가짜 서버로 안 가서 chrome-error → 같은 탭에서 GW가 열려던 주소로 다시
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-error") && !p.__fixed) { p.__fixed = 1; console.log("fix popup tab"); p.goto("https://mis.madforgarlic.com:8443/MainFrame/Main.do?sso=1").then(() => console.log("popup now", p.url()), (e) => console.log("popup goto err", e.message.split("\n")[0])); }
}
{ const t = ctx.pages().find((p) => p.url().includes("Main.do")); if (t) console.log("frames:", t.frames().map((f) => f.url()).join(" , "), "| body:", (await t.evaluate(() => document.body.innerText)).slice(0, 80)); }
console.log("misAgent", JSON.stringify(store.misAgent));
const tabs = ctx.pages().map((p) => p.url()); console.log("tabs", tabs);
// 폰에서 전송한 것처럼
store.misPush = { date: TODAY, id: Date.now(), at: Date.now(), status: "pending", n: pick.length };
for (let i = 0; i < 20 && !/done|error/.test(store.misPush.status); i++) await pop.waitForTimeout(3000);
console.log("misPush", JSON.stringify(store.misPush));
const mis = ctx.pages().find((p) => p.url().includes("Main.do")); console.log("pages at end", ctx.pages().map((p) => p.url()).join(" , "));
{ const pp = await ctx.newPage(); await pp.goto(`chrome-extension://${extId}/popup.html`); await pp.waitForTimeout(1000); console.log("LOG:", (await pp.textContent("#log")).split("\n").join(" / ")); }
if (!mis) process.exit(1);
console.log("saved in MIS", JSON.stringify(await mis.evaluate(() => window.__saved)));
await pop.reload(); await pop.waitForTimeout(1500); console.log("popup:", (await pop.textContent("#st")).replace(/\s+/g, " "), "|", (await pop.textContent("#log")).split("\n").slice(0, 4).join(" / "));
console.log("writes", writes.join(" "));
await ctx.close();
