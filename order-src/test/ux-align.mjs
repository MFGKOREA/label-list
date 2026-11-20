// 화면 정렬 점검 (11/20 KM "시각적 정렬"): 화면마다 큰 블록의 왼쪽·오른쪽 끝을 모아 봄(모두 16px이어야 함). 사용: node order-src/test/ux-align.mjs <폴더>  (<폴더>/../kv.json 사본, 캡처도 그 폴더에)
import fs from "fs";
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const S = process.argv[2]; const kv = fs.readFileSync(S + "/../kv.json", "utf8");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: "Asia/Seoul" }); const p = await ctx.newPage();
await p.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? kv : '{"ok":true,"data":{}}' }));
await p.goto("file://" + new URL("../../order.html", import.meta.url).pathname); await p.waitForTimeout(2500);
const go = { order: async () => p.click('#dock [data-dock="order"]'), foh: async () => p.click('#dock [data-dock="foh"]'), prep: async () => p.click('#dock [data-dock="prep"]'), forecast: async () => p.click('#dock [data-dock="forecast"]'), report: async () => p.click('#dock [data-dock="report"]'), files: async () => p.click('#dock [data-dock="files"]'), loc: async () => p.evaluate(() => document.querySelector('[data-go="loc"]').click()), log: async () => p.evaluate(() => document.querySelector('[data-go="log"]').click()) };
const out = {};
for (const [n, f] of Object.entries(go)) {
  await f(); await p.waitForTimeout(n === "log" ? 2000 : 900); await p.evaluate(() => scrollTo(0, 0));
  out[n] = await p.evaluate(() => {
    const view = [...document.querySelectorAll(".view")].find((v) => !v.hidden);
    const vis = (el) => { for (let x = el; x; x = x.parentElement) if (x.hidden || getComputedStyle(x).display === "none") return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const lab = (el) => (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + "<" + el.tagName.toLowerCase() + ">";
    // 1) 화면 블록의 왼쪽·오른쪽 끝 (view 안에서 폭이 화면 60% 넘는 블록, 맨 바깥 것만)
    const W = innerWidth, blocks = [];
    const walk = (el, depth) => { [...el.children].forEach((c) => { if (!vis(c)) return; const r = c.getBoundingClientRect(); if (r.width > W * 0.6 && depth < 4 && r.top < 6000) { blocks.push({ l: Math.round(r.left), r: Math.round(W - r.right), w: lab(c), y: Math.round(r.top + scrollY) }); if (!/group|cell|tiles|catgrid|week|logscroll/.test(c.className)) walk(c, depth + 1); } }); };
    walk(view, 0);
    const lefts = {}, rights = {}; blocks.forEach((x) => { lefts[x.l] = (lefts[x.l] || []).concat(x.w); rights[x.r] = (rights[x.r] || []).concat(x.w); });
    return { lefts: Object.fromEntries(Object.entries(lefts).map(([k, v]) => [k, v.slice(0, 6)])), rights: Object.fromEntries(Object.entries(rights).map(([k, v]) => [k, v.slice(0, 6)])) };
  });
  await p.screenshot({ path: `${S}/${n}.png`, fullPage: false });
  if (/^(loc|log)$/.test(n)) { await p.evaluate(() => { const bk = [...document.querySelectorAll(".view")].find((v) => !v.hidden)?.querySelector(".back"); bk && bk.click(); }); await p.waitForTimeout(400); }
}
fs.writeFileSync(S + "/align.json", JSON.stringify(out, null, 1));
for (const [n, o] of Object.entries(out)) console.log(n, "왼쪽", JSON.stringify(o.lefts).slice(0, 400), "\n   오른쪽", JSON.stringify(o.rights).slice(0, 300));
await b.close();
