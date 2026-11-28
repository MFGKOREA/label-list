// 발주 GW 전송 시험 (확장 gw-agent를 진짜로 올려서): 폰 [GW 전송](misPush pending) → 확장이 창을 열어 GW 로그인 → 경영정보 → MIS 주문등록 → 입력·저장 → misPush done
//  11/16 새로 만듦: 예전 e2e-extension.mjs는 확장 요청이 진짜 시트로 나가서 멈춰 둠. 이 시험은 e2e-auto.mjs처럼
//  크롬의 --host-resolver-rules로 시트·GW·MIS·GitHub Pages 주소를 모두 이 시험의 가짜 서버(127.0.0.1)로 보냄 → 진짜 서버에는 요청이 나가지 않음
//  자료도 지어낸 것만 씀(kv.json 필요 없음). 비밀번호는 시험용 가짜("tester"/"pw123")
// 사용: node order-src/test/gw/e2e-order.mjs [--v]
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../.."), EXT = REPO + "/gw-agent", V = process.argv.includes("--v");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gw-order-")), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", TMP + "/key.pem", "-out", TMP + "/cert.pem", "-days", "2", "-subj", "/CN=localhost"], { stdio: "ignore" });
const kday = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10), addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const T = kday(Date.now());
// 가짜 시트: 품목 60개(앞 3개만 발주), 매출·메뉴는 다 차 있음(상시 수집이 끼어들지 않게)
const GRP = { "온세물류": "46492", "새싹농산": "49212" };
const rows = Array.from({ length: 60 }, (_, i) => ({ name: "시험품목" + (i + 1), code: String(900001 + i), vendor: i % 5 === 4 ? "새싹농산" : "온세물류", unit: "EA", group: "" }));
const store = { "master.order": { rows }, forecast: {}, ["input." + T]: { "시험품목1": { s: "1", o: "3" }, "시험품목2": { s: "2", o: "5" }, "시험품목5": { s: "0", o: "2" }, "시험품목7": { s: "4", o: "" } } };
for (let i = 1; i < 60; i++) { const x = addDay(T, -i); store.forecast[x] = { fc: "100", act: "90" }; if (i <= 40) store["menuDay." + x] = { at: 1, rows: [{ m: "a", q: 1 }] }; }
for (let i = 0; i < 30; i++) store["pad" + i] = 1;
store.gwScout = { at: 1, menus: [] };
const master = rows.map((r) => ({ code: r.code, grp: GRP[r.vendor] }));
const writes = [], hits = [];
const mergeInto = (a, p) => { a = a && typeof a === "object" ? a : {}; Object.keys(p).forEach((k) => { if (p[k] === null) delete a[k]; else if (p[k] && typeof p[k] === "object" && !Array.isArray(p[k])) a[k] = mergeInto(a[k], p[k]); else a[k] = p[k]; }); return a; };
const pick = (o, ks) => { const out = {}; if (o) ks.forEach((k) => { if (o[k] != null) out[k] = o[k]; }); return out; };
const html = (rs, body, extra) => { rs.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...(extra || {}) }); rs.end(body); };
const srv = https.createServer({ key: fs.readFileSync(TMP + "/key.pem"), cert: fs.readFileSync(TMP + "/cert.pem") }, async (rq, rs) => {
  const host = String(rq.headers.host || "").replace(/:\d+$/, ""), u = new URL(rq.url, "https://x"), ck = rq.headers.cookie || "";
  let body = ""; for await (const c of rq) body += c;
  hits.push(host + u.pathname);
  const json = (o) => { rs.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); rs.end(JSON.stringify(o)); };
  if (/script\.google/.test(host)) {
    if (rq.method === "POST") { const b = JSON.parse(body); writes.push(JSON.parse(body)); if (b.action === "set") { if (b.value === null) delete store[b.key]; else store[b.key] = b.value; } else if (b.action === "merge") store[b.key] = mergeInto(store[b.key], b.patch); return json({ ok: true, data: { [b.key]: store[b.key] } }); }
    if (u.searchParams.get("status")) return json({ ok: true, status: { misPush: pick(store.misPush, ["date", "id", "at", "status", "startAt", "doneAt", "by"]), salesPush: pick(store.salesPush, ["id", "at", "status", "startAt", "doneAt"]), misAgent: pick(store.misAgent, ["at", "mode", "grid"]) }, ver: "1", locked: false });
    return json({ ok: true, data: store });
  }
  if (/github\.io/.test(host)) { const f = u.pathname.split("/").pop(); if (["gw-plan.json", "mis-sales.js", "mis-agent.js", "mis.js"].includes(f)) { rs.writeHead(200, { "Content-Type": f.endsWith(".json") ? "application/json" : "text/javascript", "Access-Control-Allow-Origin": "*" }); return rs.end(fs.readFileSync(REPO + "/" + f)); } rs.writeHead(404); return rs.end(); }
  if (/^gw\./.test(host)) { // 가짜 GW: 로그인 → 첫 화면(왼쪽 메뉴에 경영정보) → 누르면 MIS 새 창
    if (u.pathname === "/main_frame.aspx" && /gwS=1/.test(ck)) return html(rs, `<!doctype html><meta charset="utf-8"><body><iframe src="/menu.aspx" style="width:200px;height:300px"></iframe><div>HOME</div></body>`);
    if (u.pathname === "/menu.aspx") return html(rs, `<!doctype html><meta charset="utf-8"><body><ul><li><a href="#"><span>메일</span></a></li><li><a href="#" id="mis"><span>경영정보</span></a></li></ul><script>document.getElementById("mis").onclick=function(e){e.preventDefault();window.open("https://mis.madforgarlic.com:8443/MainFrame/Main.do?sso=1","_blank");}</script></body>`);
    if (/gwS=1/.test(ck)) { rs.writeHead(302, { location: "https://gw.madforgarlic.com/main_frame.aspx" }); return rs.end(); }
    return html(rs, `<!doctype html><meta charset="utf-8"><body><input type="text" value=""><input type="password"><button id="b">LOGIN</button><script>window.__tries=0;document.getElementById("b").onclick=function(){window.__tries++;if(document.querySelector("input[type=password]").value==="pw123"){document.cookie="gwS=1;path=/";location.href="/main_frame.aspx";}}</script></body>`);
  }
  if (/^mis\./.test(host)) { // 가짜 MIS: GW에서 넘어오면(sso) 로그인된 채로, 주문등록 화면은 mock/ 파일
    const f = u.pathname.split("/").pop();
    if (f === "Main.do") {
      if (u.searchParams.get("sso") === "1") { rs.writeHead(302, { location: "https://mis.madforgarlic.com:8443/MainFrame/Main.do", "set-cookie": "misS=1; Path=/" }); return rs.end(); }
      if (!/misS=1/.test(ck)) return html(rs, `<!doctype html><meta charset="utf-8"><body><input type="text" id="uid" value=""><input type="password" id="upw"><a href="#" id="go">LOGIN</a><script>document.getElementById("go").onclick=function(e){e.preventDefault();if(document.getElementById("upw").value==="pw123"&&document.getElementById("uid").value==="tester"){document.cookie="misS=1;path=/";location.reload();}}</script></body>`);
      return html(rs, `<!doctype html><meta charset="utf-8"><title>MIS</title><body style="margin:0"><iframe src="menu.html" style="width:200px;height:400px"></iframe><div id="tabs"></div><script>window.__master=${JSON.stringify(master)};window.__saved={"46492":{"900011":4},"49212":{"900015":2}};function openTab(s){var f=document.createElement("iframe");f.src=s;f.style.cssText="width:600px;height:400px";document.getElementById("tabs").appendChild(f);}</script></body>`);
    }
    const file = path.join(HERE, "mock", path.basename(f));
    if (fs.existsSync(file)) { rs.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" }); return rs.end(fs.readFileSync(file)); }
    rs.writeHead(404); return rs.end();
  }
  rs.writeHead(404); rs.end();
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
let fails = 0, n = 0; const ok = (c, m, extra) => { n++; console.log((c ? "통과 " : "실패 ") + m + (c || !extra ? "" : "\n   " + extra)); if (!c) fails++; };
console.log(`# 확장 ${ver} · 오늘 ${T} · 가짜 서버 127.0.0.1:${port} (진짜 서버로는 안 나감)`);

// 설정: 로그인 정보(가짜)·켜짐, 상시 수집은 끔
await setSt({ id: "tester", pw: "pw123", on: true, auto: false, tries: [] });
// 폰에서 [GW 전송]을 누른 것처럼
const t0 = Date.now();
store.misPush = { date: T, id: t0, at: t0, status: "pending", n: 3 };
// 끝날 때까지 지켜봄: MIS 창의 저장 내용(__saved)은 확장이 창을 닫기 전에 읽어 둠
let saved = null, sawRunning = false, sawMode = false, steps = new Set();
while (Date.now() - t0 < 170000 && !/done|error/.test(store.misPush.status)) {
  await sleep(1000);
  if (store.misPush.status === "running") sawRunning = true;
  if (store.misAgent && store.misAgent.step) steps.add(store.misAgent.step);
  if (store.misAgent && store.misAgent.mode === "ondemand") sawMode = true; // 끝나면 MIS 쪽 신호가 이 칸을 덮어씀
  for (const p of ctx.pages()) { if (!p.url().includes("Main.do")) continue; const s = await p.evaluate(() => window.__saved).catch(() => null); if (s && Object.keys(s).length) saved = s; }
  if (V && (Date.now() - t0) % 10000 < 1000) console.log("  …", Math.round((Date.now() - t0) / 1000) + "초", store.misPush.status, [...steps].slice(-1)[0] || "", ctx.pages().map((p) => p.url().slice(0, 50)).join(" | "));
}
await sleep(1500);
for (const p of ctx.pages()) { if (!p.url().includes("Main.do")) continue; const s = await p.evaluate(() => window.__saved).catch(() => null); if (s && Object.keys(s).length) saved = s; }
const P = store.misPush, sec = Math.round(((P.doneAt || Date.now()) - t0) / 1000);
ok(P.status === "done", `폰 전송 → 확장이 받아 MIS에 저장까지 끝냄 (${sec}초, 상태 ${P.status})`, JSON.stringify(P).slice(0, 400));
ok(P.saved === 3 && P.total === 3, `저장 결과 3/3개 (saved ${P.saved} / total ${P.total})`, String(P.text || "").slice(0, 300));
const flat = Object.assign({}, ...Object.values(saved || {}));
// 11/28 KM "앱에서 0이면 MIS에 따로 넣은 발주가 날아가면 안 돼": MIS에만 있던 발주(온세물류 품목11 = 4 · 새싹농산 품목15 = 2)는 그대로
ok(Number(flat["900011"]) === 4 && Number(flat["900015"]) === 2, `MIS에 직접 넣은 발주는 그대로 (품목11 = ${flat["900011"]} · 품목15 = ${flat["900015"]})`, JSON.stringify(saved));
ok(/MIS에만 있는 발주 2개는 그대로 둠/.test(String(P.text || "")) && !/0개로 정리|0으로/.test(String(P.text || "")), "결과 글에 'MIS에만 있는 발주 2개는 그대로 둠'", String(P.text || "").slice(0, 400));
ok(Number(flat["900001"]) === 3 && Number(flat["900002"]) === 5 && Number(flat["900005"]) === 2 && !flat["900007"], `MIS에 들어간 수량: 품목1 = 3 · 품목2 = 5 · 품목5(새싹농산) = 2 · 발주 안 넣은 품목7은 없음`, JSON.stringify(saved));
ok(saved && saved["46492"] && saved["49212"], "업체(주문그룹) 두 곳 모두에 나눠 저장", JSON.stringify(Object.keys(saved || {})));
ok(sawMode && steps.size >= 2, `확장이 진행 단계를 시트에 남김 (${steps.size}단계: ${[...steps].slice(0, 4).join(" → ")})`, JSON.stringify(store.misAgent).slice(0, 300));
const progs = writes.filter((w) => w.key === "misPush" && w.patch && w.patch.prog).map((w) => w.patch.prog); // 11/17 KM "로딩바 위에 어떤 상황인지"
ok(progs.some((x) => /화면 띄움/.test(x)) && progs.some((x) => /넣는 중/.test(x)) && progs.some((x) => /저장 중/.test(x)) && progs.some((x) => /저장됨 · 전체 3\/3개/.test(x)) && !("prog" in (writes.filter((w) => w.key === "misPush").pop().patch || {})), `폰에 보일 단계 글: ${progs.join(" → ")}`);
const keys = [...new Set(writes.map((w) => w.key))];
ok(keys.every((k) => ["misAgent", "misPush"].includes(k)), `시트에 쓴 칸은 misAgent · misPush뿐 (${keys.join(", ")})`);
ok(hits.some((h) => h.startsWith("gw.madforgarlic.com")) && hits.some((h) => h.startsWith("mis.madforgarlic.com")) && hits.some((h) => h.startsWith("script.google.com")), "GW · MIS · 시트 요청이 모두 가짜 서버로 옴");
let leftP = []; for (let i = 0; i < 10; i++) { leftP = ctx.pages().filter((p) => /madforgarlic/.test(p.url())); if (!leftP.length) break; await sleep(1000); }
const left = leftP.length;
ok(left === 0, `끝난 뒤 자동 창을 닫음 (남은 GW·MIS 탭 ${left}개)`, leftP.map((p) => p.url().slice(0, 80)).join(" | "));
const st = ((await getSt(["logs"])) || {}).logs || [];
if (V || fails) console.log("확장 기록:\n   " + st.slice(-14).map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n   "));
await ctx.close(); srv.close();
console.log(fails ? `실패 ${fails}개 / ${n}` : `모두 통과 (${n}개)`); process.exit(fails ? 1 : 0);
