import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const HTML = "file://" + path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../order.html");
// 사용: node order-src/test/ux-audit.mjs <kv.json이 있는 폴더>  (결과·캡처도 그 폴더에. 시트에는 안 씀 — 요청은 모두 가짜 응답)
const S = process.argv[2]; if (!S) { console.log("사용: node ux-audit.mjs <kv.json 폴더>"); process.exit(2); }
const kv = fs.readFileSync(S + "/kv.json", "utf8");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const SCREENS = [
  ["order", async (p) => { await p.click('#dock [data-dock="order"]'); }],
  ["foh", async (p) => { await p.click('#dock [data-dock="foh"]'); }],
  ["prep", async (p) => { await p.click('#dock [data-dock="prep"]'); }],
  ["forecast", async (p) => { await p.click('#dock [data-dock="forecast"]'); }],
  ["report", async (p) => { await p.click('#dock [data-dock="report"]'); }],
  ["files", async (p) => { await p.evaluate(() => { const g = [...document.querySelectorAll('[data-go="loc"]')][0]; }); await p.evaluate(() => window.__go && window.__go("files")); }],
  ["loc-boh", async (p) => { await p.evaluate(() => document.querySelector('[data-go="loc"]').click()); }],
  ["loc-foh", async (p) => { await p.evaluate(() => document.querySelector('[data-go="loc"]').click()); await p.waitForTimeout(400); await p.click('#locScope button[data-s="foh"]'); }],
  ["log", async (p) => { await p.evaluate(() => document.querySelector('[data-go="log"]').click()); }],
];
const out = [];
for (const w of [360, 390, 430]) for (const scheme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme, timezoneId: "Asia/Seoul", hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? kv : '{"ok":true,"data":{}}' }));
  await p.goto(HTML); await p.waitForTimeout(2500);
  for (const [name, open] of SCREENS) {
    if (name === "files") continue;
    try { await open(p); } catch (e) { out.push({ w, scheme, name, err: String(e.message).slice(0, 80) }); continue; }
    await p.waitForTimeout(name === "log" ? 2500 : 900);
    const r = await p.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let x = el; x; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === "none" || s.visibility === "hidden" || x.hidden) return false; } return true; };
      const view = [...document.querySelectorAll(".view")].find((v) => !v.hidden) || document.body;
      const lab = (el) => (el.id ? "#" + el.id : "") + "." + String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className).trim().split(/\s+/).slice(0, 2).join(".") + " «" + (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28) + "»";
      const W = window.innerWidth, res = { hscroll: document.documentElement.scrollWidth - W, clip: [], off: [], tap: [], tiny: [], overlap: [] };
      const inScroll = (el) => { for (let x = el.parentElement; x; x = x.parentElement) { const s = getComputedStyle(x); if (/auto|scroll/.test(s.overflowX) && x.scrollWidth > x.clientWidth + 2) return true; } return false; };
      const seen = new Set();
      view.querySelectorAll("*").forEach((el) => {
        if (!vis(el)) return; const s = getComputedStyle(el), r = el.getBoundingClientRect();
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && (s.overflow !== "visible" || s.overflowX !== "visible") && el.scrollWidth > el.clientWidth + 1 && !/auto|scroll/.test(s.overflowX)) { const k = "c" + lab(el); if (!seen.has(k)) { seen.add(k); res.clip.push(lab(el) + ` ${el.clientWidth}<${el.scrollWidth}`); } }
        if (own && (r.right > W + 1 || r.left < -1) && !inScroll(el)) { const k = "o" + lab(el); if (!seen.has(k)) { seen.add(k); res.off.push(lab(el) + ` L${Math.round(r.left)} R${Math.round(r.right)}`); } }
        if (own && parseFloat(s.fontSize) < 10) { const k = "t" + el.className + s.fontSize; if (!seen.has(k)) { seen.add(k); res.tiny.push(lab(el) + " " + s.fontSize); } }
        if (/^(BUTTON|A|INPUT|SELECT)$/.test(el.tagName) && el.type !== "hidden" && (r.height < 36 || r.width < 36)) { const k = "p" + el.className + el.tagName + Math.round(r.width) + "x" + Math.round(r.height); if (!seen.has(k)) { seen.add(k); res.tap.push(lab(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`); } }
      });
      return res;
    });
    out.push({ w, scheme, name, errs: errs.splice(0), ...r });
    if ((w === 390) || (w === 360 && scheme === "light")) { await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: `${S}/${name}-${w}-${scheme}.png` }); if (/order|foh|forecast|report|prep/.test(name) && w === 390 && scheme === "light") await p.screenshot({ path: `${S}/${name}-${w}-full.png`, fullPage: true }); }
    if (/^loc|log/.test(name)) { await p.evaluate(() => { const bk = [...document.querySelectorAll(".view")].find((v) => !v.hidden)?.querySelector(".back"); bk && bk.click(); }); await p.waitForTimeout(300); }
  }
  await ctx.close();
}
fs.writeFileSync(S + "/audit.json", JSON.stringify(out, null, 1));
for (const o of out) console.log(o.w, o.scheme, o.name, o.err ? "ERR " + o.err : `hs ${o.hscroll} clip ${o.clip.length} off ${o.off.length} tap ${o.tap.length} tiny ${o.tiny.length} err ${o.errs.length}`);
await b.close();
